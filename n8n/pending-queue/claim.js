const x=$input.first().json;const base=$('Preparar contexto seguro').first().json;
if(x.pendingConfirmation!==true||!Array.isArray(x.transactions)||!x.transactions.length||!base.queueReceipts?.length)throw new Error('Confirme uma proposta atual antes de salvar.');
const selected=base.queueReceipts.filter(r=>x.transactions.some(t=>t._queueSourceId===r.source_message_id));
if(!selected.length||x.transactions.some(t=>!selected.some(r=>r.source_message_id===t._queueSourceId&&r.version===t._queueVersion)))throw new Error('A origem da proposta não foi validada.');
for(const receipt of selected){const rows=x.transactions.filter(t=>t._queueSourceId===receipt.source_message_id);if(rows.length!==receipt.transactions.length||new Set(rows.map(t=>t._queueIndex)).size!==rows.length||rows.some(t=>!Number.isInteger(t._queueIndex)||t._queueIndex<0||t._queueIndex>=receipt.transactions.length))throw new Error('Confira todos os itens do comprovante antes de confirmar.');}
const receipts=selected.map(r=>({source_message_id:r.source_message_id,version:r.version,transactions:x.transactions.filter(t=>t._queueSourceId===r.source_message_id).sort((a,b)=>a._queueIndex-b._queueIndex).map(t=>{const {_queueSourceId,_queueIndex,_queueVersion,...tx}=t;return tx;})}));
return [{json:{...x,queueClaimPayload:{confirmation_id:x.messageId,receipts}}}];
