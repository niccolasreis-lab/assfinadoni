/* Isolated image boundary tests. Only consumes sanitized code contracts; no network,
 * private workflow snapshots, credentials, send nodes or financial writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(name + ' requires a contract path');
  return path.resolve(args[index + 1]);
}
const contractPath = option('--contract', path.join(__dirname, 'contract.json'));
const baselinePath = option('--baseline', null);
// Small JPEG fixture; never sent to a model or external service.
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==';
const context = {chatId:'local-fixture',messageId:'local-image-event',user:{id:'11111111-1111-4111-8111-111111111111'},today:'2026-10-20',mediaKind:'image',mimeType:'image/jpeg',fileName:'fixture.jpg',text:'',payerContext:{available:false,participants:[],attributions:[]}};
const transactions = [4.98, 5.27, 10].map((amount,index) => ({amount,description:'Compra de teste '+(index+1),transaction_type:'despesa',transaction_date:null}));
const payload = rows => JSON.stringify({transactions:rows});
const chat = rows => ({choices:[{message:{content:payload(rows)}}]});
function safeContract(filename) {
  const contract = JSON.parse(fs.readFileSync(filename,'utf8'));
  assert.ok(Array.isArray(contract.nodes),'nodes array required');
  for (const node of contract.nodes) {
    assert.equal(node.credentials,undefined,'Never export credentials in this contract');
    assert.equal(node.parameters?.headerParameters,undefined,'Never export HTTP authentication headers');
    assert.ok(!/Criar lançamento|Salvar pagador|Enviar|Responder WhatsApp|Validar origem/.test(node.name),'Only isolated image-reading nodes belong in this contract');
  }
  return contract;
}
async function suite(contract, label) {
  let checks=0, failed=0;
  const code = name => {
    const node=contract.nodes.find(node=>node.name===name);
    assert.ok(node && typeof node.parameters?.jsCode==='string','Missing code node '+name);
    return node.parameters.jsCode;
  };
  const prepName=contract.imagePreparationNode||'Preparar imagem para OpenAI';
  const normalizeName=contract.imageNormalizationNode||'Normalizar anexo IA';
  async function run(name, input, {media={base64:jpeg,mimetype:'image/jpeg'},ctx=context,state={}}={}) {
    const item=input?.json?input:{json:input};
    const named=n=>n==='Baixar mídia Evolution'?media:ctx;
    const sandbox={$input:{first:()=>item,all:()=>[item]},$:n=>({first:()=>({json:named(n)})}),$getWorkflowStaticData:()=>state,Buffer,console:{log(){},warn(){},error(){}}};
    const script=new vm.Script('(async function(){'+code(name)+'}).call({helpers:{getBinaryDataBuffer:async()=>Buffer.from('+JSON.stringify(media.base64||'')+",'base64')}})");
    const output=await script.runInNewContext(sandbox,{timeout:1500});
    return {output,state};
  }
  async function check(name, test) {
    checks++;
    try { await test();console.log('PASS '+label+' '+name); }
    catch(error) { failed++;console.error('FAIL '+label+' '+name+': '+error.message); }
  }
  async function normalize(response) { return run(normalizeName,response); }
  function proposed(result,count=3) {
    const value=result.output[0]?.json;
    assert.equal(value?.route,'reply','Reading an attachment must return a proposal, never a write route');
    assert.equal(value?.financialStatus,'aguardando_confirmacao');
    assert.equal(value?.verifiedAttachmentProposal,true,'Only a validated attachment proposal is marked for a direct reply');
    const pending=result.state.pending?.[context.chatId];
    assert.equal(pending?.transactions?.length,count);
    for(const tx of pending.transactions) assert.equal(tx.payer?.kind||'unknown','unknown','Image ownership must never imply payer');
    return pending.transactions;
  }
  function refused(result) {
    assert.equal(result.output[0]?.json?.route,'reply');
    assert.equal(result.output[0]?.json?.verifiedAttachmentProposal,undefined,'Failures must never claim a verified attachment proposal');
    assert.equal(result.state.pending?.[context.chatId],undefined,'Invalid extraction must not create a pending financial proposal');
  }
  await check('valid JPEG produces an image model body without a financial write',async()=>{
    assert.equal(contract.verifiedImageEngine,'gemini','Use the image engine verified with the original image');
    assert.equal(contract.connections?.['Anexo é imagem?']?.main?.[0]?.[0]?.node,'Preparar anexo IA','Images must use the verified multimodal route, never the unsupported text model');
    const media={base64:jpeg,mimetype:'image/jpeg'};
    const converted=await run('Converter mídia',media,{media});
    assert.ok(converted.output[0]?.binary?.data?.data);
    const prepared=await run(prepName,converted.output[0],{media});
    const body=prepared.output[0]?.json;
    assert.ok(body?.openAiBody||body?.geminiBody,'A vision request body is required');
    if(body.openAiBody) {
      assert.ok(typeof contract.expectedVisionModel==='string'&&contract.expectedVisionModel,'Verified vision model alias is required');
      assert.equal(body.openAiBody.model,contract.expectedVisionModel,'Vision must use a model verified for image input');
    } else {
      assert.equal(prepName,'Preparar anexo IA','Gemini images use the configured multimodal preparer');
      assert.equal(body.geminiBody.contents[0].parts[1].inlineData.mimeType,'image/jpeg');
      assert.equal(body.geminiBody.generationConfig.responseMimeType,'application/json');
      for(const [mimeType,bytes] of [
        ['image/png',Buffer.from([137,80,78,71,13,10,26,10])],
        ['image/webp',Buffer.from('RIFF0000WEBP')],
      ]) {
        const media={base64:bytes.toString('base64'),mimetype:mimeType};
        const ctx={...context,mimeType};
        const converted=await run('Converter mídia',media,{media,ctx});
        const prepared=await run(prepName,converted.output[0],{media,ctx});
        assert.equal(prepared.output[0].json.geminiBody.contents[0].parts[1].inlineData.mimeType,mimeType);
      }
      // The shared PDF/audio preparer must not inherit image-only MIME guards.
      for(const [mediaKind,mimeType] of [['pdf','application/pdf'],['audio','audio/ogg']]) {
        const media={base64:Buffer.from('local non-image fixture').toString('base64'),mimetype:mimeType};
        const ctx={...context,mediaKind,mimeType};
        const converted=await run('Converter mídia',media,{media,ctx});
        const prepared=await run(prepName,converted.output[0],{media,ctx});
        assert.equal(prepared.output[0].json.geminiBody.contents[0].parts[1].inlineData.mimeType,mimeType);
      }
    }
    assert.equal(prepared.state.pending,undefined);
  });
  for(const [name,media] of [['missing base64',{}],['invalid base64',{base64:'not-base64!!!',mimetype:'image/jpeg'}],['non-image MIME',{base64:jpeg,mimetype:'text/html'}],['executable SVG MIME',{base64:Buffer.from('<svg onload="alert(1)"></svg>').toString('base64'),mimetype:'image/svg+xml'}],['unsupported GIF MIME',{base64:Buffer.from('GIF89a').toString('base64'),mimetype:'image/gif'}]]) {
    await check(name+' is rejected before vision',async()=>{
      let rejected=false;
      try {const converted=await run('Converter mídia',media,{media});await run(prepName,converted.output[0],{media});}catch{rejected=true;}
      assert.equal(rejected,true);
    });
  }
  for(const [name,response] of [
    ['Chat Completions',chat(transactions)],
    ['Gemini',{candidates:[{content:{parts:[{text:payload(transactions)}]}}]}],
    ['Responses',{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:payload(transactions)}]}]}],
    ['Chat text parts',{choices:[{message:{content:[{type:'text',text:payload(transactions)}]}}]}],
    ['fenced JSON',{choices:[{message:{content:'```json\n'+payload(transactions)+'\n```'}}]}],
  ]) await check(name+' preserves three payments and total 20.25',async()=>{
    const rows=proposed(await normalize(response));
    assert.deepEqual(Array.from(rows,tx=>Math.round(Number(tx.amount)*100)),[498,527,1000]);
    assert.equal(rows.reduce((sum,tx)=>sum+Math.round(Number(tx.amount)*100),0),2025);
  });
  await check('missing dates use reference date and payer stays unknown',async()=>{
    const result=await normalize(chat(transactions));const rows=proposed(result);
    assert.match(result.output[0].json.replyText,/Data não visível: usando hoje/);
    assert.match(result.output[0].json.replyText,/Confirme ou informe outra data/);
    for(const tx of rows) {assert.equal(tx.transaction_date,context.today);assert.equal(tx.payer?.kind||'unknown','unknown');assert.deepEqual(Array.from(tx.payer?.participant_ids||[]),[]);}
  });
  const invalidCases=[
    ['more than ten entries',chat(Array.from({length:11},()=>transactions[0]))],
    ['empty transactions',chat([])],
    ['null amount',chat([{...transactions[0],amount:null}])],
    ['string amount',chat([{...transactions[0],amount:'4.98'}])],
    ['zero amount',chat([{...transactions[0],amount:0}])],
    ['negative amount',chat([{...transactions[0],amount:-1}])],
    ['out-of-range amount',chat([{...transactions[0],amount:100000001}])],
    ['impossible date',chat([{...transactions[0],transaction_date:'2026-02-30'}])],
    ['invalid JSON',{choices:[{message:{content:'not JSON'}}]}],
    ['provider error',{error:{message:'fixture failure'}}],
    ['model refusal',{choices:[{message:{content:null,refusal:'fixture refusal'}}]}],
  ];
  for(const [name,response] of invalidCases) await check(name+' returns safe reply with no proposal',async()=>refused(await normalize(response)));
  await check('null or non-object JSON root returns safe reply without throwing',async()=>{
    for(const value of [null,[],42,'unexpected']) refused(await normalize({choices:[{message:{content:JSON.stringify(value)}}]}));
  });
  await check('null transaction returns safe reply without a partial batch',async()=>refused(await normalize(chat([transactions[0],null]))));
  await check('invalid transaction type cannot silently become expense',async()=>refused(await normalize(chat([{...transactions[0],transaction_type:'transfer'}]))));
  await check('one uncertain amount prevents a partial batch proposal',async()=>refused(await normalize(chat([transactions[0],{...transactions[1],amount:null},transactions[2]]))));
  function verifiedReply(value) {
    const guard=contract.nodes.find(node=>node.name==='Resposta verificada?');
    const condition=guard.parameters.conditions.conditions[0].leftValue;
    assert.ok(condition.startsWith('={{ ')&&condition.endsWith(' }}'));
    return vm.runInNewContext(condition.slice(4,-3),{$json:value},{timeout:1500});
  }
  await check('verified attachment bypasses conversation AI without losing date warning or amounts',async()=>{
    const result=await normalize(chat(transactions));proposed(result);
    const prepared=await run('Preparar conversa para o agente',result.output[0],{state:result.state});
    const value=prepared.output[0].json;
    assert.equal(value.baseReply,result.output[0].json.replyText);
    assert.equal(value.verifiedAttachmentProposal,true);
    assert.equal(verifiedReply(value),true);
    const direct=await run('Usar resposta verificada',prepared.output[0]);
    assert.equal(direct.output[0].json.replyText,result.output[0].json.replyText);
    assert.match(direct.output[0].json.replyText,/Data não visível: usando hoje/);
    assert.match(direct.output[0].json.replyText,/20,25/);
    assert.equal(direct.output[0].json.aiResponseUsed,false);
  });
  await check('attachment direct-response guard requires strict true and pending status, preserving old branches',async()=>{
    for(const flag of [undefined,false,'true',1,{}]) assert.equal(verifiedReply({conversationStatus:'aguardando_confirmacao',verifiedAttachmentProposal:flag}),false);
    assert.equal(verifiedReply({conversationStatus:'conversa',verifiedAttachmentProposal:true}),false);
    assert.equal(verifiedReply({conversationStatus:'aguardando_confirmacao',verifiedAttachmentProposal:true}),true);
    assert.equal(verifiedReply({conversationStatus:'aguardando_confirmacao',pendingProposal:{transactions:[{payerFrozenVersion:1}]}}),true);
    for(const conversationStatus of ['registrado','resumo','gestao_consulta_compartilhada','falha_audio']) assert.equal(verifiedReply({conversationStatus}),true);
  });
  await check('read-only Gemini retry is bounded to two attempts and two seconds between attempts',async()=>{
    const vision=contract.nodes.find(node=>node.name==='Ler anexo com Gemini');
    assert.ok(vision,'Sanitized vision retry envelope is required');
    assert.equal(vision.retryOnFail,true);
    assert.equal(vision.maxTries,2);
    assert.equal(vision.waitBetweenTries,2000);
    assert.equal(vision.parameters,undefined,'The retry contract must not export HTTP configuration');
    assert.equal(vision.credentials,undefined);
  });
  console.log(JSON.stringify({label,checks,passed:checks-failed,failed,financialWrites:0,networkCalls:0}));
  return failed;
}
(async()=>{
  if(baselinePath) await suite(safeContract(baselinePath),'before');
  if(!fs.existsSync(contractPath)) throw new Error('Awaiting sanitized image code contract at '+contractPath);
  const failed=await suite(safeContract(contractPath),'after');
  if(failed) process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
