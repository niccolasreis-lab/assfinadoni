import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssistantInput, sniffFile, MAX_FILE_BYTES } from '../lib/assistant.js';
import { normalizeInterpretation } from '../worker/interpret.js';
import { extractPdf, MediaError } from '../worker/media.js';
import { processJob } from '../worker/index.js';
import { callJev, gateAllows, normalizeJevAnswers, qualityNeedsRepair } from '../worker/jev.js';
const id='11111111-1111-4111-8111-111111111111';
const transaction={transaction_type:'despesa',amount:45,category:'Alimentação',description:'Almoço',transaction_date:'2026-09-15',payment_status:'paid',perspective:'buyer'};
test('valida arquivos pelo conteúdo, limita tamanho e ignora identidade enviada pelo cliente',()=>{
 const input=validateAssistantInput({request_id:id,user_id:'attacker',text:'',file:{name:'recibo.pdf',base64:Buffer.from('%PDF-1.7\nfixture').toString('base64')}});
 assert.equal(input.payload.file.kind,'pdf');assert.equal(input.payload.user_id,undefined);assert.match(input.hash,/^[a-f0-9]{64}$/);
 assert.throws(()=>validateAssistantInput({request_id:id,file:{name:'recibo.pdf',base64:Buffer.from('<script>attack</script>').toString('base64')}}));
 assert.throws(()=>validateAssistantInput({request_id:id,file:{name:'big.pdf',base64:Buffer.alloc(MAX_FILE_BYTES+1).toString('base64')}}));
 assert.throws(()=>validateAssistantInput({request_id:id,action:'confirm',confirmation_id:'bad'}));
 assert.equal(sniffFile(Buffer.from('OggSfixture')).ext,'ogg');
});
test('não transforma documento não pago, perspectiva incerta ou baixa confiança em despesa',()=>{
 for(const patch of [{payment_status:'unknown'},{perspective:'unknown'}])assert.equal(normalizeInterpretation({action:'create',confidence:1,transactions:[{...transaction,...patch}]},{kind:'pdf'}).operation.action,'chat');
 assert.equal(normalizeInterpretation({action:'create',confidence:.5,transactions:[transaction]}).operation.action,'chat');
 assert.equal(normalizeInterpretation({action:'create',confidence:1,transactions:[transaction]},{kind:'pdf'}).operation.action,'create');
 assert.equal(normalizeInterpretation({action:'create',confidence:1,transactions:[{...transaction,perspective:'salary'}]}).operation.transactions[0].transaction_type,'receita');
});
test('alteração/exclusão exige ID conhecido e não é autorizada por instruções em PDF',()=>{
 for(const action of ['update','delete']) {
  assert.equal(normalizeInterpretation({action,confidence:1,target_id:id,transactions:[transaction]}).operation.action,'chat');
  assert.equal(normalizeInterpretation({action,confidence:1,target_id:id,transactions:[transaction]},{kind:'pdf',transactions:[{id}]}).operation.action,'chat');
  assert.equal(normalizeInterpretation({action,confidence:1,target_id:id,transactions:[transaction]},{kind:'text',transactions:[{id}]}).operation.action,action);
 }
 assert.equal(normalizeInterpretation({action:'chat',reply:'Lançamento registrado.'}).text.includes('Ainda não'),true);
});
test('PDF misto extrai texto por página e usa visão apenas onde necessário',async()=>{
 const calls=[];const text='Recibo de pagamento da compra no estabelecimento Mercado Teste em 15/09/2026. Total pago R$ 45,00.';
 const result=await extractPdf('/tmp/input.pdf','/tmp',{execute:async(cmd,args)=>{calls.push([cmd,args]);return{stdout:cmd==='pdfinfo'?'Pages: 2\nEncrypted: no':cmd==='pdftotext'&&args[1]==='1'?text:''}},read:async()=>Buffer.from('image'),readImage:async()=>'Recibo digitalizado R$ 12,50'});
 assert.match(result,/Página 1/);assert.match(result,/Página 2/);assert.equal(calls.filter(([c])=>c==='pdftoppm').length,1);
});
test('recusa PDF protegido, corrompido e acima de dez páginas',async()=>{
 for(const stdout of ['Pages: 11\nEncrypted: no','Pages: 1\nEncrypted: yes','invalid'])await assert.rejects(extractPdf('x','y',{execute:async()=>({stdout})}),MediaError);
});
test('worker não anuncia sucesso se a interpretação falhar e finaliza sem mutação',async()=>{
 const operations=[];
 await processJob({id,user_id:id,lease_token:id,payload:{text:'gastei 45'}},{database:async()=>[],analyze:async()=>{throw Error('unavailable')},call:async(_name,p)=>{operations.push(p);return{status:'failed'}}});
 assert.equal(operations.length,1);assert.equal(operations[0].p_operation.action,'error');
});
test('normaliza decisões Jev e aplica limites configuráveis',()=>{
 const decision=normalizeJevAnswers({model:'typesafe/jev-1.13',answers:{
  request_understood:{type:'noul',noul:.98},safe_to_execute:{type:'noul',noul:.99},
  next_step:{type:'choice',choice:'execute'},fulfilled:{type:'noul',noul:.88},reply_truthful:{type:'noul',noul:.91},
 },usage:{cost:.0001}}, {kind:'quality',latencyMs:12});
 assert.equal(decision.route,'execute');assert.equal(decision.understood,.98);assert.equal(decision.safe,.99);assert.equal(decision.fulfilled,.88);assert.equal(decision.latency_ms,12);
 assert.equal(gateAllows(decision,{JEV_ENABLED:'true',JEV_MODE:'gate'}),true);
 assert.equal(qualityNeedsRepair(decision,{JEV_FULFILLED_MIN:'.90'}),true);
});
test('cliente Jev envia estado e perguntas tipadas sem expor dados fora do corpo',async()=>{
 let request;
 const result=await callJev({input:{text:'gastei 45',kind:'text'},proposal:{operation:{action:'create'},text:'Lançar R$ 45'},context:{transactions:[]}},
  {request_understood:{type:'noul',instructions:'entendeu?' }},
  {env:{JEV_ENABLED:'true',OPENROUTER_API_KEY:'secret',JEV_MODEL:'jev-1.13'},fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return{ok:true,json:async()=>({model:'typesafe/jev-1.13',answers:{request_understood:{noul:.99}}})}}});
 assert.equal(result.status,'ok');assert.equal(request.model,'jev-1.13');assert.equal(request.questions.request_understood.type,'noul');assert.equal(request.state.includes('gastei 45'),true);
});
test('gate Jev impede mutação incerta e não altera o RPC financeiro',async()=>{
 const calls=[];const previous={...process.env};process.env.JEV_ENABLED='true';process.env.JEV_MODE='gate';
 let result;
 try { result=await processJob({id, user_id:id, lease_token:id, payload:{text:'gastei 45'}},{
  database:async()=>[],
  analyze:async()=>({operation:{action:'create',transactions:[{transaction_type:'despesa',amount:45,category:'Alimentação',description:'Almoço',transaction_date:'2026-09-15'}]},text:'Lançamento registrado.'}),
  decide:async()=>({status:'ok',decision:{route:'clarify',understood:.6,safe:.4}}),
  evaluate:async()=>({status:'disabled'}),
  call:async(name,payload)=>{calls.push([name,payload]);return{status:'done',result:{text:payload.p_text}}},
 }); } finally { for(const key of Object.keys(process.env)) if(!(key in previous)) delete process.env[key]; Object.assign(process.env,previous); }
 assert.equal(calls.length,1);assert.equal(calls[0][0],'finance_assistant_finish');assert.equal(calls[0][1].p_operation.action,'chat');assert.equal(result.status,'done');
});
test('gate Jev transforma pedido de confirmação em job confirmável',async()=>{
 const calls=[];const previous={...process.env};process.env.JEV_ENABLED='true';process.env.JEV_MODE='gate';
 try { await processJob({id,user_id:id,lease_token:id,payload:{text:'gastei 45'}},{
  database:async()=>[],
  analyze:async()=>({operation:{action:'create',transactions:[{transaction_type:'despesa',amount:45,category:'Alimentação',description:'Almoço',transaction_date:'2026-09-15'}]},text:'Lançamento registrado.'}),
  decide:async()=>({status:'ok',decision:{route:'confirmation',understood:.99,safe:.99}}),
  evaluate:async()=>({status:'disabled'}),
  call:async(name,payload)=>{calls.push([name,payload]);return{status:'awaiting_confirmation',result:{text:payload.p_text}}},
 }); } finally { for(const key of Object.keys(process.env)) if(!(key in previous)) delete process.env[key]; Object.assign(process.env,previous); }
 assert.equal(calls[0][0],'finance_assistant_request_confirmation');assert.equal(calls[0][1].p_operation.requires_confirmation,true);
});
test('avalia resultado e faz no máximo um reparo textual',async()=>{
 const calls=[];const previous={...process.env};
 process.env.JEV_ENABLED='true';process.env.JEV_MODE='gate';
 try {
  await processJob({id,user_id:id,lease_token:id,payload:{text:'gastei 45'}},{
   database:async()=>[],
   analyze:async()=>({operation:{action:'create',transactions:[{transaction_type:'despesa',amount:45,category:'Alimentação',description:'Almoço',transaction_date:'2026-09-15'}]},text:'Lançamento registrado.'}),
   decide:async()=>({status:'ok',decision:{route:'execute',understood:.99,safe:.99,model:'jev-1.13',usage:{cost:.01}}}),
   evaluate:async()=>({status:'ok',decision:{fulfilled:.4,truthful:.4,model:'jev-1.13',usage:{cost:.01}}}),
   repair:async()=>({operation:{action:'chat'},text:'Corrigi a resposta.'}),
   call:async(name,payload)=>{calls.push([name,payload]);return name==='finance_assistant_finish'?{status:'done',result:{text:'Lançamento registrado.',transactions:[]}}:{status:'done',result:{text:payload.p_text,quality:payload.p_quality}}},
  });
 } finally { for(const key of Object.keys(process.env)) if(!(key in previous)) delete process.env[key]; Object.assign(process.env,previous); }
 assert.deepEqual(calls.map(([name])=>name),['finance_assistant_finish','finance_assistant_record_quality']);
 assert.equal(calls[1][1].p_text,'Corrigi a resposta.');assert.equal(calls[1][1].p_quality.repaired,true);
});
