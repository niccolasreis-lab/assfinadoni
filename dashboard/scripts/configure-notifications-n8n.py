#!/usr/bin/env python3
"""Prepare workflows from a local backup. Never contains API tokens or exports credentials.
Usage: python configure-notifications-n8n.py /tmp/live-backup.json /tmp/output-directory
Publication is separate and requires deployed endpoint verification.
"""
import json, sys, pathlib, copy
source=json.loads(pathlib.Path(sys.argv[1]).read_text()); out=pathlib.Path(sys.argv[2]); out.mkdir(parents=True,exist_ok=True)
nodes=source['nodes']; connections=source['connections']
def node(name): return next(n for n in nodes if n['name']==name)
def link(name,*targets): connections[name]={'main':[[{'node':t,'type':'main','index':0} for t in group] for group in targets]}
def add(name,typ,params,version=2,credentials=None):
 n={'id':name,'name':name,'type':'n8n-nodes-base.'+typ,'typeVersion':version,'position':[1800,900+len(nodes)*10],'parameters':params}
 if credentials:n['credentials']=credentials
 nodes.append(n); return n
supabase_credentials=node('Buscar usuário no Supabase')['credentials']; telegram_credentials=node('Enviar resposta Telegram')['credentials']
def condition(name,field,value):
 n=copy.deepcopy(node('É consulta antes da IA?')); n.update(id=name,name=name); n['parameters']['conditions']['conditions'][0].update(leftValue='={{ $json.'+field+' }}',rightValue=value); nodes.append(n)
def config(name):
 n=add(name,'httpRequest',{'method':'GET','url':'https://jhpappaakmdfxyujnlef.supabase.co/rest/v1/finance_notification_config?singleton=eq.true&select=dispatch_secret','authentication':'predefinedCredentialType','nodeCredentialType':'supabaseApi','options':{'timeout':15000}},4.2,supabase_credentials);return n
def request(name,path,method,body,config_name):
 return add(name,'httpRequest',{'method':method,'url':'https://assfinadoni.vercel.app/api/'+path,'sendHeaders':True,'headerParameters':{'parameters':[{'name':'x-notification-secret','value':"={{ $('"+config_name+"').first().json.dispatch_secret }}"}]},'sendBody':True,'specifyBody':'json','jsonBody':body,'options':{'timeout':90000 if path=='notification-dispatch' else 20000}},4.2)
