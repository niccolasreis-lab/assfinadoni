function categoryExistingReply(context,name,target,state){
 const key=context.chatId+':'+context.senderId;
 const reply=(replyText,financialStatus='gestao_edicao')=>[{json:{...context,route:'reply',financialStatus,replyText}}];
 const catalog=Array.isArray(context.ledgerContext)?context.ledgerContext.filter(r=>r.user_id===context.user?.id&&!r.deleted_at):[];
 let session=state.management?.[key];
 if(session&&(session.userId!==context.user.id||Date.now()-Number(session.at)>15*60*1000))session=null;
 let selected=target==='selected'?session?.selected:null;
 if(target==='recent'){
  const recent=state.recent?.[context.chatId],rows=Array.isArray(recent?.transactions)?recent.transactions:[];
  if(recent&&Date.now()-Number(recent.at)<=30*60*1000&&rows.length===1)selected=catalog.find(r=>r.id===rows[0].id);
 }
 const allowed=[...catalog,...(session?.rows||[])].filter(r=>r.user_id===context.user.id&&!r.deleted_at);
 if(!selected||selected.user_id!==context.user.id||!allowed.some(r=>r.id===selected.id))return reply('Qual lançamento você quer colocar em '+name+'? Preciso identificar um único lançamento antes de propor a alteração.');
 session??={userId:context.user.id,at:Date.now(),rows:catalog,page:0};
 session.selected=selected;session.at=Date.now();session.mode='edit';delete session.clarification;
 session.proposal={kind:'update',record:selected,changes:{category:name},semantic:true,token:context.messageId+':update:'+selected.id};
 state.management??={};state.management[key]=session;
 const money=Number(selected.amount).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 return reply('Em '+money+' — '+selected.description+' ('+selected.transaction_date+'), a categoria vai ficar '+name+'. Está certo assim? Nenhum lançamento foi alterado ainda.','gestao_confirmacao');
}
