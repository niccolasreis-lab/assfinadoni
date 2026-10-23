  // Cancellation charges are not income merely because a service was cancelled.
  // Only the matching item can supply evidence of an actual refund/receipt.
  if(draft.transaction_type==='receita'){
   const cancellation=/\bcancel(?:amento|ar|ei|ou|ado|ada|ados|adas)\b/;
   const relevantLines=currentText.split(/\n+/).filter(line=>cancellation.test(plain(line))&&moneyIn(line).some(v=>cents(v.amount)===cents(amount)));
   if(cancellation.test(plain(description))||relevantLines.length){
    const evidenceLines=relevantLines.length?relevantLines:(drafts.length===1?[currentText]:[]);
    const receiptEvidence=line=>{
     const value=plain(line);
     if(/\b(?:nao|nunca|sem)\b.{0,36}\b(?:receb\w*|entr\w*|estorno|reembolso|devolucao|credit\w*|deposit\w*)\b/.test(value))return false;
     if(/\b(?:aguardo|aguardando|solicitei|solicitar|pedido|previsto|pendente|a receber|vai|sera|devera|prometeram)\b.{0,40}\b(?:receb\w*|entr\w*|estorno|reembolso|devolucao|credit\w*|deposit\w*)\b/.test(value))return false;
     if(/\breceb(?:i|emos|ido|ida)\s+(?:(?:o|a|um|uma)\s+)?(?:boleto|cobranca|fatura|multa|taxa|conta|aviso|notificacao)\b/.test(value))return false;
     return /\b(?:recebi|recebemos|recebido|recebida|entrou|entraram|creditaram|depositaram|devolveram|estornaram|reembolsaram|estorno|reembolso|devolucao)\b/.test(value);
    };
    if(!evidenceLines.some(receiptEvidence))return human('Quero confirmar o sentido do item “'+description+'”, de '+br(amount)+': foi uma cobrança de cancelamento (despesa) ou um valor devolvido a vocês (receita)? Nenhum item novo foi registrado.','alerta_esclarecer_tipo');
   }
  }
