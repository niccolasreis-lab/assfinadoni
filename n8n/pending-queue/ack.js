const results=$input.all().map(i=>i.json);const context=$('Interpretar lançamento').first().json;
const sources=[...new Set(results.map(r=>r.sourceMessageId))];
return [{json:{queueResults:results,queueAckPayload:{confirmation_id:context.messageId,receipts:sources.map(source_message_id=>({source_message_id,complete:results.filter(r=>r.sourceMessageId===source_message_id).every(r=>['registrado','duplicado'].includes(r.status))}))}}}];
