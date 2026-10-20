const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const workflow=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'contract.json'),'utf8'));
const code=name=>workflow.nodes.find(n=>n.name===name).parameters.jsCode;
const base={chatId:'qa-group',senderId:'qa-ionara',messageId:'qa-event-1',user:{id:'qa-wallet'},today:'2026-10-20',mediaKind:'text',intentInput:'{}',ledgerContext:[]};
function run(name,{ctx=base,ai,items=[],state={}}={}){
 const inputs=ai?[{json:{output:JSON.stringify(ai)}}]:items.length?items:[{json:ctx}];
 return vm.runInNewContext('(function(){'+code(name)+'})()',{$input:{first:()=>inputs[0],all:()=>inputs},$:()=>({first:()=>({json:ctx})}),$getWorkflowStaticData:()=>state},{timeout:1000});
}
let checks=0;
const check=(name,fn)=>{try{fn();checks++;console.log('PASS '+name);}catch(e){console.error('FAIL '+name+': '+e.stack);process.exitCode=1;}};
const tx=(amount,description,type='despesa')=>({amount,description,transaction_type:type,transaction_date:'2026-10-20',category:'Outros',payment_method:null});
const four=[tx(2000,'Adiantamento salarial','receita'),tx(700,'Pagamento para Contato de teste'),tx(300.50,'Pagamento da fatura Inter'),tx(100.25,'Pagamento Shopee')];
const screenshot='Recebi de adiantamento salarial: 2000,00\n\nPaguei 700,00 para o Contato de teste\n\nPaguei 300,50 Cartão de crédito inter\n\nPaguei 100,25 da Shopee';
const proposal=(transactions=four,text=screenshot,state={})=>({result:run('Classificar comando',{ctx:{...base,text},state,ai:{intent:'novo_lancamento',new_transactions:transactions}})[0].json,state});
let approved;
check('4 mixed entries are proposed, not written, with exact signed subtotals',()=>{
 const {result,state}=proposal();assert.equal(result.route,'reply');assert.equal(state.pending[base.chatId].transactions.length,4);
 assert.equal(state.pending[base.chatId].transactions[0].transaction_type,'receita');assert.equal(state.pending[base.chatId].transactions.slice(1).every(t=>t.transaction_type==='despesa'),true);
 assert.match(result.replyText,/2\.000,00/);assert.match(result.replyText,/1\.100,75/);assert.match(result.replyText,/899,25/);assert.doesNotMatch(result.replyText,/3\.100,75/);
 assert.equal(JSON.stringify(state.pending[base.chatId].transactions.map(t=>t.payment_details)),JSON.stringify([{},{},{},{}]));
});
check('equal amounts remain two independent rows',()=>{const {state}=proposal([tx(20,'Café'),tx(20,'Estacionamento')],'Paguei 20 no café\nPaguei 20 no estacionamento');assert.equal(state.pending[base.chatId].transactions.length,2);});
check('one missing item makes the draft fail closed',()=>{const {state,result}=proposal(four.slice(0,3));assert.equal(state.pending?.[base.chatId],undefined);assert.equal(result.route,'reply');});
for(const [label,mutate] of [['amount',rows=>rows[1].amount=-1],['precision',rows=>rows[1].amount=1.001],['date',rows=>rows[1].transaction_date='2026-02-31'],['type',rows=>rows[1].transaction_type='transferencia']])check('invalid '+label+' rejects all items',()=>{const rows=structuredClone(four);mutate(rows);const {state,result}=proposal(rows);assert.equal(state.pending?.[base.chatId],undefined);assert.equal(result.route,'reply');});
check('11 rows rejects all items',()=>{const {state,result}=proposal(Array.from({length:11},(_,i)=>tx(i+1,'Item '+i)),'Compras várias');assert.equal(state.pending?.[base.chatId],undefined);assert.equal(result.route,'reply');});
check('natural confirmation returns the original four signed rows',()=>{
 const {state}=proposal();const r=run('Classificar comando',{ctx:{...base,text:'Sim, pode registrar',messageId:'qa-event-confirm'},state,ai:{intent:'confirmar_pendente'}})[0].json;
 assert.equal(r.route,'transaction');assert.equal(r.transactions.length,4);assert.equal(r.transactions[0].transaction_type,'receita');assert.equal(r.proposalKey,base.messageId);approved=r;
});
for(const text of ['Não, não registre','Está certo?','Pode registrar?'])check('negative/question does not authorize batch: '+text,()=>{const {state}=proposal();const r=run('Classificar comando',{ctx:{...base,text},state,ai:{intent:'confirmar_pendente'}})[0].json;assert.notEqual(r.route,'transaction');});
check('metadata adjustment preserves mixed directions and requires confirmation',()=>{const {state}=proposal();const r=run('Classificar comando',{ctx:{...base,text:'Foi no Pix'},state,ai:{intent:'ajustar_pendente',payment_method:'pix'}})[0].json;assert.equal(r.route,'reply');assert.equal(state.pending[base.chatId].transactions[0].transaction_type,'receita');assert.equal(state.pending[base.chatId].transactions.every(t=>t.payment_details.method==='pix'),true);});
check('old image pending batch still confirms both rows',()=>{const state={pending:{[base.chatId]:{transactions:four.slice(1,3),at:Date.now(),sourceMessageId:'image-qa'}}};const r=run('Classificar comando',{ctx:{...base,text:'Está certo, pode registrar os dois'},state,ai:{intent:'confirmar_pendente'}})[0].json;assert.equal(r.route,'transaction');assert.equal(r.transactions.length,2);assert.equal(r.proposalKey,'image-qa');});
check('single salary wording says entry, never purchase',()=>{const {result}=proposal([four[0]],'Recebi 2000,00 de adiantamento salarial');assert.match(result.replyText,/Entrada/);assert.doesNotMatch(result.replyText,/compra/);});
check('partial retry preserves source, directions and deterministic per-index keys',()=>{
 const state={pending:{[base.chatId]:{transactions:approved.transactions,at:Date.now(),sourceMessageId:approved.proposalKey}}};
 const a=run('Preparar itens do lançamento',{ctx:approved,state});
 const partial=run('Confirmar lançamento',{ctx:approved,state,items:approved.transactions.map((t,i)=>({json:{status:i===2?'falha':'registrado',tx:t}}))})[0].json;
 assert.equal(partial.financialStatus,'falha_parcial');assert.equal(state.pending[base.chatId].transactions.length,4);
 const retry=run('Classificar comando',{ctx:{...base,text:'Pode registrar'},state,ai:{intent:'confirmar_pendente'}})[0].json;
 const b=run('Preparar itens do lançamento',{ctx:retry,state});assert.deepEqual(Array.from(a.map(x=>x.json.recordKey)),Array.from(b.map(x=>x.json.recordKey)));assert.equal(new Set(a.map(x=>x.json.recordKey)).size,4);
});
check('final confirmation reports correct income, outflow and net, clearing pending',()=>{
 const state={pending:{[base.chatId]:{transactions:approved.transactions,at:Date.now()}}};
 const r=run('Confirmar lançamento',{ctx:approved,state,items:approved.transactions.map(tx=>({json:{status:'registrado',tx}}))})[0].json;
 assert.equal(state.pending[base.chatId],undefined);assert.match(r.replyText,/1\.100,75/);assert.match(r.replyText,/899,25/);assert.doesNotMatch(r.replyText,/compra/);
});
console.log(JSON.stringify({checks,passed:!process.exitCode}));
