"""Prepare a private workflow patch; never activates or makes network calls."""
import argparse,copy,json,pathlib,re,uuid
parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--output',required=True);parser.add_argument('--expected-version',required=True);args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parent
w=json.loads(pathlib.Path(args.source).read_text())
if w.get('activeVersionId')!=args.expected_version:raise SystemExit('Active version changed; inspect the latest workflow first.')
v=w.get('activeVersion')
if not v or not v.get('nodes') or not v.get('connections'):raise SystemExit('An authoritative published version is required.')
nodes=copy.deepcopy(v['nodes']);con=copy.deepcopy(v['connections']);lookup={n['name']:n for n in nodes}
required=['Criar lançamento','Preparar contexto seguro','Classificar comando','Normalizar anexo IA','Interpretar lançamento','Preparar itens do lançamento','Preparar arquivo confirmado','Confirmar lançamento','É transação?','Processar compras','Tem comprovante confirmado?']
if any(name not in lookup for name in required):raise SystemExit('Workflow topology changed; manual review required.')
for n in nodes:
 c=n.get('parameters',{}).get('jsCode')
 if c:n['parameters']['jsCode']=re.sub(r'(pending|recent)(\?\.)?\[([A-Za-z]+)\.chatId\]',lambda m:m[1]+(m[2] or '')+'['+m[3]+'.chatId+\':\'+'+m[3]+'.senderId]',c)
def replace_once(name,old,new):
 c=lookup[name]['parameters']['jsCode']
 if c.count(old)!=1:raise SystemExit('Code contract changed in '+name)
 lookup[name]['parameters']['jsCode']=c.replace(old,new)
replace_once('Normalizar anexo IA','const lines=transactions.map',"context.queueNewProposal=state.pending[context.chatId+':'+context.senderId];\nconst lines=transactions.map")
c=lookup['Interpretar lançamento']['parameters']['jsCode'];marker="state.pending[context.chatId+':'+context.senderId]={transactions:[tx],sourceMessageId:context.messageId,at:Date.now()};"
if c.count(marker)!=2:raise SystemExit('Interpreter contract changed')
lookup['Interpretar lançamento']['parameters']['jsCode']=c.replace(marker,marker+"context.queueNewProposal=state.pending[context.chatId+':'+context.senderId];")
marker="semanticState.pending[x.chatId+':'+x.senderId]={transactions,sourceMessageId:x.messageId,at:Date.now()};"
replace_once('Classificar comando',marker,marker+"x.queueNewProposal=semanticState.pending[x.chatId+':'+x.senderId];")
marker=' const rows=pendingRows(receipt);const categories=categoryNames;'
replace_once('Classificar comando',marker,marker+"if(rows.length>1&&!/\\b(?:todos|todas)\\b/i.test(currentText))return human('Sua fila tem '+rows.length+' itens, total '+br(total(rows))+'. Para confirmar o conjunto, diga “pode registrar todos”. Nenhum item novo foi registrado.','aguardando_confirmacao');")
marker=" if((ai.intent==='confirmar_pendente'||simpleCategoryConfirmation)&&transactions.length)"
replace_once('Classificar comando',marker," const batchCategoryConfirmation=ai.intent==='ajustar_pendente'&&rows.length>1&&category&&!pay&&ai.card_name==null&&!ai.new_transaction&&!(ai.new_transactions?.length)&&new RegExp('^(?:pode registrar|pode salvar|confirmo) (?:todos|todas) na categoria (?:de )?'+escapePattern(plain(category))+'$').test(confirmationText);\n if((ai.intent==='confirmar_pendente'||simpleCategoryConfirmation||batchCategoryConfirmation)&&transactions.length)")
def script(name,file):
 n={'id':str(uuid.uuid4()),'name':name,'type':'n8n-nodes-base.code','typeVersion':2,'position':[0,0],'parameters':{'jsCode':(root/file).read_text()}};nodes.append(n);return n
def http(name,action,context,payload):
 original=lookup['Criar lançamento'];url=original['parameters']['url'].split('/rest/v1/')[0]+'/rest/v1/rpc/finance_pending_queue_action'
 nodes.append({'id':str(uuid.uuid4()),'name':name,'type':'n8n-nodes-base.httpRequest','typeVersion':4.2,'position':[0,0],'parameters':{'method':'POST','url':url,'authentication':'predefinedCredentialType','nodeCredentialType':'supabaseApi','sendBody':True,'specifyBody':'json','jsonBody':"={{ JSON.stringify({p_user_id:"+context+".user.id,p_chat_id:"+context+".chatId,p_sender_id:"+context+".senderId,p_action:"+action+",p_payload:("+payload+")}) }}",'options':{'timeout':20000}},'credentials':copy.deepcopy(original['credentials']),'onError':'continueRegularOutput'})
