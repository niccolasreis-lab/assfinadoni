const recentExpenses=catalog.filter(r=>r.transaction_type==='despesa').slice(0,50);
if(!payerContext){
 return human('A identificação de pagadores não está disponível agora. Não vou atribuir gastos a alguém sem confirmar essa informação. A carteira continua compartilhada.','gestao_consulta_compartilhada');
}
if(!payerRoster.length)return human('Não há participantes cadastrados disponíveis para identificar pagadores agora. A carteira continua compartilhada.','gestao_consulta_compartilhada');
const mentions=payerQueryPeople;
if(mentions.length!==1)return human('De quem você quer consultar os pagamentos? Posso conferir por '+payerRoster.map(p=>payerName(p.display_name)).join(' ou ')+'.','gestao_consulta_compartilhada');
const person=mentions[0],attrs=Array.isArray(payerContext.attributions)?payerContext.attributions:[];
const map=new Map();
for(const a of attrs){
 if(a.finance_user_id!==x.user?.id||!payerUUID(a.transaction_id)||!['unknown','participant','joint'].includes(a.kind)||!Array.isArray(a.participant_ids))continue;
 const key=a.transaction_id.toLowerCase();
 if(map.has(key)){map.set(key,null);continue;}
 map.set(key,a);
}
const individual=[],joint=[];let unknown=0;
for(const row of recentExpenses){
 const a=map.get(row.id.toLowerCase());
 if(!a||a.kind==='unknown'){unknown++;continue;}
 const ids=a.participant_ids.map(String).map(s=>s.toLowerCase());
 if(a.kind==='participant'&&ids.length===1&&ids[0]===person.id.toLowerCase())individual.push(row);
 else if(a.kind==='joint'&&ids.includes(person.id.toLowerCase()))joint.push(row);
}
const limit='Consulta dos até 50 lançamentos recentes disponíveis; não é um total mensal.';
const list=rows=>rows.slice(0,10).map(r=>'• '+brief(r)).join('\n');
const who=payerName(person.display_name);
return human('Pagamentos individuais identificados de '+who+':'+(individual.length?'\n'+list(individual):' nenhum nesse recorte.')+(joint.length?'\n\nPagamentos conjuntos com '+who+' (sem divisão presumida):\n'+list(joint):'')+'\n\n'+unknown+' despesa(s) desse recorte continuam sem pagador identificado. '+limit,'gestao_consulta_compartilhada');
