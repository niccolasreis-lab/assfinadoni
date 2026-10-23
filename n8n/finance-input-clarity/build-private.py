"""Prepare a minimal classifier/prompt overlay from an explicitly reviewed snapshot."""
import argparse,copy,hashlib,json,pathlib,re
HERE=pathlib.Path(__file__).resolve().parent
PRIVATE=HERE.parents[2]/'n8n-work'
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--source',type=pathlib.Path,default=PRIVATE/'finance-clarity-base.json')
args=p.parse_args()
before=json.loads(args.source.read_text());after=copy.deepcopy(before)
node=lambda w,name:next(n for n in w['nodes']if n['name']==name)
original=node(before,'Classificar comando')['parameters']['jsCode']
assert 'Cancellation charges are not income'not in original
boundary="if(x.mediaKind==='text'&&x.intentInput&&(!ai||typeof ai.intent!=='string'))"
assert original.count(boundary)==1
updated=original.replace(boundary,(HERE/'recurrence-fallback.js').read_text()+'\n'+boundary,1)
anchor="  const category=cats.find(c=>plain(c)===plain(draft.category))||'Outros';"
assert updated.count(anchor)==1
updated=updated.replace(anchor,(HERE/'cancellation-guard.js').read_text()+anchor,1)
node(after,'Classificar comando')['parameters']['jsCode']=updated
prompt=node(after,'AI Agent · intenção financeira')['parameters']['options']['systemMessage']
node(after,'AI Agent · intenção financeira')['parameters']['options']['systemMessage']=prompt+'\n\n'+(HERE/'prompt.txt').read_text()
for old in before['nodes']:
 new=node(after,old['name'])
 a,b=copy.deepcopy(old),copy.deepcopy(new)
 if old['name']=='Classificar comando':a['parameters'].pop('jsCode');b['parameters'].pop('jsCode')
 if old['name']=='AI Agent · intenção financeira':a['parameters']['options'].pop('systemMessage');b['parameters']['options'].pop('systemMessage')
 assert a==b,old['name']
assert before['connections']==after['connections']
for key in before:
 if key!='nodes':assert before[key]==after[key],key
target=PRIVATE/'finance-input-clarity-proposed.json';target.write_text(json.dumps(after,ensure_ascii=False));target.chmod(0o600)
contract={'schemaVersion':1,'baseVersionId':before['versionId'],'nodes':[{'name':'Classificar comando','parameters':{'jsCode':updated}}],'promptDelta':(HERE/'prompt.txt').read_text(),'published':False}
safe=json.dumps(contract,ensure_ascii=False,indent=2)+'\n'
assert not re.search(r'eyJ[a-zA-Z0-9_-]{16,}\.|55\d{10,11}|https?://',safe)
(HERE/'contract.json').write_text(safe)
print(json.dumps({'prepared':True,'modifiedNodes':['Classificar comando','AI Agent · intenção financeira'],'connectionsAndStatePreserved':True,'proposalSHA256':hashlib.sha256(target.read_bytes()).hexdigest()}))
