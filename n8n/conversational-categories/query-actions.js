const financialQuery=ai.financial_query||{};
if(financialQuery.action&&financialQuery.action!=='none'){
 if(payerQueryPeople.length||/\b(?:ionara|narinha|guiga|nara|nicolas|nic)\b/.test(personQuery))return human('Essa consulta envolve uma pessoa. A consulta livre não transforma nome de pessoa em descrição de gasto nem presume quem pagou. Posso conferir pagamentos identificados no recorte de até 50 lançamentos recentes; qual pessoa e quais pagamentos você quer consultar?','gestao_consulta_compartilhada');
 const permitted=['action','date_from','date_to','type','category','search','limit','inherit','subset_only'];
 if(!['list','total','breakdown'].includes(financialQuery.action)||Object.keys(financialQuery).some(k=>!permitted.includes(k)))return human('Não consegui validar os filtros dessa consulta. Qual período e categoria você quer consultar?','gestao_consulta_livre');
 if(financialQuery.subset_only===true)return human('O limite de exibição escolhe quantos itens mostrar; os totais dessa consulta incluem todos os lançamentos que correspondem aos filtros. Para somar só determinados itens, preciso identificar esse recorte por período, categoria ou descrição. Qual recorte você quer usar?','gestao_consulta_livre');
 const prior=semanticState.queryConversations?.[semanticKey];
 const inherited=financialQuery.inherit===true&&prior?.userId===x.user.id&&Date.now()-Number(prior.at)<=15*60*1000?prior.filters:{};
 const values={...inherited,...Object.fromEntries(Object.entries(financialQuery).filter(([k])=>!['inherit','subset_only'].includes(k)))};
 const validQueryDate=value=>value==null||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=1900&&Number(value.slice(0,4))<=2100&&!isNaN(new Date(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
 if(!validQueryDate(values.date_from)||!validQueryDate(values.date_to)||(values.date_from&&values.date_to&&values.date_from>values.date_to))return human('Qual é o período correto da consulta? Preciso de uma data inicial e final válidas, em ordem.','gestao_consulta_livre');
 if(values.type!=null&&!['despesa','receita'].includes(values.type))return human('Você quer consultar despesas, receitas ou ambas?','gestao_consulta_livre');
 let category=null;
 if(values.category!=null){category=resolveCategory(values.category);if(!category)return human('Não encontrei a categoria informada no catálogo da carteira. Qual categoria você quer consultar?','gestao_consulta_livre');}
 const search=values.search==null?null:typeof values.search==='string'?values.search.normalize('NFC').trim():false;
 if(search===false||search!==null&&(search.length>120||/[\p{C}]/u.test(search)))return human('Como você quer filtrar a descrição? Use um trecho de até 120 caracteres.','gestao_consulta_livre');
 const limit=values.limit==null?50:values.limit;
 if(!Number.isInteger(limit)||limit<1||limit>50)return human('Posso exibir de 1 a 50 lançamentos por consulta. Quantos você quer ver?','gestao_consulta_livre');
 return [{json:{...x,route:'query_execute',queryValues:{action:values.action,date_from:values.date_from??null,date_to:values.date_to??null,type:values.type??null,category,search:search||null,limit}}}];
}