# Keep the onboarding and attachment paths unchanged. Commands are routed before the AI.
s=node('Decidir estado do usuário')['parameters']['jsCode']
s=s.replace("if(lower==='/saldo')", "if(incoming.mediaKind==='text'&&/^\\/(lembrete|lembretes|pendencias|pagar|validar|cancelar)(?:@[a-z\\d_]+)?(?:\\s|$)/i.test(text))return [{json:{...base,route:'reminder'}}];\nif(lower==='/saldo')")
s=s.replace('Comandos: /saldo, /categorias e /ajuda.', 'Comandos: /saldo, /categorias, /lembretes, /pendencias. Crie com /lembrete DD/MM/AAAA descrição | valor | categoria. Confirme com /pagar CODIGO ou /validar CODIGO valor | categoria; cancele com /cancelar CODIGO.')
node('Decidir estado do usuário')['parameters']['jsCode']=s
condition('É comando de lembrete?','route','reminder')
link('É resposta imediata?', ['Preparar resposta direta'], ['É comando de lembrete?'])
link('É comando de lembrete?', ['Carregar configuração comandos'], ['É consulta antes da IA?'])
config('Carregar configuração comandos')
request('Executar comando lembrete','telegram-reminders','POST',"={{ JSON.stringify({chat_id:$('Decidir estado do usuário').first().json.chatId,update_id:$('Decidir estado do usuário').first().json.messageId,text:$('Decidir estado do usuário').first().json.text}) }}",'Carregar configuração comandos')
link('Carregar configuração comandos',['Executar comando lembrete']);link('Executar comando lembrete',['Resposta comando lembrete'])
add('Resposta comando lembrete','code',{'jsCode':"return [{json:{chatId:$('Decidir estado do usuário').first().json.chatId,replyText:$json.text||'Não consegui configurar agora. Tente novamente.'}}];"})
link('Resposta comando lembrete',['Enviar resposta Telegram'])
# Add bill as a distinct intent. Existing valid financial transactions stay on their old path.
s=node('Preparar análise do Agente')['parameters']['jsCode']
s=s.replace('intent (transaction, summary, clarify ou chat)', 'intent (transaction, bill, summary, clarify ou chat), due_date (AAAA-MM-DD para bill)')
s=s.replace('não aceite data futura.', 'para transações realizadas não aceite data futura. Quando houver intenção explícita de lembrar, agendar ou pagar no futuro, use bill e due_date; isso é um lembrete, nunca uma despesa já realizada. Se a data de vencimento estiver ausente, use clarify. Não classifique como bill uma transação já paga. Para clarify preserve description, amount, category e transaction_type conhecidos; nunca invente dados faltantes.')
node('Preparar análise do Agente')['parameters']['jsCode']=s
s=node('Validar resposta da IA')['parameters']['jsCode']
s=s.replace("const isSummary=", "if(intent==='bill')return [{json:{...source,route:'reminder',reminder:{action:'bill',description:p.description,amount:p.amount,category:p.category,due_date:p.due_date,question:p.question}}}];\nconst isSummary=")
s=s.replace("route:'reply',replyText:question||'Pode me dizer o valor e a categoria?'", "route:['despesa','expense'].includes(String(p.transaction_type||'').toLowerCase())?'reminder':'reply',replyText:question||'É uma despesa ou receita? Pode confirmar os dados?',reminder:{action:'review',description:p.description||source.text,amount:p.amount,category:p.category,transaction_date:p.transaction_date,question:question||'Pode me dizer o valor e a categoria?'}")
s=s.replace("route:'reply',replyText:question||'Pode confirmar o valor, a categoria e o que aconteceu?'", "route:transactionType==='despesa'?'reminder':'reply',replyText:question||'Pode confirmar o tipo, valor e categoria?',reminder:{action:'review',description:desc||source.text,amount:Number.isFinite(amount)&&amount>0?amount:null,category:category||null,transaction_date:validDate?iso:source.today,question:question||'Pode confirmar o valor, a categoria e o que aconteceu?'}")
node('Validar resposta da IA')['parameters']['jsCode']=s
condition('É pendência interpretada?','route','reminder');link('Validar resposta da IA',['É pendência interpretada?']);link('É pendência interpretada?', ['Carregar configuração pendências'], ['É transação válida?'])
config('Carregar configuração pendências');request('Salvar pendência interpretada','telegram-reminders','POST',"={{ JSON.stringify({...$('Validar resposta da IA').first().json.reminder,chat_id:$('Validar resposta da IA').first().json.chatId,update_id:$('Validar resposta da IA').first().json.messageId,text:$('Validar resposta da IA').first().json.text}) }}",'Carregar configuração pendências')
link('Carregar configuração pendências',['Salvar pendência interpretada']);link('Salvar pendência interpretada',['Resposta comando lembrete'])
def payload(name): return {'name':name,'nodes':nodes,'connections':connections,'settings':{'executionOrder':'v1','saveDataSuccessExecution':'none','saveDataErrorExecution':'none','saveManualExecutions':False,'timezone':'America/Sao_Paulo'}}
(out/'telegram-workflow.json').write_text(json.dumps(payload(source['name']),ensure_ascii=False,indent=2))
# Dedicated schedule: dispatch claims are delivered through the existing Telegram credential.
nodes=[];connections={}
add('A cada cinco minutos','scheduleTrigger',{'rule':{'interval':[{'field':'minutes','minutesInterval':5}]}},1.2)
config('Carregar configuração notificações')
request('Despachar notificações','notification-dispatch','POST','{}', 'Carregar configuração notificações')
add('Separar entregas Telegram','code',{'jsCode':"return ($json.deliveries||[]).map(d=>({json:d}));"})
request('Revalidar entrega','notification-dispatch','POST',"={{ JSON.stringify({id:$json.id,lease_token:$json.lease_token,action:'check'}) }}",'Carregar configuração notificações')
add('Entregas ainda pendentes','code',{'mode':'runOnceForEachItem','jsCode':"return $json.delivery ? {json:$json.delivery} : null;"})
add('Enviar alerta discreto','telegram',{'chatId':'={{ $json.chat_id }}','text':'={{ $json.text }}','additionalFields':{'appendAttribution':False,'disable_web_page_preview':True}},1.2,telegram_credentials)['onError']='continueRegularOutput'
request('Confirmar entrega','notification-dispatch','PATCH',"={{ JSON.stringify({id:$('Entregas ainda pendentes').item.json.id,lease_token:$('Entregas ainda pendentes').item.json.lease_token,success:!$json.error}) }}",'Carregar configuração notificações')
link('A cada cinco minutos',['Carregar configuração notificações']);link('Carregar configuração notificações',['Despachar notificações']);link('Despachar notificações',['Separar entregas Telegram']);link('Separar entregas Telegram',['Revalidar entrega']);link('Revalidar entrega',['Entregas ainda pendentes']);link('Entregas ainda pendentes',['Enviar alerta discreto']);link('Enviar alerta discreto',['Confirmar entrega'])
(out/'notification-scheduler.json').write_text(json.dumps(payload('Assistente financeiro — notificações'),ensure_ascii=False,indent=2))
print('Prepared workflows; no live changes performed.')
