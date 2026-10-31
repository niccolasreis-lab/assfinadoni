const original=$('Preparar conclusão da fila').first().json;
const pending=$input.first().json.ok!==true;
return original.queueResults.map(json=>({json:{...json,...(pending?{queueAckPending:true}:{})}}));
