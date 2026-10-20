// Pure domain rules. Not connected to routes or workflows until persistence/integration tests pass.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value) {
  if(typeof value!=='string'||!UUID.test(value)) throw new Error('Identificador de participante ou carteira inválido.');
  return value.toLowerCase();
}
function registry(walletId,participants,{historical=false}={}) {
  const wallet=id(walletId);
  if(!Array.isArray(participants))throw new Error('Participantes inválidos.');
  const result=new Map();
  for(const p of participants) {
    if(!p||typeof p!=='object'||p.finance_user_id!==wallet)continue;
    const key=id(p.id);
    if(result.has(key))throw new Error('Cadastro de participante duplicado.');
    if(historical||p.active===true)result.set(key,p);
  }
  return result;
}
function selection(input,allowed) {
  if(input===undefined||input===null)input={kind:'unknown',participant_ids:[]};
  if(typeof input!=='object'||Array.isArray(input))throw new Error('Responsável inválido.');
  const kind=input.kind;
  const ids=input.participant_ids===undefined?[]:input.participant_ids;
  if(!['unknown','participant','joint'].includes(kind)||!Array.isArray(ids))throw new Error('Responsável inválido.');
  const normalized=ids.map(id);
  if(new Set(normalized).size!==normalized.length)throw new Error('Participante repetido.');
  if((kind==='unknown'&&normalized.length!==0)||(kind==='participant'&&normalized.length!==1)||(kind==='joint'&&normalized.length<2))throw new Error('Seleção de responsável inválida.');
  if(normalized.some(key=>!allowed.has(key)))throw new Error('Participante indisponível nesta carteira.');
  return {kind,participant_ids:[...normalized].sort()};
}
/** Validate an explicit selection against the SERVER supplied wallet roster; never derive payer from sender/name/text. */
export function normalizePayerSelection(input,{walletId,participants}) {
  return selection(input,registry(walletId,participants));
}
/** Recorder identity is resolved from the authenticated connector/session, separately from the payer proposal. */
export function normalizeRecorder(participantId,{walletId,participants}) {
  const allowed=registry(walletId,participants);
  if(participantId===undefined||participantId===null)return null;
  const key=id(participantId);
  if(!allowed.has(key))throw new Error('Autor indisponível nesta carteira.');
  return key;
}
function cents(value) {
  if(!['number','string'].includes(typeof value)||!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(String(value)))throw new Error('Valor monetário inválido.');
  const [whole,decimal='']=String(value).split('.');
  const amount=Number(whole)*100+Number(decimal.padEnd(2,'0'));
  if(!Number.isSafeInteger(amount)||amount<=0||amount>10000000000)throw new Error('Valor monetário inválido.');
  return amount;
}
/**
 * Expenses from the supplied, already authorized/date-filtered rows only.
 * Missing attribution remains unknown. Joint payments stay in a separate bucket;
 * this does not divide them 50/50 or count them again for each person.
 */
export function summarizeExpensesByPayer({walletId,participants,transactions,attributions=[]}) {
  const wallet=id(walletId),allowed=registry(wallet,participants,{historical:true});
  if(!Array.isArray(transactions)||!Array.isArray(attributions))throw new Error('Consulta de despesas inválida.');
  const metadata=new Map();
  for(const row of attributions) {
    if(row?.finance_user_id!==wallet)continue;
    const txid=id(row.transaction_id);
    if(metadata.has(txid))throw new Error('Responsável duplicado para o mesmo lançamento.');
    metadata.set(txid,selection({kind:row.kind,participant_ids:row.participant_ids},allowed));
  }
  const individual=new Map(),seen=new Map();
  let total=0,unknown=0,joint=0,count=0;
  for(const row of transactions) {
    if(row?.user_id!==wallet||row.deleted_at||row.transaction_type!=='despesa')continue;
    const txid=id(row.id),amount=cents(row.amount);
    if(seen.has(txid)) {
      if(seen.get(txid)!==amount)throw new Error('Lançamento duplicado com valores divergentes.');
      continue;
    }
    seen.set(txid,amount);
    const payer=metadata.get(txid)||{kind:'unknown',participant_ids:[]};
    total+=amount;count++;
    if(!Number.isSafeInteger(total))throw new Error('Total monetário fora do limite.');
    if(payer.kind==='unknown')unknown+=amount;
    else if(payer.kind==='joint')joint+=amount;
    else individual.set(payer.participant_ids[0],(individual.get(payer.participant_ids[0])||0)+amount);
  }
  return {total_cents:total,unknown_cents:unknown,joint_cents:joint,individual_cents:[...individual].sort(([a],[b])=>a.localeCompare(b)).map(([participant_id,amount_cents])=>({participant_id,amount_cents})),transaction_count:count};
}
