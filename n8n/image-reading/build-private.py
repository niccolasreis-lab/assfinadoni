"""Build the privately validated Gemini image route. No network or publication."""
import argparse, copy, hashlib, json, pathlib, re
HERE = pathlib.Path(__file__).resolve().parent
PRIVATE = HERE.parents[2] / 'n8n-work'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source',type=pathlib.Path,default=PRIVATE/'image-reviewed-base.json',help='Explicit reviewed private workflow base; never a raw inactive draft.')
args = parser.parse_args()
original = json.loads(args.source.read_text())
w = copy.deepcopy(original)
def node(workflow, name):
    return next(n for n in workflow['nodes'] if n['name'] == name)
modified_code = ['Preparar anexo IA','Normalizar anexo IA']
modified = modified_code + ['Resposta verificada?','Ler anexo com Gemini']
node(w,modified_code[0])['parameters']['jsCode'] = (HERE/'prepare-attachment.js').read_text()
node(w,modified_code[1])['parameters']['jsCode'] = (HERE/'normalize-image.js').read_text()
# Preserve a verified attachment proposal verbatim, including its date warning.
guard = node(w,'Resposta verificada?')['parameters']['conditions']['conditions'][0]
expr = guard['leftValue']
assert expr.startswith('={{ ') and expr.endswith(' }}')
assert 'verifiedAttachmentProposal' not in expr
attachment_condition = "($json.conversationStatus === 'aguardando_confirmacao' && $json.verifiedAttachmentProposal === true)"
guard['leftValue'] = '={{ ('+expr[4:-3]+') || '+attachment_condition+' }}'
# One bounded retry for the read-only vision request, never finance or delivery.
vision = node(w,'Ler anexo com Gemini')
vision.update(retryOnFail=True,maxTries=2,waitBetweenTries=2000)
# Existing multimodal route was verified with the real image in isolated native QA.
route = w['connections']['Anexo é imagem?']['main']
assert route[0] == [{'node':'Preparar imagem para OpenAI','type':'main','index':0}]
assert route[1] == [{'node':'Preparar anexo IA','type':'main','index':0}]
route[0] = [{'node':'Preparar anexo IA','type':'main','index':0}]
expected_connections = copy.deepcopy(original['connections'])
expected_connections['Anexo é imagem?']['main'][0] = copy.deepcopy(route[0])
assert w['connections'] == expected_connections
# All HTTP URLs/models/credentials, timeouts, old OpenAI nodes, converter,
# finance logic and state remain exactly as captured in the reviewed base.
for before in original['nodes']:
    after = node(w,before['name'])
    if before['name'] not in modified:
        assert before == after, before['name']
    else:
        before_copy, after_copy = copy.deepcopy(before), copy.deepcopy(after)
        if before['name'] in modified_code:
            before_copy['parameters'].pop('jsCode');after_copy['parameters'].pop('jsCode')
        elif before['name'] == 'Resposta verificada?':
            before_copy['parameters']['conditions']['conditions'][0].pop('leftValue')
            after_copy['parameters']['conditions']['conditions'][0].pop('leftValue')
        else:
            assert after['parameters'] == before['parameters']
            assert after.get('credentials') == before.get('credentials')
            assert {key:after[key] for key in ['retryOnFail','maxTries','waitBetweenTries']} == {'retryOnFail':True,'maxTries':2,'waitBetweenTries':2000}
            for key in ['retryOnFail','maxTries','waitBetweenTries']:
                before_copy.pop(key,None);after_copy.pop(key,None)
        assert before_copy == after_copy
for key in original:
    if key not in ['nodes','connections']: assert original[key] == w[key], key
private = PRIVATE/'image-live-proposed.json'
private.write_text(json.dumps(w,ensure_ascii=False));private.chmod(0o600)
def contract(workflow, preparer):
    safe_nodes = [{'name':name,'parameters':{'jsCode':node(workflow,name)['parameters']['jsCode']}}
                  for name in ['Converter mídia',preparer,'Normalizar anexo IA','Preparar conversa para o agente','Usar resposta verificada']]
    safe_nodes.append({'name':'Resposta verificada?','parameters':copy.deepcopy(node(workflow,'Resposta verificada?')['parameters'])})
    vision = node(workflow,'Ler anexo com Gemini')
    safe_nodes.append({'name':'Ler anexo com Gemini',**{key:vision[key] for key in ['retryOnFail','maxTries','waitBetweenTries'] if key in vision}})
    return {'schemaVersion':1,'baseVersionId':original['versionId'],
            'imagePreparationNode':preparer,'imageNormalizationNode':'Normalizar anexo IA',
            'verifiedImageEngine':'gemini','nodes':safe_nodes,
            'connections':{'Anexo é imagem?':copy.deepcopy(workflow['connections']['Anexo é imagem?'])},
            'published':False}
for filename,data in [('baseline-contract.json',contract(original,'Preparar imagem para OpenAI')),('contract.json',contract(w,'Preparar anexo IA'))]:
    text = json.dumps(data,ensure_ascii=False,indent=2)+'\n'
    assert not re.search(r'eyJ[a-zA-Z0-9_-]{16,}\.|55\d{10,11}',text)
    (HERE/filename).write_text(text)
print(json.dumps({'privateProposalCreated':True,'modifiedNodes':modified,'modifiedImageRoute':True,
                  'baseVersionId':original['versionId'],'activeVersionId':original.get('activeVersionId'),
                  'unchangedHttpConfiguration':True,'preservedStaticData':True,
                  'visionRetryBudget':{'maxTries':2,'waitBetweenTries':2000},
                  'preservedCredentials':True,'published':False,
                  'proposalSHA256':hashlib.sha256(private.read_bytes()).hexdigest()}))
