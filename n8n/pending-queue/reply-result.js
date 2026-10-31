const current=$('Preparar persistência da fila').first().json;const r=$input.first().json;
if(r.ok!==true)return [{json:{...current,financialStatus:'falha_fila',verifiedAttachmentProposal:true,replyText:'Não consegui guardar sua proposta na fila. Nenhum lançamento novo foi salvo. Aguarde e tente novamente.'}}];
const copy={...current};delete copy.queuePayload;delete copy.queueNewProposal;
if(current.queueAction==='put'&&r.pending_count>1)copy.replyText+='\nSua fila tem '+r.pending_count+' itens. Diga “pode registrar todos” para confirmar seus itens pendentes; os da outra pessoa ficam separados.';
return [{json:copy}];
