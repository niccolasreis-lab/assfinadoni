const current=$input.first().json;const context=$('Preparar contexto seguro').first().json;
const state=$getWorkflowStaticData('global');const proposal=state.pending?.[context.chatId+':'+context.senderId];
let action='load',payload={};
if(current.queueNewProposal){action='put';payload={source_message_id:current.queueNewProposal.sourceMessageId,transactions:current.queueNewProposal.transactions,attachment:current.queueNewProposal.attachment??null};}
else if(proposal&&proposal.sourceMessageId===context.messageId){action='put';payload={source_message_id:proposal.sourceMessageId,transactions:proposal.transactions,attachment:proposal.attachment??null};}
else if(context.queueReceipts?.length&&proposal&&JSON.stringify(proposal.transactions)!==context.queueOriginalTransactionsJSON){
 action='adjust';payload.receipts=context.queueReceipts.map(r=>({...r,transactions:proposal.transactions.filter(t=>t._queueSourceId===r.source_message_id).map(t=>{const {_queueSourceId,_queueIndex,_queueVersion,...tx}=t;return tx;})}));
}else if(context.queueReceipts?.length&&!proposal){action='cancel';payload.receipts=context.queueReceipts.map(({source_message_id,version})=>({source_message_id,version}));}
return [{json:{...current,queueAction:action,queuePayload:payload}}];
