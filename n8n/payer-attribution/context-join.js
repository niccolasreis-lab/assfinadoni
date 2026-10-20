const x=$('Unir preferências de voz').first().json;
const r=$input.first().json;
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const ids=new Set((x.ledgerContext||[]).filter(t=>t.user_id===x.user?.id&&uuid(t.id)).slice(0,50).map(t=>t.id.toLowerCase()));
const usable=r.available===true&&Array.isArray(r.participants)&&Array.isArray(r.attributions);
const payerContext=usable?{
 available:true,
 actor_account_id:uuid(r.actor_account_id)?r.actor_account_id.toLowerCase():null,
 actor_participant_id:uuid(r.actor_participant_id)?r.actor_participant_id.toLowerCase():null,
 participants:r.participants.filter(p=>uuid(p?.id)&&typeof p.display_name==='string'&&typeof p.active==='boolean').map(p=>({id:p.id.toLowerCase(),display_name:p.display_name.slice(0,80),active:p.active})),
 attributions:r.attributions.filter(a=>uuid(a?.transaction_id)&&ids.has(a.transaction_id.toLowerCase())&&a.finance_user_id===x.user?.id),
}: {available:false,actor_account_id:null,actor_participant_id:null,participants:[],attributions:[]};
return [{json:{...x,payerContext}}];
