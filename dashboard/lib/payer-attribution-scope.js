import { summarizeExpensesByPayer } from './payer-attribution.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function canonical(value) {
  if(typeof value!=='string'||!UUID.test(value))throw new Error('Carteira inválida.');
  return value.toLowerCase();
}
function calendarDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const d=new Date(value+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
}
function scopeOf(input) {
  if(!input||!['complete','page'].includes(input.coverage)
    ||!calendarDate(input.date_from)||!calendarDate(input.date_to)||input.date_from>input.date_to)throw new Error('Escopo do resumo inválido.');
  if(input.coverage==='complete') {
    if(input.pagination!=null)throw new Error('Resumo completo não aceita paginação.');
    return {coverage:'complete',date_from:input.date_from,date_to:input.date_to,pagination:null};
  }
  const p=input.pagination;
  if(!p||!Number.isSafeInteger(p.page)||p.page<1||!Number.isSafeInteger(p.page_size)||p.page_size<1||p.page_size>1000||typeof p.has_more!=='boolean')throw new Error('Paginação do resumo inválida.');
  return {coverage:'page',date_from:input.date_from,date_to:input.date_to,pagination:{page:p.page,page_size:p.page_size,has_more:p.has_more}};
}
/**
 * walletIds MUST come from server-authorized memberships. Complete describes the
 * supplied date/query slice, never inferred from pagination or amount of rows.
 * Keep individual identities inside each wallet; names do not merge identities.
 */
export function summarizeExpenseScopeByPayer({walletIds,participants,transactions,attributions=[],scope}) {
  const declared=scopeOf(scope);
  if(!Array.isArray(walletIds)||!walletIds.length||!Array.isArray(participants)||!Array.isArray(transactions)||!Array.isArray(attributions))throw new Error('Consulta do casal inválida.');
  const wallets=walletIds.map(canonical);
  if(new Set(wallets).size!==wallets.length)throw new Error('Carteira repetida no escopo.');
  if(declared.coverage==='page'&&transactions.length>declared.pagination.page_size)throw new Error('Página contém mais lançamentos que o limite declarado.');
  const by_wallet=[];
  const totals={total_cents:0,unknown_cents:0,joint_cents:0,individually_attributed_cents:0,transaction_count:0};
  for(const wallet of wallets.sort()) {
    const rows=transactions.filter(row=>{
      if(typeof row?.user_id!=='string'||row.user_id.toLowerCase()!==wallet)return false;
      if(row.deleted_at||row.transaction_type!=='despesa')return false;
      if(!calendarDate(row.transaction_date))throw new Error('Data do lançamento inválida.');
      return row.transaction_date>=declared.date_from&&row.transaction_date<=declared.date_to;
    }).map(row=>({...row,user_id:wallet}));
    const selected=new Set(rows.map(row=>canonical(row.id)));
    const members=participants.filter(p=>typeof p?.finance_user_id==='string'&&p.finance_user_id.toLowerCase()===wallet).map(p=>({...p,finance_user_id:wallet}));
    const metadata=attributions.filter(a=>typeof a?.finance_user_id==='string'&&a.finance_user_id.toLowerCase()===wallet&&typeof a?.transaction_id==='string'&&selected.has(a.transaction_id.toLowerCase())).map(a=>({...a,finance_user_id:wallet}));
    const summary=summarizeExpensesByPayer({walletId:wallet,participants:members,transactions:rows,attributions:metadata});
    by_wallet.push({wallet_id:wallet,...summary});
    for(const key of ['total_cents','unknown_cents','joint_cents','transaction_count'])totals[key]+=summary[key];
    totals.individually_attributed_cents+=summary.individual_cents.reduce((sum,row)=>sum+row.amount_cents,0);
    if(Object.values(totals).some(value=>!Number.isSafeInteger(value)))throw new Error('Total do casal fora do limite.');
  }
  if(totals.total_cents!==totals.unknown_cents+totals.joint_cents+totals.individually_attributed_cents)throw new Error('Resumo não reconciliado.');
  return {scope:declared,by_wallet,totals};
}
