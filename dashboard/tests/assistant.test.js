import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssistantInput, sniffFile, MAX_FILE_BYTES } from '../lib/assistant.js';
import { normalizeInterpretation } from '../worker/interpret.js';
import { extractPdf, MediaError } from '../worker/media.js';
import { processJob } from '../worker/index.js';
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
