const context=$('Contexto antes da fila').first().json;
const result=$input.first().json;
if(result.ok!==true||!Array.isArray(result.receipts))throw new Error('Não consegui consultar sua fila. Nenhum lançamento foi confirmado.');
const receipts=result.receipts;
const transactions=receipts.flatMap(r=>r.transactions.map((tx,i)=>({...tx,_queueSourceId:r.source_message_id,_queueIndex:i,_queueVersion:r.version})));
const pending=transactions.length?{transactions,sourceMessageId:'queue_'+context.messageId,at:Date.now()}:null;
const key=context.chatId+':'+context.senderId;
const state=$getWorkflowStaticData('global');state.pending??={};if(pending)state.pending[key]=pending;else delete state.pending[key];
return [{json:{...context,queueReceipts:receipts,queuePending:pending,queueOriginalTransactionsJSON:JSON.stringify(transactions)}}];
