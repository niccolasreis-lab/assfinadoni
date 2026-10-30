const assert = require('node:assert/strict');
const {code}=require('./contract.json');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function run(name,input,context={}){
 const fn=new AsyncFunction('$input','$',code[name]);
 return (await fn({first:()=>({json:input})},()=>({first:()=>({json:context})})))[0].json;
}
(async()=>{
 const scan=await run('Validar texto nativo do PDF',{text:'',numpages:1});
 assert.equal(scan.native_pdf_readable,false);
 assert.equal((await run('Validar texto nativo do PDF',{text:'Comprovante de compra total R$ 18,50',numpages:1})).native_pdf_readable,true);
 for(const numpages of [0,11,1.5]) assert.equal((await run('Validar texto nativo do PDF',{text:'Comprovante de compra total R$ 18,50',numpages})).native_pdf_readable,false);
 const silent=await run('Normalizar transcrição do áudio',{candidates:[{content:{parts:[{text:JSON.stringify({intelligible:false,transcript:''})}]}}]},{mediaKind:'audio'});
 assert.equal(silent.route,'reply');assert.equal(silent.financialStatus,'audio_inaudivel');
 const speech=await run('Normalizar transcrição do áudio',{candidates:[{content:{parts:[{text:JSON.stringify({intelligible:true,transcript:'Não registre esse gasto de 18,50 reais.'})}]}}]},{mediaKind:'audio'});
 assert.equal(speech.text,'Não registre esse gasto de 18,50 reais.');assert.equal(speech.audioTranscribed,true);assert.equal(speech.originalMediaKind,'audio');assert.equal(speech.route,undefined);
 await assert.rejects(run('Normalizar transcrição do áudio',{error:{message:'timeout'}}),/Transcrição indisponível/);
 await assert.rejects(run('Preparar anexo IA',{text:'Total R$ 18,50',page_count:1,requires_review:true,pages:[{lines:[{text:'Total R$ 18,50',confidence:.4}]}]}),/OCR_VALOR_INCERTO/);
 const prepared=await run('Preparar anexo IA',{text:'PADARIA TESTE Total R$ 18,50',page_count:1,requires_review:false});
 const body=await run('Preparar leitura OmniRoute',prepared);
 assert.equal(body.omniBody.model,'pagos_gpt_SOL-copy');assert.match(body.omniBody.messages[1].content,/18,50/);
 assert.equal(body.amount,undefined);assert.equal(body.savedId,undefined);
 console.log('PASS: scanned/native PDF routing, page bounds, uncertain OCR, audio silence, preserved negation, provider failure, configured OmniRoute combo; no network or financial writes.');
})().catch(e=>{console.error(e);process.exitCode=1});
