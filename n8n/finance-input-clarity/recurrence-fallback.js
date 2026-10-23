// A recurrence request is a scheduling question, never proof of a paid expense.
// This narrow fallback also runs when the intention model is unavailable.
{
 const recurrenceText=String(x.text??'');
 const recurrencePlain=plain(recurrenceText);
 const asksToAdd=/\b(?:inclu\w*|adicion\w*|cadastr\w*|crie|criar)\b/.test(recurrencePlain);
 const hasRecurrence=/\b(?:recorrente|recorrencia|todo mes|todos os meses|mensalmente|toda semana|semanalmente)\b/.test(recurrencePlain);
 const isExpense=/\b(?:despesa|gasto|conta|fatura|assinatura)\b/.test(recurrencePlain);
 const denies=/\b(?:nao|nunca|cancele|cancelar|exclua|excluir|apague|apagar)\b/.test(recurrencePlain);
 const values=moneyIn(recurrenceText);
 if(x.mediaKind==='text'&&asksToAdd&&hasRecurrence&&isExpense&&!denies&&values.length===1){
  const value=values[0];
  const withoutAmount=recurrenceText.slice(0,value.index)+' '+recurrenceText.slice(value.index+value.match.length);
  const description=clean(withoutAmount
   .replace(/\b(?:inclu\w*|adicion\w*|cadastr\w*|crie|criar|uma|um|despesa|gasto|conta|fatura|assinatura|recorrente|recorrência|recorrencia|todo\s+m[eê]s|todos\s+os\s+meses|mensalmente|toda\s+semana|semanalmente)\b/giu,' ')
   .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g,'').replace(/\s*[,;:]\s*/g,' '));
  if(description&&description.length<=180){
   const recurrenceState=$getWorkflowStaticData('global');
   recurrenceState.alertConversations??={};
   recurrenceState.alertConversations[x.chatId+':'+x.senderId]={at:Date.now(),values:{description,amount:value.amount,kind:'payment'},single_occurrence_offer:true};
   return [{json:{...x,route:'reply',financialStatus:'alerta_esclarecer',replyText:'Entendi uma despesa recorrente de '+br(value.amount)+' — '+description+'. Ainda não crio lançamentos recorrentes automaticamente por aqui. Posso preparar um lembrete apenas para o próximo vencimento. Qual é a data? Nenhuma despesa foi registrada.'}}];
  }
 }
}
