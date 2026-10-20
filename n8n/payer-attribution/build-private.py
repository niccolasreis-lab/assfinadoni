"""Build a private n8n proposal. Never publish or copy credentials into Git."""
import copy,json,pathlib,re,uuid
HERE=pathlib.Path(__file__).resolve().parent
# The checkout may have a task-specific name; private input is outside this repository.
PRIVATE=HERE.parents[2]/'n8n-work'
source=PRIVATE/'payer-live-before.json'
w=json.loads(source.read_text())
original=copy.deepcopy(w)
def node(name):return next(n for n in w['nodes'] if n['name']==name)
def replace_once(text,old,new):
 if text.count(old)!=1:raise RuntimeError('Expected one reviewed code anchor: '+old[:80])
 return text.replace(old,new,1)
def edge(name):return {'node':name,'type':'main','index':0}
def code_node(name,code,position):return {'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'finance-payer:'+name)),'name':name,'type':'n8n-nodes-base.code','typeVersion':2,'position':position,'parameters':{'jsCode':code}}
modified=[]
# Read-only contextual RPC. Copy the existing private Supabase auth configuration.
context=copy.deepcopy(node('Consultar preferências de voz'))
context.update(id=str(uuid.uuid5(uuid.NAMESPACE_URL,'finance-payer:context')),name='Consultar contexto de pagadores',position=[850,1350],onError='continueRegularOutput',retryOnFail=False)
context['parameters']['url']=context['parameters']['url'].rsplit('/',1)[0]+'/finance_whatsapp_payer_context'
context['parameters']['jsonBody']="={{ JSON.stringify({p_user_id:$json.user?.id||null,p_sender_jid:$json.senderId,p_transaction_ids:($json.ledgerContext||[]).filter(r=>r.user_id===$json.user?.id&&/^[0-9a-f-]{36}$/i.test(String(r.id))).slice(0,50).map(r=>r.id)}) }}"
context['parameters'].setdefault('options',{})['timeout']=5000
join=code_node('Unir contexto de pagadores',(HERE/'context-join.js').read_text(),[1050,1350])
w['nodes'] += [context,join]
w['connections']['Unir preferências de voz']={'main':[[edge(context['name'])]]}
w['connections'][context['name']]={'main':[[edge(join['name'])]]}
w['connections'][join['name']]={'main':[[edge('Mensagem é áudio?')]]}
modified += [context['name'],join['name']]
# Both text and audio recover the same verified payer context.
intent=node('Preparar intenção financeira')['parameters']['jsCode']
intent=replace_once(intent,'const context = $input.first().json;',"const context = $input.first().json;\nconst payerContext=$('Unir contexto de pagadores').first().json.payerContext||{available:false,participants:[],attributions:[]};")
intent=replace_once(intent,'...context,voiceContext,insightContext,ledgerContext:catalog','...context,payerContext,voiceContext,insightContext,ledgerContext:catalog')
intent=replace_once(intent,'intentInput:JSON.stringify({preferenciasVoz:',"intentInput:JSON.stringify({contextoDePagadores:{available:payerContext.available,actor_participant_id:payerContext.actor_participant_id??null,participants:payerContext.participants??[]},preferenciasVoz:")
node('Preparar intenção financeira')['parameters']['jsCode']=intent
modified.append('Preparar intenção financeira')
node('AI Agent · intenção financeira')['parameters']['options']['systemMessage']+='\n\n'+(HERE/'prompt.txt').read_text()
modified.append('AI Agent · intenção financeira')
# Reviewed insertions preserve the financial classifier and confirmation contract.
classify=node('Classificar comando')['parameters']['jsCode']
classify=replace_once(classify,"const personQuery=plain(x.text||'');",(HERE/'payer-helpers.js').read_text()+"\nconst personQuery=plain(x.text||'');\n"+(HERE/'person-query-people.js').read_text())
classify=replace_once(classify,r'/\b(?:ionara|narinha|guiga|nara|nicolas|nic)\b/.test(personQuery)',r'(/\b(?:ionara|narinha|guiga|nara|nicolas|nic)\b/.test(personQuery)||payerQueryPeople.length>0)')
start=classify.index('if(/\\b(?:despesas?|gastos?|lancamentos?)\\b/.test(personQuery)')
body=classify.index('{\n',start)
end=classify.index('\nconst activeProposal=',body)
classify=classify[:body+2]+(HERE/'person-query.js').read_text()+'}\n'+classify[end:]
old="transactions.push({amount:amount.toFixed(2),description,category,transaction_date:date,transaction_type:draft.transaction_type,payment_details:pay||{}});"
new="""const payer=payerProposal(draft);
  if(!payer)return human('Preciso esclarecer quem pagou uma das despesas antes de preparar o lote. Pode indicar o pagador de cada item? Nenhum item novo foi registrado.','conversa');
  const expensePayer=draft.transaction_type==='despesa'?payer:{kind:'unknown',participant_ids:[]};
  const payerLabel=expensePayer.kind==='unknown'?'não identificado':expensePayer.participant_ids.map(id=>payerName(payerPerson(id).display_name)).join(' + ')+(expensePayer.kind==='joint'?' (pagamento conjunto)':'');
  transactions.push({amount:amount.toFixed(2),description,category,transaction_date:date,transaction_type:draft.transaction_type,payment_details:pay||{},payer:expensePayer,payerLabel,payerFrozenVersion:1});"""
classify=replace_once(classify,old,new)
classify=replace_once(classify," const rows=pendingRows(receipt);const categories="," if(ai.payer_change_requested===true)return human('Para trocar quem pagou, preciso preparar uma nova proposta e confirmar essa mudança antes de salvar. A proposta atual não foi alterada. Pode indicar a despesa e o pagador correto?','aguardando_confirmacao');\n const rows=pendingRows(receipt);const categories=")
# Both initial and category/payment-adjusted proposals keep the exact frozen payer per row.
line="(${tx.category}${tx.payment_details?.method?', '+tx.payment_details.method:''})`"
if classify.count(line)!=1:raise RuntimeError('Unexpected initial proposal presentation anchor')
classify=classify.replace(line,"(${tx.category}${tx.payment_details?.method?', '+tx.payment_details.method:''})${payerText(tx)}`",1)
line2="(${t.category}${t.payment_details?.method?', '+t.payment_details.method:''})`"
if classify.count(line2)!=1:raise RuntimeError('Unexpected adjusted proposal presentation anchor')
classify=classify.replace(line2,"(${t.category}${t.payment_details?.method?', '+t.payment_details.method:''})${payerText(t)}`",1)
node('Classificar comando')['parameters']['jsCode']=classify
modified.append('Classificar comando')
# The existing hash expressions and order are intentionally byte-for-byte unchanged.
items=node('Preparar itens do lançamento')['parameters']['jsCode']
items=replace_once(items,'sourceMessageId:source,recordKey:',"sourceMessageId:source,sourceEventId:`wa:${source}:${index}`,confirmationSenderId:x.senderId,payerConfirmed:x.pendingConfirmation===true&&tx.payerFrozenVersion===1,recordedByParticipantId:null,recordKey:")
node('Preparar itens do lançamento')['parameters']['jsCode']=items
modified.append('Preparar itens do lançamento')
fields=node('Criar lançamento')['parameters']['fieldsUi']['fieldValues']
if any(f['fieldId'] in ('source','external_event_id') for f in fields):raise RuntimeError('Source already configured; review current workflow')
fields.extend([{'fieldId':'source','fieldValue':'API'},{'fieldId':'external_event_id','fieldValue':"={{ $('Processar compras').item.json.sourceEventId }}"}])
modified.append('Criar lançamento')
result=node('Resultado do registro')['parameters']['jsCode']
result=replace_once(result,"status:valid?'registrado':'falha',savedId:","status:valid?'registrado':'falha',attributionEligible:valid&&row.transaction_type==='despesa'&&row.source==='API'&&row.external_event_id===current.sourceEventId,savedId:")
node('Resultado do registro')['parameters']['jsCode']=result
modified.append('Resultado do registro')
dup=node('Responder duplicidade')['parameters']['jsCode']
dup=replace_once(dup,"status:'duplicado',savedId:row.id","status:'duplicado',attributionEligible:!!row.id&&row.transaction_type==='despesa'&&row.source==='API'&&row.external_event_id===current.sourceEventId,savedId:row.id")
node('Responder duplicidade')['parameters']['jsCode']=dup
modified.append('Responder duplicidade')
# Isolated metadata hook: no retry, no route back to the financial insert.
prepare=code_node('Preparar identificação confirmada',(HERE/'prepare-metadata.js').read_text(),[4580,1120])
gate={'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'finance-payer:gate')),'name':'Salvar identificação confirmada?','type':'n8n-nodes-base.if','typeVersion':2.2,'position':[4780,1120],'parameters':{'conditions':{'options':{'caseSensitive':True,'leftValue':'','typeValidation':'strict','version':2},'conditions':[{'leftValue':'={{ $json.shouldPersistPayer === true }}','rightValue':True,'operator':{'type':'boolean','operation':'true','singleValue':True}}],'combinator':'and'},'options':{}}}
save=copy.deepcopy(node('Salvar preferência financeira'))
save.update(id=str(uuid.uuid5(uuid.NAMESPACE_URL,'finance-payer:set')),name='Salvar pagador confirmado',position=[4980,1120],onError='continueRegularOutput',retryOnFail=False)
save['parameters']['url']=save['parameters']['url'].rsplit('/',1)[0]+'/finance_whatsapp_set_payer'
save['parameters']['jsonBody']="={{ JSON.stringify({p_user_id:$json.userId,p_sender_jid:$json.confirmationSenderId,p_transaction_id:$json.savedId,p_source_event:$json.sourceEventId,p_kind:$json.tx.payer.kind,p_participant_ids:$json.tx.payer.participant_ids,p_confirmed:$json.payerConfirmed===true}) }}"
save['parameters'].setdefault('options',{})['timeout']=5000
check=code_node('Conferir identificação salva',(HERE/'metadata-result.js').read_text(),[5180,1120])
w['nodes'] += [prepare,gate,save,check]
for name in ['Resultado do registro','Responder duplicidade']:w['connections'][name]={'main':[[edge(prepare['name'])]]}
w['connections'][prepare['name']]={'main':[[edge(gate['name'])]]}
w['connections'][gate['name']]={'main':[[edge(save['name'])],[edge('Processar compras')]]}
w['connections'][save['name']]={'main':[[edge(check['name'])]]}
w['connections'][check['name']]={'main':[[edge('Processar compras')]]}
modified += [prepare['name'],gate['name'],save['name'],check['name']]
confirm=node('Confirmar lançamento')['parameters']['jsCode']
anchor="const failed=results.filter(x=>!['registrado','duplicado'].includes(x.status));"
confirm=replace_once(confirm,anchor,anchor+"\nconst payerPending=results.filter(x=>['registrado','duplicado'].includes(x.status)&&x.tx?.payerFrozenVersion===1&&['participant','joint'].includes(x.tx?.payer?.kind)&&x.attributionStatus==='pending');\nconst payerNotice=payerPending.length?'\\nA identificação de quem pagou ficou pendente em '+payerPending.length+' item(ns). Os lançamentos financeiros já confirmados foram preservados; não reenvie os pagamentos para corrigir essa identificação.':'';")
partial="Diga “pode registrar” para tentar as que faltam sem duplicar as confirmadas.`,financialStatus:"
confirm=replace_once(confirm,partial,"Diga “pode registrar” para tentar as que faltam sem duplicar as confirmadas.`+payerNotice,financialStatus:")
confirm=replace_once(confirm,'const replyText=saved.length?', 'let replyText=saved.length?')
confirm=replace_once(confirm,"return [{json:{replyText,financialStatus:saved.length?", "replyText+=payerNotice;\nreturn [{json:{replyText,financialStatus:saved.length?")
node('Confirmar lançamento')['parameters']['jsCode']=confirm
modified.append('Confirmar lançamento')
# Financial proposals with frozen payer labels must not be paraphrased by another model.
guard=node('Resposta verificada?')['parameters']['conditions']['conditions'][0]
expr=guard['leftValue']
if not expr.startswith('={{ ') or not expr.endswith(' }}'):raise RuntimeError('Unexpected verified-reply expression')
guard['leftValue']='={{ ('+expr[4:-3]+") || ($json.conversationStatus === 'aguardando_confirmacao' && ($json.pendingProposal?.transactions || []).some(t => t.payerFrozenVersion === 1)) }}"
modified.append('Resposta verificada?')
# Preserve existing staticData, credentials, settings, voice and watchdog nodes.
assert w['staticData']==original['staticData']
assert w['settings']==original['settings']
for n in original['nodes']:
 if n['name'] not in modified:assert node(n['name'])==n,'Unexpected node change: '+n['name']
for n in original['nodes']:assert node(n['name']).get('credentials')==n.get('credentials')
private=PRIVATE/'payer-live-proposed.json';private.write_text(json.dumps(w));private.chmod(0o600)
# Export parameters and code only; HTTP auth and URLs are rebuilt privately.
safe=[]
for name in modified:
 n=node(name);item={k:copy.deepcopy(n[k]) for k in ['name','type','typeVersion','parameters','onError','retryOnFail'] if k in n}
 if n['type']=='n8n-nodes-base.httpRequest':
  item['parameters'].pop('headerParameters',None);item['parameters']['url']='__PRESERVE_EXISTING_SUPABASE_RPC_ORIGIN__/'+('finance_whatsapp_payer_context' if name==context['name'] else 'finance_whatsapp_set_payer')
 safe.append(item)
connections={k:v for k,v in w['connections'].items() if k in ['Unir preferências de voz',context['name'],join['name'],'Resultado do registro','Responder duplicidade',prepare['name'],gate['name'],save['name'],check['name']]}
contract={'schemaVersion':1,'baseVersionId':original['versionId'],'nodes':safe,'connections':connections,'preserveStaticData':True,'preserveCredentials':True,'newTransactionSource':'API','published':False}
text=json.dumps(contract,ensure_ascii=False,indent=2)+'\n'
if re.search(r'eyJ[a-zA-Z0-9_-]{16,}\.',text) or re.search(r'55\d{10,11}',text):raise RuntimeError('Possible secret or phone found in contract')
(HERE/'contract.json').write_text(text)
print(json.dumps({'privateProposalCreated':True,'modifiedNodes':modified,'staticDataPreserved':True,'existingCredentialsPreserved':True,'published':False}))
