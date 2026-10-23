const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'contract.json'),'utf8'));
const code=contract.nodes.find(n=>n.name==='Classificar comando').parameters.jsCode;
const W='11111111-1111-4111-8111-111111111111';
const base={chatId:'qa-group',senderId:'qa-sender',messageId:'qa-source',user:{id:W},today:'2026-10-23',mediaKind:'text',intentInput:'{}',ledgerContext:[],payerContext:{available:false}};
const draft=(amount=219.85,type='receita',description='Cancelamento Internet')=>({amount,description,transaction_type:type,transaction_date:'2026-10-23',category:'Assinaturas',payer:{kind:'unknown',participant_ids:[]}});
function run({text,ai,state={},input,context={}}={}){
 const ctx={...base,text,...context};
 const item={json:input??(ai===undefined?{error:{message:'read-only model unavailable'}}:{output:JSON.stringify(ai)})};
 const out=vm.runInNewContext('(function(){'+code+'})()',{$input:{first:()=>item,all:()=>[item]},$:()=>({first:()=>({json:ctx}),item:{json:ctx},isExecuted:false}),$getWorkflowStaticData:()=>state,$now:{setZone:()=>({toISO:()=> '2026-10-23T15:00:00-03:00'})}},{timeout:2000});
 return {result:out[0].json,state};
}
let checks=0;
const check=(name,fn)=>{try{fn();checks++;console.log('PASS '+name)}catch(e){console.error('FAIL '+name+' '+e.stack);process.exitCode=1}};
const propose=(text,rows,other={})=>run({text,ai:{intent:'novo_lancamento',new_transactions:rows},...other});
const expectNoProposal=x=>{assert.equal(x.result.route,'reply');assert.equal(x.state.pending?.[base.chatId],undefined);assert.notEqual(x.result.route,'transaction')};
check('screenshot cancellation cannot become income without receipt evidence; whole batch remains unrecorded',()=>{
 const x=propose('Apenas relembrando: Cancelamento Internet 219,85\n\nInternet 56,70',[draft(),draft(56.70,'despesa','Internet')]);expectNoProposal(x);assert.equal(x.result.financialStatus,'alerta_esclarecer_tipo');assert.match(x.result.replyText,/cobrança.*despesa.*devolvido.*receita/);assert.match(x.result.replyText,/219,85/);
});
check('an explicitly described cancellation expense remains an expense',()=>{
 const x=propose('Taxa de cancelamento Internet 219,85',[draft(219.85,'despesa')]);assert.equal(x.state.pending[base.chatId].transactions[0].transaction_type,'despesa');
});
check('explicit refund of the matching cancellation can be income',()=>{
 const x=propose('Recebi o estorno do cancelamento Internet 219,85',[draft()]);assert.equal(x.state.pending[base.chatId].transactions[0].transaction_type,'receita');
});
check('an explicit receipt on a different line cannot justify cancellation income',()=>{
 const x=propose('Cancelamento Internet 219,85\nRecebi salário 1000,00',[draft(),draft(1000,'receita','Salário')]);expectNoProposal(x);
});
check('a refund for a different amount cannot justify the ambiguous cancellation',()=>{
 const x=propose('Cancelamento Internet 219,85\nRecebi estorno cancelamento telefone 50,00',[draft(),draft(50,'receita','Estorno telefone')]);expectNoProposal(x);
});
check('negated refund evidence does not authorize income',()=>{
 const x=propose('Cancelamento Internet 219,85, não recebi estorno',[draft()]);expectNoProposal(x);
});
check('receiving a cancellation bill is not receiving income',()=>{
 const x=propose('Recebi o boleto de Cancelamento Internet 219,85',[draft()]);expectNoProposal(x);
});
check('requesting a refund is not receiving income',()=>{
 const x=propose('Solicitei estorno do cancelamento Internet 219,85',[draft()]);expectNoProposal(x);
});
check('a promised future refund is not an actual receipt',()=>{
 const x=propose('Vai entrar estorno do cancelamento Internet 219,85',[draft()]);expectNoProposal(x);
});
check('a mixed valid batch preserves expense and genuine refund directions',()=>{
 const x=propose('Taxa cancelamento Internet 219,85\nRecebi estorno cancelamento telefone 50,00',[draft(219.85,'despesa'),draft(50,'receita','Estorno cancelamento telefone')]);assert.deepEqual(Array.from(x.state.pending[base.chatId].transactions,r=>r.transaction_type),['despesa','receita']);
});
check('confirmed legacy pending rows are not silently rewritten by cancellation guard',()=>{
 const rows=[draft()];const state={pending:{[base.chatId]:{transactions:rows,sourceMessageId:'legacy',at:Date.now()}}};
 const x=run({text:'Sim, todos',ai:{intent:'confirmar_pendente'},state});assert.equal(x.result.route,'transaction');assert.equal(x.result.transactions[0].transaction_type,'receita');assert.equal(x.result.proposalKey,'legacy');
});
check('recurring screenshot request survives intention failure without a financial proposal',()=>{
 const x=run({text:'Inclua 100,00 despesa recorrente , INTERNET VIVO'});expectNoProposal(x);assert.equal(x.result.financialStatus,'alerta_esclarecer');assert.match(x.result.replyText,/100,00.*INTERNET VIVO/);assert.match(x.result.replyText,/Qual é a data/);assert.doesNotMatch(x.result.replyText,/com segurança|salvei|cadastrei|09:00/);
 const d=x.state.alertConversations[base.chatId+':'+base.senderId];assert.equal(d.values.amount,100);assert.equal(d.values.description,'INTERNET VIVO');assert.equal(d.values.due_at,undefined);assert.equal(d.values.frequency,undefined);assert.equal(d.single_occurrence_offer,true);
});
check('recurring request cannot become an immediately paid expense from a model draft',()=>{
 const x=propose('Inclua 100,00 despesa recorrente , INTERNET VIVO',[draft(100,'despesa','INTERNET VIVO')]);expectNoProposal(x);assert.match(x.result.replyText,/Nenhuma despesa foi registrada/);
});
check('recurring fallback preserves exact cent values without a default date or frequency',()=>{
 const x=run({text:'Adicione 123,45 despesa recorrente, PLANO TESTE'});expectNoProposal(x);const d=x.state.alertConversations[base.chatId+':'+base.senderId];assert.equal(d.values.amount,123.45);assert.equal(d.values.description,'PLANO TESTE');assert.equal(d.values.due_at,undefined);assert.equal(d.values.frequency,undefined);
});
check('recurring fallback does not consume or mutate an existing financial pending proposal',()=>{
 const old={transactions:[draft(20,'despesa','Mercado')],sourceMessageId:'old',at:Date.now()};const state={pending:{[base.chatId]:old}};
 const x=run({text:'Inclua 100,00 despesa recorrente , INTERNET VIVO',state});assert.equal(x.state.pending[base.chatId],old);assert.equal(x.state.pending[base.chatId].transactions[0].amount,20);
});
check('a denial of recurring creation is not converted to a new recurring offer',()=>{
 const x=run({text:'Não inclua 100,00 despesa recorrente INTERNET VIVO',ai:{intent:'conversa',conversation_action:'close'}});assert.equal(x.state.alertConversations?.[base.chatId+':'+base.senderId],undefined);assert.notEqual(x.result.financialStatus,'alerta_esclarecer');
});
check('a recurrence question with no value is left to the existing semantic contract',()=>{
 const x=run({text:'Como funciona uma despesa recorrente?',ai:{intent:'outro'}});assert.equal(x.state.alertConversations?.[base.chatId+':'+base.senderId],undefined);
});
check('ordinary one-time expenses still require their existing confirmation',()=>{
 const x=propose('Paguei Internet 100,00',[draft(100,'despesa','Internet')]);assert.equal(x.result.financialStatus,'aguardando_confirmacao');assert.equal(x.state.pending[base.chatId].transactions.length,1);assert.equal(x.result.route,'reply');
});
check('safe contract contains no HTTP settings, credentials or financial writer',()=>{
 assert.equal(contract.nodes.length,1);assert.equal(contract.nodes[0].name,'Classificar comando');assert.equal(contract.nodes[0].credentials,undefined);assert.doesNotMatch(JSON.stringify(contract),/Authorization|apikey|https?:\/\/|eyJ[A-Za-z0-9_-]{16}/);
});
check('53 payer checks including all 17 mixed-batch cases pass with reviewed classifier overlay',()=>{
 const payerDir=path.join(__dirname,'../payer-attribution');const payerPath=path.resolve(payerDir,'contract.json');
 const original=JSON.parse(fs.readFileSync(payerPath,'utf8'));
 const overlaid={...original,nodes:original.nodes.map(n=>n.name==='Classificar comando'?contract.nodes[0]:n)};
 const fakeFs={...fs,readFileSync:(file,...args)=>path.resolve(String(file))===payerPath?JSON.stringify(overlaid):fs.readFileSync(file,...args)};
 const output=[];const fakeProcess={exitCode:0};
 vm.runInNewContext(fs.readFileSync(path.join(payerDir,'test.cjs'),'utf8'),{require:name=>name==='node:fs'?fakeFs:require(name),__dirname:payerDir,console:{log:s=>output.push(String(s)),error:s=>output.push(String(s))},process:fakeProcess,structuredClone},{timeout:20000});
 assert.equal(fakeProcess.exitCode,0,output.join('\n'));assert.ok(output.some(s=>s.includes('"checks":53')&&s.includes('"passed":true')),output.join('\n'));
});
console.log(JSON.stringify({checks,passed:!process.exitCode,financialWrites:0,networkCalls:0}));
