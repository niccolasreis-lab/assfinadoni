"""Prepare outgoing voice inside the principal workflow. No API calls or publication."""
import copy, hashlib, json, pathlib, re, uuid
HERE=pathlib.Path(__file__).resolve().parent
PRIVATE=HERE.parents[2]/'n8n-work'
original=json.loads((PRIVATE/'audio-main-before.json').read_text());w=copy.deepcopy(original)
def node(name):return next(n for n in w['nodes'] if n['name']==name)
def edge(name):return {'node':name,'type':'main','index':0}
def code_node(name,file,position):
 return {'id':str(uuid.uuid5(uuid.NAMESPACE_URL,'finance-outgoing-voice:'+name)),'name':name,'type':'n8n-nodes-base.code','typeVersion':2,'position':position,'parameters':{'mode':'runOnceForEachItem','jsCode':(HERE/file).read_text()}}
files={'Autorizar resumo falado solicitado':'authorize.js','Preparar fala do Bot do Ni':'prepare.js','Validar áudio gerado':'validate.js','Confirmar resultado da voz':'result.js','Marcar falha da voz':'preparation-failure.js'}
modified=list(files)
for name,file in files.items():node(name)['parameters']['jsCode']=(HERE/file).read_text()
agent=node('AI Agent · intenção financeira')
agent['parameters']['options']['systemMessage']+='\n\n'+(HERE/'prompt.txt').read_text()
modified.append(agent['name'])
tts=node('Gerar voz consistente');tts.update(retryOnFail=True,maxTries=2,waitBetweenTries=2000)
assert tts['parameters']['options']['timeout']==45000
modified.append(tts['name'])
ready=copy.deepcopy(node('Áudio está pronto?'));ready.update(id=str(uuid.uuid5(uuid.NAMESPACE_URL,'finance-outgoing-voice:speech-ready')),name='Fala pronta?',position=[2800,1500])
ready['parameters']['conditions']['conditions'][0]['leftValue']='={{ $json.speechReady === true }}'
checkfail=code_node('Preparar falha de autorização da voz','check-failure.js',[3400,1750])
beforeack=code_node('Preparar resultado seguro da voz','before-ack.js',[4000,1500])
notice=code_node('Preparar aviso da voz','notice.js',[4400,1500])
notify=copy.deepcopy(node('Responder WhatsApp'));notify.update(id=str(uuid.uuid5(uuid.NAMESPACE_URL,'finance-outgoing-voice:notice')),name='Enviar aviso da voz',position=[4600,1500],retryOnFail=False,onError='continueRegularOutput')
notify['parameters']['jsonBody']="={{ JSON.stringify({number:$json.chatId,text:$json.replyText,delay:1500}) }}"
new=[ready,checkfail,beforeack,notice,notify];w['nodes']+=new
updates={
 'Preparar fala do Bot do Ni':{'main':[[edge(ready['name'])]]},
 ready['name']:{'main':[[edge('Gerar voz consistente')],[edge('Marcar falha da voz')]]},
 'Voz continua autorizada?':{'main':[[edge('Restaurar áudio autorizado')],[edge(checkfail['name'])]]},
 'Confirmar resultado da voz':{'main':[[edge(beforeack['name'])]]},
 'Marcar falha da voz':{'main':[[edge(beforeack['name'])]]},
 checkfail['name']:{'main':[[edge(beforeack['name'])]]},
 beforeack['name']:{'main':[[edge('Registrar resultado da voz')]]},
 'Registrar resultado da voz':{'main':[[edge(notice['name'])]]},
 notice['name']:{'main':[[edge(notify['name'])]]},
}
w['connections'].update(updates)
# All unrelated routes, financial/image/payer nodes, watchdog reference, state and settings remain intact.
for n in original['nodes']:
 after=node(n['name'])
 if n['name'] not in modified:assert after==n,'Unexpected existing node edit: '+n['name']
 elif n['name']==tts['name']:
  old,patched=copy.deepcopy(n),copy.deepcopy(after)
  for k in ['retryOnFail','maxTries','waitBetweenTries']:old.pop(k,None);patched.pop(k,None)
  assert old==patched
 elif n['name'] in files:
  old,patched=copy.deepcopy(n),copy.deepcopy(after)
  old['parameters'].pop('jsCode');patched['parameters'].pop('jsCode');assert old==patched
 elif n['name']==agent['name']:
  old,patched=copy.deepcopy(n),copy.deepcopy(after)
  old['parameters']['options'].pop('systemMessage');patched['parameters']['options'].pop('systemMessage');assert old==patched
 assert after.get('credentials')==n.get('credentials')
assert notify.get('credentials')==node('Responder WhatsApp').get('credentials')
for key in original:
 if key not in ['nodes','connections']:assert w[key]==original[key],key
expected=copy.deepcopy(original['connections']);expected.update(updates);assert expected==w['connections']
assert node('Enviar áudio do Bot do Ni').get('retryOnFail') is False
assert notify.get('retryOnFail') is False
private=PRIVATE/'audio-main-proposed.json';private.write_text(json.dumps(w,ensure_ascii=False));private.chmod(0o600)
safe=[]
for name in modified+[n['name'] for n in new]+['Enviar áudio do Bot do Ni','Registrar resultado da voz']:
 n=node(name);out={k:copy.deepcopy(n[k]) for k in ['name','type','typeVersion','onError','retryOnFail','maxTries','waitBetweenTries'] if k in n}
 if n['type']=='n8n-nodes-base.httpRequest':out['parameters']={'options':{'timeout':n['parameters'].get('options',{}).get('timeout')}}
 else:out['parameters']=copy.deepcopy(n['parameters'])
 safe.append(out)
contract={'schemaVersion':1,'baseVersionId':original['versionId'],'nodes':safe,'connections':updates,'preserveWatchdog':True,'published':False}
text=json.dumps(contract,ensure_ascii=False,indent=2)+'\n'
assert not re.search(r'eyJ[a-zA-Z0-9_-]{16,}\.|55\d{10,11}',text)
(HERE/'contract.json').write_text(text)
print(json.dumps({'privateProposalCreated':True,'baseVersionId':original['versionId'],'modifiedNodes':modified,'newNodes':[n['name'] for n in new],'preservedWatchdog':True,'preservedStaticData':True,'preservedCredentials':True,'published':False,'proposalSHA256':hashlib.sha256(private.read_bytes()).hexdigest()}))
