const x=$('Preparar resultado seguro da voz').item.json;
const request=$('Autorizar resumo falado solicitado').item.json;
if(x.noticeAllowed!==true||x.success===true||x.voiceOutcome==='sent'||!request.chatId||x.chatId!==request.chatId)return null;
const replyText=x.voiceOutcome==='uncertain'
 ? 'A resposta está no texto acima. Não consegui confirmar a entrega do áudio e não vou reenviá-lo automaticamente.'
 : x.voiceOutcome==='not_authorized'
 ? 'A resposta continua disponível no texto acima. O áudio não foi enviado.'
 : 'A resposta está no texto acima. Não consegui preparar o áudio agora.';
return {json:{chatId:request.chatId,replyText}};
