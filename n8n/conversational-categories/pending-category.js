function categoryPendingReply(context,name,values,state){
 const proposal=state.pending?.[context.chatId];
 const rows=Array.isArray(proposal?.transactions)?proposal.transactions:proposal?.tx?[proposal.tx]:[];
 const key=context.chatId+':'+context.senderId;
 const reply=text=>[{json:{...context,route:'reply',financialStatus:'alerta_categoria',replyText:text}}];
 if(!proposal||Date.now()-Number(proposal.at)>30*60*1000||!rows.length)return reply('Não há uma proposta de lançamento pendente para receber essa categoria. Qual lançamento você quer ajustar?');
 if(Object.prototype.hasOwnProperty.call(values,'expectedProposalKey')&&(proposal.sourceMessageId??null)!==values.expectedProposalKey)return reply('A categoria foi criada, mas a proposta de lançamento mudou durante o pedido. Em qual proposta você quer aplicá-la?');
 let indexes;
 if(rows.length===1||values.apply_all===true)indexes=rows.map((_,i)=>i);
 else if(Array.isArray(values.item_numbers)&&values.item_numbers.length&&values.item_numbers.every(i=>Number.isInteger(i)&&i>=1&&i<=rows.length)&&new Set(values.item_numbers).size===values.item_numbers.length)indexes=values.item_numbers.map(i=>i-1);
 else{
  state.categoryConversations[key]={at:Date.now(),userId:context.user.id,name,target:'pending',phase:'choose_items',proposalKey:proposal.sourceMessageId};
  return reply('A categoria '+name+' está disponível. Quer aplicá-la em todos os '+rows.length+' itens da proposta ou em quais itens?');
 }
 const previous=state.categoryConversations?.[key];
 if(previous?.phase==='choose_items'&&previous.proposalKey!==proposal.sourceMessageId)return reply('A proposta de lançamento mudou. Em quais itens da proposta atual você quer usar a categoria '+name+'?');
 const transactions=rows.map((tx,i)=>indexes.includes(i)?{...tx,category:name}:tx);
 proposal.transactions=transactions;if(proposal.tx)proposal.tx=transactions[0];proposal.at=Date.now();
 state.categoryConversations[key]={at:Date.now(),userId:context.user.id,name,target:'pending',phase:'applied',proposalKey:proposal.sourceMessageId};
 const money=value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const lines=transactions.map((tx,i)=>(i+1)+'. '+(tx.transaction_type==='receita'?'Entrada: ':'Saída: ')+money(tx.amount)+' — '+tx.description+' ('+tx.category+')'+(tx.transaction_type==='despesa'&&tx.payerLabel?' — Pagador: '+tx.payerLabel:''));
 return [{json:{...context,route:'reply',financialStatus:'aguardando_confirmacao',verifiedCategoryProposal:true,replyText:'Categoria ajustada somente na proposta:\n'+lines.join('\n')+'\nEstá certo para registrar esses itens? Nenhum lançamento foi gravado ainda.'}}];
}
