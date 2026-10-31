const current=$input.first().json;const context=$('Preparar contexto seguro').first().json;
const receipt=context.queueReceipts?.find(r=>current.sourceEventId==='wa:'+r.source_message_id+':'+current.itemIndex);
const candidate=receipt&&current.pendingConfirmation===true&&current.savedId&&['registrado','duplicado'].includes(current.status)?receipt.attachment:null;
return [{json:{...current,attachmentCandidate:candidate||null}}];
