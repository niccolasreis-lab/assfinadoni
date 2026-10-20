const x=$('Preparar identificação confirmada').item.json;
const r=$input.first().json,a=r.attribution;
const equalIds=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&left.every(id=>typeof id==='string')&&right.every(id=>typeof id==='string')&&JSON.stringify(left.map(s=>s.toLowerCase()).sort())===JSON.stringify(right.map(s=>s.toLowerCase()).sort());
const confirmed=r.ok===true&&a&&a.transaction_id===x.savedId&&a.finance_user_id===x.userId&&a.kind===x.tx.payer.kind&&equalIds(a.participant_ids,x.tx.payer.participant_ids);
return [{json:{...x,attributionStatus:confirmed?'confirmed':'pending'}}];
