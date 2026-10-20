// Embedded in Classificar comando after the current input and trusted context exist.
const payerUUID = value => typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const payerContext = x.payerContext?.available===true ? x.payerContext : null;
const payerRoster = payerContext && Array.isArray(payerContext.participants) ? payerContext.participants.filter(p=>payerUUID(p?.id)&&typeof p.active==='boolean') : [];
const payerPeople = payerRoster.filter(p=>p.active===true);
const payerName = value => clean(value).replace(/[\p{C}@_*~`<>\[\]]/gu,' ').replace(/\s+/g,' ').trim().slice(0,60) || 'Pessoa cadastrada';
const payerPerson = id => {const matches=payerPeople.filter(p=>p.id.toLowerCase()===String(id).toLowerCase());return matches.length===1?matches[0]:null;};
const payerProposal = draft => {
  if(draft.payer_needs_clarification===true)return null;
  const input=draft.payer??{kind:'unknown',participant_ids:[]};
  if(!input||typeof input!=='object'||Array.isArray(input)||!['unknown','participant','joint'].includes(input.kind))return null;
  const ids=input.participant_ids??[];
  if(!Array.isArray(ids)||ids.some(id=>!payerUUID(id)))return null;
  const normalized=ids.map(id=>id.toLowerCase());
  if(new Set(normalized).size!==normalized.length)return null;
  if((input.kind==='unknown'&&ids.length)||(input.kind==='participant'&&ids.length!==1)||(input.kind==='joint'&&ids.length<2))return null;
  if(input.kind!=='unknown'&&(!payerContext||normalized.some(id=>!payerPerson(id))))return null;
  return {kind:input.kind,participant_ids:[...normalized].sort()};
};
const payerText = tx => {
  if(tx.transaction_type!=='despesa')return '';
  if(tx.payerFrozenVersion!==1)return ' — Pagador: não identificado';
  return ' — Pagador: '+(tx.payer.kind==='unknown'?'não identificado':tx.payerLabel);
};
