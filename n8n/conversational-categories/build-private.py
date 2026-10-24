"""Build a reviewed private category/query integration. No API calls or deployment."""
import argparse,copy,hashlib,json,pathlib,re,uuid
HERE=pathlib.Path(__file__).resolve().parent
PRIVATE=HERE.parents[2]/'n8n-work'
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',type=pathlib.Path,default=PRIVATE/'category-live-before.json');args=p.parse_args()
before=json.loads(args.source.read_text());w=copy.deepcopy(before)
def node(name):return next(n for n in w['nodes']if n['name']==name)
def text(file):return (HERE/file).read_text()
def edge(name):return {'node':name,'type':'main','index':0}
def newcode(name,js,pos):return {'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'conversational-categories:'+name)),'name':name,'type':'n8n-nodes-base.code','typeVersion':2,'position':pos,'parameters':{'jsCode':js}}
def newif(name,route,pos):
 n=copy.deepcopy(node('É preferência financeira?'));n.update(id=str(uuid.uuid5(uuid.NAMESPACE_URL,'conversational-categories:'+name)),name=name,position=pos)
 n['parameters']['conditions']['conditions'][0]['leftValue']='={{ $json.route === '+json.dumps(route)+' }}';return n
def rpc(name,function,body,pos):
 n=copy.deepcopy(node('Reservar complemento de voz'));n.update(id=str(uuid.uuid5(uuid.NAMESPACE_URL,'conversational-categories:'+name)),name=name,position=pos,retryOnFail=False)
 n['parameters']['url']=re.sub(r'/rpc/[^/]+$','/rpc/'+function,n['parameters']['url']);n['parameters']['jsonBody']='={{ JSON.stringify('+body+') }}'
 return n
common=text('catalog.js')
old_list="['Alimentação','Transporte','Moradia','Saúde','Educação','Lazer','Assinaturas','Casamento','Viagem','Outros']"
def catalog_code(code,context_anchor):
 code=code.replace(old_list,'categoryNames')
 pattern=r'const categoryFrom = text => \{[\s\S]*?\n\};'
 match=re.search(pattern,code);assert match
 inferred=match.group(0).replace('const categoryFrom =','const inferCategoryFrom =',1)
 wrapper="const categoryFrom = value => resolveCategory(String(value??'').trim()) || inferCategoryFrom(value);"
 code=code[:match.start()]+inferred+'\n'+wrapper+code[match.end():]
 assert context_anchor in code
 return common+'\n'+code.replace(context_anchor,context_anchor+'\ninitCategoryCatalog('+('context'if 'context' in context_anchor else 'x')+');',1)
modified=[]
classifier=node('Classificar comando')['parameters']['jsCode']
classifier=catalog_code(classifier,"if (x.route === 'reply' || x.route === 'transaction') return [{json:x}];")
classifier=classifier.replace("initCategoryCatalog(x);","x={...x,categoryContext:initCategoryCatalog(x)};",1)
recurrence_anchor=" const recurrencePlain=plain(recurrenceText);";assert classifier.count(recurrence_anchor)==1
classifier=classifier.replace(recurrence_anchor,recurrence_anchor+"\n const withoutCategoryLabel=recurrencePlain.replace(/\\bcategoria\\s+(?:(?:chamada|nova|de|como)\\s+)?recorrencia\\b/g,'categoria definida');\n const recurrenceLabelOnly=withoutCategoryLabel!==recurrencePlain&&!/\\b(?:recorrente|recorrencia|todo mes|todos os meses|mensalmente|toda semana|semanalmente)\\b/.test(withoutCategoryLabel);",1)
recurrence_gate="if(x.mediaKind==='text'&&asksToAdd&&hasRecurrence&&isExpense&&!denies&&values.length===1)";assert classifier.count(recurrence_gate)==1
classifier=classifier.replace(recurrence_gate,"if(x.mediaKind==='text'&&asksToAdd&&hasRecurrence&&isExpense&&!denies&&!recurrenceLabelOnly&&values.length===1)",1)
anchor="const voice=ai.voice||{};";assert classifier.count(anchor)==1
actions=text('pending-category.js')+'\n'+text('existing-category.js')+'\n'+text('category-actions.js')+'\n'+text('query-actions.js')+'\n'
classifier=classifier.replace(anchor,actions+anchor,1)
classifier=classifier.replace("const categoryIntent=ai.category_action||{};","const categoryIntent=ai.category_action||(ai.category&&typeof ai.category==='object'?ai.category:{});")
old="const category=cats.find(c=>plain(c)===plain(draft.category))||'Outros';"
assert old in classifier
classifier=classifier.replace(old,"const category=draft.category==null||draft.category===''?'Outros':resolveCategory(draft.category);if(!category){semanticState.categoryConversations??={};semanticState.categoryConversations[semanticKey]={at:Date.now(),userId:x.user.id,name:typeof draft.category==='string'?draft.category:null,target:'none',phase:'ask_create',sourceText:String(x.text??'').slice(0,8000),sourceMessageId:x.messageId,sourceAt:Date.now()};return human('Não encontrei a categoria informada no catálogo. Você quer criar essa categoria antes de preparar o lançamento?','alerta_categoria');}",1)
old="const category=categories.find(v=>plain(v)===plain(ai.category));const pay=";assert old in classifier
classifier=classifier.replace(old,"const category=categories.find(v=>plain(v)===plain(ai.category));if(typeof ai.category==='string'&&ai.category.trim()&&!category)return human('Não encontrei essa categoria no catálogo. Você quer criar a categoria antes de ajustar a proposta?','alerta_categoria');const pay=",1)
classifier=classifier.replace('Use uma categoria: Alimentação, Transporte, Moradia, Saúde, Educação, Lazer, Assinaturas, Casamento, Viagem ou Outros.','Use uma categoria disponível no catálogo da carteira ou peça para criar uma categoria nova.')
node('Classificar comando')['parameters']['jsCode']=classifier;modified.append('Classificar comando')
code=node('Preparar intenção financeira')['parameters']['jsCode']
code=code.replace('const context = $input.first().json;',"const incoming=$input.first().json;const categoryContext=$('Unir categorias da carteira').first().json.categoryContext;const context={...incoming,categoryContext};")
code=code.replace('contextoDePagadores:',"categoriasDisponiveis:categoryContext?.available?categoryContext.categories:null,propostaCategoria:(state.categoryConversations?.[context.chatId+':'+context.senderId]?.userId===context.user?.id&&Date.now()-state.categoryConversations[context.chatId+':'+context.senderId].at<15*60*1000)?state.categoryConversations[context.chatId+':'+context.senderId]:null,consultaAnterior:(state.queryConversations?.[context.chatId+':'+context.senderId]?.userId===context.user?.id&&Date.now()-state.queryConversations[context.chatId+':'+context.senderId].at<15*60*1000)?state.queryConversations[context.chatId+':'+context.senderId]:null,contextoDePagadores:",1)
node('Preparar intenção financeira')['parameters']['jsCode']=code;modified.append('Preparar intenção financeira')
for name,anchor in [('Interpretar lançamento','const context=$input.first().json;'),('Normalizar anexo IA',"const context=$('Preparar contexto seguro').first().json;")]:
 code=catalog_code(node(name)['parameters']['jsCode'],anchor)
 if name=='Interpretar lançamento':
  code=code.replace("const m=context.mediaTx;tx=", "const m=context.mediaTx;if(m.category!=null&&m.category!==''&&!resolveCategory(m.category))return reply('Não encontrei a categoria do anexo no catálogo. Quer criar essa categoria antes de preparar o lançamento?');tx=",1)
  code=code.replace("category:categoryFrom(m.description)||'Outros'","category:m.category?resolveCategory(m.category):categoryFrom(m.description)||'Outros'",1)
 else:
  anchor2="const transactions=data.transactions.map(item=>{";assert anchor2 in code
  code=code.replace(anchor2,"if(data.transactions.some(item=>item.category!=null&&item.category!==''&&!resolveCategory(item.category)))return [{json:{...context,route:'reply',financialStatus:'alerta_categoria',replyText:'Não encontrei uma categoria informada no anexo no catálogo. Quer criar essa categoria antes de preparar os lançamentos?'}}];\n"+anchor2,1)
  code=code.replace("category:categoryFrom(description)||'Outros'","category:item.category?resolveCategory(item.category):categoryFrom(description)||'Outros'",1)
 node(name)['parameters']['jsCode']=code;modified.append(name)
code=node('Preparar anexo IA')['parameters']['jsCode'];anchor="const input = $input.first();";assert anchor in code
code=common+'\n'+code.replace(anchor,anchor+'\ninitCategoryCatalog(context);',1)
code=code.replace("description: { type: 'STRING' },","description: { type: 'STRING' },\n          category: { type: 'STRING', nullable: true, enum: categoryNames },",1)
code=code.replace("'Não invente valores, datas ou transações ausentes.',","'Não invente valores, datas ou transações ausentes.',",1)
anchor="  'Extraia os lançamentos financeiros deste anexo em português do Brasil.',";assert anchor in code
code=code.replace(anchor,anchor+"\n  'category pode ser um nome do catálogo apenas quando explicitamente informado no anexo ou na mensagem atual. Se não houver categoria explícita use null. Catálogo: '+JSON.stringify(categoryNames)+'. Mensagem atual: '+JSON.stringify(String(context.text??'').slice(0,1600))+'.',",1)
node('Preparar anexo IA')['parameters']['jsCode']=code;modified.append('Preparar anexo IA')
code=node('Preparar conversa para o agente')['parameters']['jsCode']
anchor='mensagemAtual:String(context.text??\'\').slice(0,1600),';assert anchor in code
code=code.replace(anchor,"categoriasDisponiveis:(()=>{try{return $('Unir categorias da carteira').first().json.categoryContext;}catch{return null;}})(),propostaCategoria:(()=>{const d=$getWorkflowStaticData('global').categoryConversations?.[context.chatId+':'+context.senderId];return d?.userId===context.user?.id&&Date.now()-d.at<15*60*1000?d:null;})(),consultaAnterior:(()=>{const d=$getWorkflowStaticData('global').queryConversations?.[context.chatId+':'+context.senderId];return d?.userId===context.user?.id&&Date.now()-d.at<15*60*1000?d:null;})(),coberturaConsulta:input.queryCoverage??null,"+anchor,1)
node('Preparar conversa para o agente')['parameters']['jsCode']=code;modified.append('Preparar conversa para o agente')
agent=node('AI Agent · intenção financeira');prompt=agent['parameters']['options']['systemMessage']
prompt=prompt.replace('category só pode ser uma categoria expressa na mensagem atual entre Alimentação, Transporte, Moradia, Saúde, Educação, Lazer, Assinaturas, Casamento, Viagem, Outros; caso contrário null.','category deve ser um nome do catálogo verificado categoriasDisponiveis expresso no pedido atual ou no contexto de categoria da mesma pessoa; caso contrário null.')
prompt=prompt.replace('category (uma das categorias já listadas)','category (nome do catálogo verificado da carteira)')
agent['parameters']['options']['systemMessage']=prompt+'\n\n'+text('prompt.txt');modified.append(agent['name'])
intention_model=node('OpenAI Chat Model · intenção em lote');assert intention_model['parameters']['options']['maxTokens']==2200
intention_model['parameters']['options']['maxTokens']=6000;modified.append(intention_model['name'])
conversation_model=node('OpenAI Chat Model · omniroute');assert conversation_model['parameters']['options']['maxTokens']==650
conversation_model['parameters']['options']['maxTokens']=6000;modified.append(conversation_model['name'])
conversation=node('AI Agent · conversa financeira');conversation['parameters']['options']['systemMessage']+='\n\nCategorias novas podem ser criadas e usadas pela conversa. propostaCategoria e consultaAnterior são contexto verificado da mesma pessoa. Não ignore pedidos de categoria nem restrinja a lista antiga. Se faltar o nome, o alvo ou o período, pergunte somente o que falta, sem exigir frase exata. Não anuncie criação, alteração ou totais que o resultado verificado não confirmou. Recorrencia como categoria é somente um rótulo, sem agenda automática.';modified.append(conversation['name'])
conversation['parameters']['options']['systemMessage']+='\n\nRESPOSTA CURTA E COMPLETA: conclua todas as frases e perguntas. Responda com naturalidade em até 2 parágrafos quando não houver lista ou resultado verificado que precise ser preservado. Não repita exemplos, contratos ou raciocínio interno. Mantenha o formato final já solicitado acima: mensagem para a pessoa, sem acrescentar JSON. Nunca corte uma frase, descrição ou valor monetário pela metade; se faltar dado, faça somente a pergunta indispensável.'
guard=node('Resposta verificada?')['parameters']['conditions']['conditions'][0];expr=guard['leftValue'];assert expr.startswith('={{ ')and expr.endswith(' }}')
guard['leftValue']='={{ ('+expr[4:-3]+") || ($json.conversationStatus === 'aguardando_confirmacao' && $json.verifiedCategoryProposal === true) }}";modified.append('Resposta verificada?')
load=rpc('Consultar categorias da carteira','finance_whatsapp_categories',"{p_user_id:$json.user.id,p_action:'list',p_values:Object.fromEntries([])}",[-200,0])
join=newcode('Unir categorias da carteira',text('join-catalog.js'),[0,0])
catif=newif('É gestão de categorias?','category_execute',[2000,0])
save=rpc('Salvar categoria da carteira','finance_whatsapp_categories',"{p_user_id:$json.user.id,p_action:$json.categoryOperation,p_values:$json.categoryValues}",[2200,-200])
catresult=newcode('Confirmar categoria da carteira',common+'\n'+text('pending-category.js')+'\n'+text('existing-category.js')+'\n'+text('category-result.js'),[2400,-200])
queryif=newif('É consulta financeira livre?','query_execute',[2200,0])
query=rpc('Consultar finanças com filtros','finance_whatsapp_query',"{p_user_id:$json.user.id,p_values:$json.queryValues}",[2400,0])
queryresult=newcode('Formatar consulta financeira verificada',common+'\n'+text('query-result.js'),[2600,0])
new=[load,join,catif,save,catresult,queryif,query,queryresult];w['nodes']+=new
updates={'Preparar contexto seguro':{'main':[[edge(load['name'])]]},load['name']:{'main':[[edge(join['name'])]]},join['name']:{'main':[[edge('Consultar contexto financeiro da conversa')]]},'Classificar comando':{'main':[[edge(catif['name'])]]},catif['name']:{'main':[[edge(save['name'])],[edge(queryif['name'])]]},save['name']:{'main':[[edge(catresult['name'])]]},catresult['name']:{'main':[[edge('Preparar conversa para o agente')]]},queryif['name']:{'main':[[edge(query['name'])],[edge('É preferência de voz?')]]},query['name']:{'main':[[edge(queryresult['name'])]]},queryresult['name']:{'main':[[edge('Preparar conversa para o agente')]]}}
w['connections'].update(updates)
for original in before['nodes']:
 patched=node(original['name']);a,b=copy.deepcopy(original),copy.deepcopy(patched)
 if original['name']in modified:
  if original['name'].startswith('AI Agent'):a['parameters']['options'].pop('systemMessage');b['parameters']['options'].pop('systemMessage')
  elif original['name']in['OpenAI Chat Model · intenção em lote','OpenAI Chat Model · omniroute']:a['parameters']['options'].pop('maxTokens');b['parameters']['options'].pop('maxTokens')
  elif original['name']=='Resposta verificada?':a['parameters']['conditions']['conditions'][0].pop('leftValue');b['parameters']['conditions']['conditions'][0].pop('leftValue')
  else:a['parameters'].pop('jsCode');b['parameters'].pop('jsCode')
 assert a==b,original['name']
 assert original.get('credentials')==patched.get('credentials')
expected=copy.deepcopy(before['connections']);expected.update(updates);assert expected==w['connections']
for key in before:
 if key not in['nodes','connections']:assert before[key]==w[key],key
safe=[]
for name in modified+[n['name']for n in new]:
 n=node(name);out={k:copy.deepcopy(n[k])for k in['name','type','typeVersion','onError','retryOnFail','maxTries']if k in n}
 if n['type']=='n8n-nodes-base.httpRequest':
  out['rpc']={'Consultar categorias da carteira':'finance_whatsapp_categories:list','Salvar categoria da carteira':'finance_whatsapp_categories:create','Consultar finanças com filtros':'finance_whatsapp_query'}[name]
  out['rpcBodyExpression']=n['parameters']['jsonBody']
 else:out['parameters']=copy.deepcopy(n['parameters'])
 safe.append(out)
contract={'schemaVersion':1,'baseVersionId':before['versionId'],'nodes':safe,'connections':updates,'published':False}
serialized=json.dumps(contract,ensure_ascii=False,indent=2)+'\n';assert not re.search(r'eyJ[a-zA-Z0-9_-]{16,}\.|55\d{10,11}',serialized)
(HERE/'contract.json').write_text(serialized)
target=PRIVATE/'category-live-proposed.json';target.write_text(json.dumps(w,ensure_ascii=False));target.chmod(0o600)
print(json.dumps({'prepared':True,'modifiedNodes':modified,'newNodes':[n['name']for n in new],'settingsStateAndCredentialsPreserved':True,'proposalSHA256':hashlib.sha256(target.read_bytes()).hexdigest()}))
