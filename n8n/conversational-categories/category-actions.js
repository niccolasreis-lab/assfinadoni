// Only structured semantic actions can create a category or select an editing target.
semanticState.categoryConversations??={};
let categoryDraft=semanticState.categoryConversations[semanticKey];
if(categoryDraft&&(categoryDraft.userId!==x.user?.id||Date.now()-Number(categoryDraft.at)>15*60*1000)){delete semanticState.categoryConversations[semanticKey];categoryDraft=null;}
const categoryIntent=ai.category_action||{};
const categoryAction=categoryIntent.action||'none';
if(!['none','create','list','apply','clarify'].includes(categoryAction))return human('Não consegui entender a ação de categoria com segurança. Você quer criar uma categoria ou usá-la em um lançamento?','alerta_categoria');
if(categoryAction!=='none'){
 if(!categoryCatalogAvailable)return human('Não consegui consultar as categorias da carteira agora. Não criei nem alterei categoria ou lançamento.','alerta_categoria');
 if(categoryAction==='list')return human('Categorias disponíveis:\n'+categoryNames.map(name=>'• '+name).join('\n'),'alerta_categoria');
 const requestedName=typeof categoryIntent.name==='string'&&categoryIntent.name.trim()?categoryIntent.name:categoryDraft?.name;
 if(!validCategoryName(requestedName))return human('Qual nome você quer dar à categoria? Use de 2 a 60 caracteres, com letras, números ou pontuação simples.','alerta_categoria');
 const name=resolveCategory(requestedName)||requestedName.normalize('NFC').replace(/\s+/g,' ').trim();
 const target=['pending','selected','recent','none'].includes(categoryIntent.target)?categoryIntent.target:categoryDraft?.target||'none';
 if(categoryAction==='clarify'){semanticState.categoryConversations[semanticKey]={at:Date.now(),userId:x.user.id,name,target,phase:'clarify'};return human('Você quer criar a categoria '+name+' ou aplicar essa categoria a qual lançamento?','alerta_categoria');}
 if(categoryAction==='create'){
  const prior=categoryDraft&&categoryKey(categoryDraft.name)===categoryKey(name)?categoryDraft:{};
  semanticState.categoryConversations[semanticKey]={...prior,at:Date.now(),userId:x.user.id,name,target,phase:'creating',apply_all:categoryIntent.apply_all===true,item_numbers:categoryIntent.item_numbers};
  return [{json:{...x,route:'category_execute',categoryOperation:'create',categoryValues:{name},categoryTarget:target,categoryApplyAll:categoryIntent.apply_all===true,categoryItemNumbers:categoryIntent.item_numbers,categoryExpectedProposalKey:target==='pending'?(semanticState.pending?.[x.chatId]?.sourceMessageId??null):null}}];
 }
 if(!resolveCategory(name)){
  semanticState.categoryConversations[semanticKey]={at:Date.now(),userId:x.user.id,name,target,phase:'ask_create'};
  return human('A categoria '+name+' ainda não está cadastrada. Quer criar essa categoria? Nenhum lançamento foi alterado.','alerta_categoria');
 }
 if(target==='pending')return categoryPendingReply(x,resolveCategory(name),categoryIntent,semanticState);
 if(target==='selected'||target==='recent')return categoryExistingReply(x,resolveCategory(name),target,semanticState);
 return human('A categoria '+name+' está disponível. Em qual lançamento você quer usá-la?','alerta_categoria');
}
