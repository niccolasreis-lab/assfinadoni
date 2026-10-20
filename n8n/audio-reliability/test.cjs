const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=__dirname, contract=JSON.parse(fs.readFileSync(path.join(root,'contract.json')));
const checkCode=fs.readFileSync(path.join(root,'watchdog-check.js'),'utf8');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}
const ctx={workflowId:'finance',executionId:'123',chatId:'test-group',senderId:'test-person'};
function runWatch(body,{statusCode=200,final=false}={}){return vm.runInNewContext('(function(){'+checkCode+'})()',{$input:{first:()=>({json:{statusCode,body}})},$:name=>({first:()=>({json:ctx}),isExecuted:name==='Checagem final?'&&final})});}
const running={workflowId:'finance',id:'123',status:'running',data:{resultData:{runData:{}}}};
test('running parent gets progress after initial wait',()=>assert.equal(runWatch(running)[0].json.kind,'progress'));
for(const status of ['success','canceled'])test(status+' parent gets no delayed notice',()=>assert.equal(runWatch({...running,status}).length,0));
test('delivered reply suppresses progress and later failure',()=>{const e={...running,status:'error',data:{resultData:{runData:{'Responder WhatsApp':[{data:{main:[[{json:{key:{id:'sent'}}}]]}}]}}}};assert.equal(runWatch(e).length,0)});
for(const status of ['error','crashed'])test(status+' gets honest failure without claiming rollback',()=>{const r=runWatch({...running,status})[0].json;assert.equal(r.kind,'failure');assert.match(r.replyText,/confira os lançamentos/);assert.doesNotMatch(r.replyText,/nenhum.*registrado/i)});
for(const statusCode of [404,401,500])test('API '+statusCode+' never invents parent failure',()=>assert.equal(runWatch({}, {statusCode}).length,0));
test('different workflow cannot generate message',()=>assert.equal(runWatch({...running,workflowId:'other'}).length,0));
test('different execution cannot generate message',()=>assert.equal(runWatch({...running,id:'999'}).length,0));
test('final check does not repeat processing notice',()=>assert.equal(runWatch(running,{final:true}).length,0));
test('final check catches timeout failure',()=>assert.equal(runWatch({...running,status:'error'},{final:true})[0].json.kind,'failure'));
const code=contract.nodes.find(n=>n.name==='Classificar comando').parameters.jsCode;
function classify(text,ai,rows=[]){const base={chatId:'test',senderId:'person',messageId:'m',user:{id:'wallet'},text,mediaKind:'text',intentInput:'{}',today:'2026-10-20',ledgerContext:rows};return vm.runInNewContext('(function(){'+code+'})()',{$input:{first:()=>({json:{output:JSON.stringify(ai)}})},$:()=>({first:()=>({json:base})}),$getWorkflowStaticData:()=>({})})[0].json;}
const rows=[{id:'i',user_id:'wallet',transaction_type:'receita',amount:2000,description:'Salário teste',transaction_date:'2026-10-20'},{id:'e',user_id:'wallet',transaction_type:'despesa',amount:30,description:'Mercado teste',transaction_date:'2026-10-20'},{id:'x',user_id:'other',transaction_type:'despesa',amount:900,description:'Privado',transaction_date:'2026-10-20'}];
for(const name of ['Ionara','Nícolas','Narinha'])test('query for '+name+' excludes income, other wallet and misleading closure',()=>{const r=classify('E as despesas da '+name+'?',{intent:'outro',conversation_action:'close',management:{action:'list'}},rows);assert.equal(r.financialStatus,'gestao_consulta_compartilhada');assert.match(r.replyText,/Mercado teste/);assert.doesNotMatch(r.replyText,/Salário teste|Privado|Até mais/);assert.match(r.replyText,/não identificam quem/)});
test('empty recent query does not claim all history is empty',()=>assert.match(classify('Quais gastos da Ionara?',{intent:'outro'},[]).replyText,/mais antigas/));
test('verified error delivery uses exact message without an AI call',()=>{const text='Falha exata';const r=vm.runInNewContext('(function(){'+fs.readFileSync(path.join(root,'verified-reply.js'),'utf8')+'})()',{$input:{first:()=>({json:{baseReply:text,conversationStatus:'falha_audio'}})}});assert.equal(r[0].json.replyText,text);assert.equal(r[0].json.aiResponseUsed,false)});

const unwrap=fs.readFileSync(path.join(root,'unwrap-message.js'),'utf8');
for(const wrapper of ['ephemeralMessage','viewOnceMessage','viewOnceMessageV2','viewOnceMessageV2Extension','documentWithCaptionMessage'])test(wrapper+' audio envelope is recognized',()=>{const audio={audioMessage:{mimetype:'audio/ogg',ptt:true}};const result=vm.runInNewContext('(function(){let m=input;'+unwrap+';return m;})()',{input:{[wrapper]:{message:audio}}});assert.equal(result.audioMessage.ptt,true)});
test('unrelated protocol messages are not turned into audio',()=>{const input={protocolMessage:{message:{audioMessage:{}}}};const result=vm.runInNewContext('(function(){let m=input;'+unwrap+';return m;})()',{input});assert.equal(result.audioMessage,undefined)});
console.log(JSON.stringify({passed}));