def link(a,b):con[a]={'main':[[{'node':b,'type':'main','index':0}]]}
lookup['Preparar contexto seguro']['name']='Contexto antes da fila';con['Contexto antes da fila']=con.pop('Preparar contexto seguro');link('Buscar carteira compartilhada','Contexto antes da fila')
http('Carregar fila individual',"'load'","$('Contexto antes da fila').first().json",'{}');link('Contexto antes da fila','Carregar fila individual');script('Preparar contexto seguro','load.js');link('Carregar fila individual','Preparar contexto seguro');link('Preparar contexto seguro','Consultar categorias da carteira')
script('Preparar persistência da fila','prepare-reply.js');http('Persistir fila individual','$json.queueAction',"$('Preparar contexto seguro').first().json",'$json.queuePayload');script('Confirmar persistência da fila','reply-result.js')
false_branch=con['É transação?']['main'][1];con['É transação?']['main'][1]=[{'node':'Preparar persistência da fila','type':'main','index':0}];link('Preparar persistência da fila','Persistir fila individual');link('Persistir fila individual','Confirmar persistência da fila');con['Confirmar persistência da fila']={'main':[false_branch]}
if 'Confirmar categoria da carteira' in con:link('Confirmar categoria da carteira','Preparar persistência da fila')
script('Preparar confirmação da fila','claim.js');http('Reivindicar fila confirmada',"'claim'","$('Preparar contexto seguro').first().json",'$json.queueClaimPayload');script('Confirmar posse da fila','claim-result.js')
condition=copy.deepcopy(lookup['Tem comprovante confirmado?']);condition['id']=str(uuid.uuid4());condition['name']='Fila confirmada?';condition['parameters']={'conditions':{'options':{'caseSensitive':True,'leftValue':'','typeValidation':'strict','version':2},'conditions':[{'id':str(uuid.uuid4()),'leftValue':'={{ $json.queueClaimed }}','rightValue':True,'operator':{'type':'boolean','operation':'true','singleValue':True}}],'combinator':'and'},'options':{}};nodes.append(condition)
con['É transação?']['main'][0]=[{'node':'Preparar confirmação da fila','type':'main','index':0}];link('Preparar confirmação da fila','Reivindicar fila confirmada');link('Reivindicar fila confirmada','Confirmar posse da fila');link('Confirmar posse da fila','Fila confirmada?');con['Fila confirmada?']={'main':[[{'node':'Preparar itens do lançamento','type':'main','index':0}],[{'node':'Preparar conversa para o agente','type':'main','index':0}]]}
for name,file in [('Preparar itens do lançamento','items.js'),('Preparar arquivo confirmado','attachment.js')]:lookup[name]['parameters']['jsCode']=(root/file).read_text()
script('Preparar conclusão da fila','ack.js');http('Concluir fontes confirmadas',"'ack'","$('Preparar contexto seguro').first().json",'$json.queueAckPayload');script('Restaurar resultados da fila','ack-result.js');con['Processar compras']['main'][0]=[{'node':'Preparar conclusão da fila','type':'main','index':0}];link('Preparar conclusão da fila','Concluir fontes confirmadas');link('Concluir fontes confirmadas','Restaurar resultados da fila');link('Restaurar resultados da fila','Confirmar lançamento')
lookup['Confirmar lançamento']['parameters']['jsCode']=lookup['Confirmar lançamento']['parameters']['jsCode'].replace('replyText+=payerNotice;',"replyText+=payerNotice;if(results.some(r=>r.queueAckPending))replyText+='\\nO lançamento foi salvo, mas a conclusão da fila ficou pendente. Não reenvie o pagamento.';")
settings={k:w['settings'][k] for k in ['executionOrder','timezone','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','saveExecutionProgress','executionTimeout'] if k in w['settings']}
payload={'name':w['name'],'nodes':nodes,'connections':con,'settings':settings,'staticData':copy.deepcopy(w.get('staticData') or {})}
pathlib.Path(args.output).write_text(json.dumps(payload));print(json.dumps({'prepared':True,'nodes_before':len(v['nodes']),'nodes_after':len(nodes),'network_calls':0,'activated':False}))
