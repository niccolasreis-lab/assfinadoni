const current=$('Preparar confirmação da fila').first().json;
if($input.first().json.ok!==true)return [{json:{...current,queueClaimed:false,route:'reply',financialStatus:'fila_alterada',verifiedAttachmentProposal:true,replyText:'Sua fila mudou ou já está sendo confirmada. Aguarde a resposta do bot antes de confirmar novamente. Nenhum item novo foi gravado por esta tentativa.'}}];
return [{json:{...current,queueClaimed:true}}];
