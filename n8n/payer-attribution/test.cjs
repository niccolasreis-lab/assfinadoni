const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'contract.json'),'utf8'));
const baseline=JSON.parse(fs.readFileSync(path.join(__dirname,'../finance-text-batch/contract.json'),'utf8'));
const code=name=>(contract.nodes.find(n=>n.name===name)||baseline.nodes.find(n=>n.name===name)).parameters.jsCode;
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const W='11111111-1111-4111-8111-111111111111',TX='10000000-0000-4000-8000-000000000001',TX2='10000000-0000-4000-8000-000000000002';
const base={chatId:'qa-finance-group',senderId:'qa-sender-a',messageId:'qa-source-event',user:{id:W},today:'2026-10-20',mediaKind:'text',intentInput:'{}',ledgerContext:[],payerContext:{available:true,actor_participant_id:A,participants:[{id:A,display_name:'Nícolas',active:true},{id:B,display_name:'Ionara',active:true},{id:C,display_name:'Inativo',active:false}],attributions:[]}};
function run(name,{ctx=base,ai,input,items,state={},named={}}={}){
 const data=items||[{json:ai?{output:JSON.stringify(ai)}:input===undefined?ctx:input}];
 const pick=n=>named[n]??ctx;
 return vm.runInNewContext('(function(){'+code(name)+'})()',{$input:{first:()=>data[0],all:()=>data},$:n=>({first:()=>({json:pick(n)}),item:{json:pick(n)},isExecuted:false}),$getWorkflowStaticData:()=>state,$now:{setZone:()=>({toISO:()=> '2026-10-20T12:00:00-03:00'})}},{timeout:1500});
}
let checks=0;
const check=(name,fn)=>{try{fn();checks++;console.log('PASS '+name)}catch(e){console.error('FAIL '+name+' '+e.stack);process.exitCode=1}};
const payer=(kind='participant',ids=[B])=>({kind,participant_ids:ids});
const draft=(p=payer(),extra={})=>({amount:20,description:'Mercado teste',category:'Alimentação',transaction_type:'despesa',transaction_date:'2026-10-20',payer:p,...extra});
const proposal=(rows=[draft()],ctx={},state={})=>({result:run('Classificar comando',{ctx:{...base,text:'Paguei 20 no mercado',...ctx},state,ai:{intent:'novo_lancamento',new_transactions:rows}})[0].json,state});
const confirm=(state,ctx={},ai={})=>run('Classificar comando',{ctx:{...base,text:'Sim, todos',messageId:'qa-confirm-event',...ctx},state,ai:{intent:'confirmar_pendente',...ai}})[0].json;
const row={id:TX,user_id:W,transaction_type:'despesa',amount:20,description:'Mercado teste',category:'Alimentação',transaction_date:'2026-10-20',source:'API',external_event_id:'wa:qa-source-event:0'};
function savedItem(){const {state}=proposal();const approved=confirm(state);return run('Preparar itens do lançamento',{ctx:approved})[0].json;}
let saved=savedItem();
check('verified roster makes a proposal with named payer before any write',()=>{const {result,state}=proposal();assert.equal(result.route,'reply');assert.match(result.replyText,/Pagador: Ionara/);assert.equal(state.pending[base.chatId].transactions[0].payer.participant_ids[0],B);});
check('sender is not automatically payer when payer was not specified',()=>{const {state}=proposal([draft(undefined,{payer:undefined})]);assert.equal(state.pending[base.chatId].transactions[0].payer.kind,'unknown')});
check('unknown sender metadata stays unknown when context is unavailable',()=>{const {result,state}=proposal([draft(undefined,{payer:undefined})],{payerContext:{available:false}});assert.equal(result.route,'reply');assert.equal(state.pending[base.chatId].transactions[0].payer.kind,'unknown')});
check('explicit payer with unavailable context rejects entire proposal',()=>{const {state,result}=proposal([draft()],{payerContext:{available:false}});assert.equal(state.pending?.[base.chatId],undefined);assert.match(result.replyText,/esclarecer quem pagou/)});
check('unavailable payer clarification flag cannot silently become unknown',()=>{const {state}=proposal([draft(payer('unknown',[]),{payer_needs_clarification:true})],{payerContext:{available:false}});assert.equal(state.pending?.[base.chatId],undefined)});
for(const [name,p] of [['outside roster',payer('participant',[TX])],['inactive',payer('participant',[C])],['invalid UUID',payer('participant',['Daniel'])],['duplicate IDs',payer('joint',[A,A])],['joint one payer',payer('joint',[A])],['individual two payers',payer('participant',[A,B])],['unknown hidden ID',payer('unknown',[A])],['invalid kind',{kind:'transfer',participant_ids:[]}]])check('rejects '+name+' before financial creation',()=>{const {state}=proposal([draft(p)]);assert.equal(state.pending?.[base.chatId],undefined)});
check('invalid payer in second item rejects whole mixed batch',()=>{const {state}=proposal([draft(),draft(payer('participant',[TX]),{amount:30})],{text:'Mercado 20\nEstacionamento 30'});assert.equal(state.pending?.[base.chatId],undefined)});
check('two registered payers show joint label without duplicating money',()=>{const {result,state}=proposal([draft(payer('joint',[A,B]))]);assert.match(result.replyText,/pagamento conjunto/);assert.equal(state.pending[base.chatId].transactions.length,1);assert.equal(state.pending[base.chatId].transactions[0].amount,'20.00')});
check('payer IDs normalize casing and freeze exact selection',()=>{const {state}=proposal([draft(payer('participant',[B.toUpperCase()]))]);assert.equal(state.pending[base.chatId].transactions[0].payer.participant_ids[0],B)});
check('duplicate roster identity is not accepted as a unique payer',()=>{const {state}=proposal([draft()],{payerContext:{...base.payerContext,participants:[...base.payerContext.participants,{id:B,display_name:'Outro nome',active:true}]}});assert.equal(state.pending?.[base.chatId],undefined)});
check('another sender confirmation cannot replace frozen payer with a fresh AI value',()=>{const {state}=proposal();const approved=confirm(state,{senderId:'qa-sender-b'},{new_transactions:[draft(payer('participant',[A]))]});assert.equal(approved.route,'transaction');assert.equal(approved.transactions[0].payer.participant_ids[0],B);assert.equal(approved.proposalKey,base.messageId)});
check('changing payer requires clarification and does not save existing pending',()=>{const {state}=proposal();const r=confirm(state,{}, {payer_change_requested:true});assert.notEqual(r.route,'transaction');assert.equal(state.pending[base.chatId].transactions[0].payer.participant_ids[0],B)});
check('payment/category adjustment preserves payer and asks confirmation again',()=>{const {state}=proposal();const r=run('Classificar comando',{ctx:{...base,text:'Foi no Pix'},state,ai:{intent:'ajustar_pendente',payment_method:'pix'}})[0].json;assert.equal(r.route,'reply');assert.match(r.replyText,/Pagador: Ionara/);assert.equal(state.pending[base.chatId].transactions[0].payer.participant_ids[0],B)});
check('income does not persist an expense payer',()=>{const {state}=proposal([draft(payer(),{transaction_type:'receita'})]);assert.equal(state.pending[base.chatId].transactions[0].payer.kind,'unknown')});
check('new per-item source is bound to original event and index, not confirmer event',()=>{assert.equal(saved.sourceEventId,'wa:qa-source-event:0');assert.equal(saved.sourceMessageId,base.messageId);assert.equal(saved.recordedByParticipantId,null);assert.equal(saved.payerConfirmed,true)});
check('legacy pending without frozen marker does not become a confirmed attribution',()=>{const ctx={...base,pendingConfirmation:true,proposalKey:'legacy',transactions:[draft()]};const x=run('Preparar itens do lançamento',{ctx})[0].json;assert.equal(x.payerConfirmed,false)});
check('unconfirmed frozen item cannot invoke metadata RPC',()=>{const x={...saved,pendingConfirmation:false,payerConfirmed:false,status:'registrado',savedId:TX,attributionEligible:true};const r=run('Preparar identificação confirmada',{input:x})[0].json;assert.equal(r.shouldPersistPayer,false)});
check('new saved expense with exact API event is eligible',()=>{const r=run('Resultado do registro',{ctx:saved,input:row})[0].json;assert.equal(r.status,'registrado');assert.equal(r.attributionEligible,true);assert.equal(run('Preparar identificação confirmada',{input:r})[0].json.shouldPersistPayer,true)});
for(const [name,patch] of [['old source',{source:'SYSTEM'}],['different event',{external_event_id:'wa:other-event:0'}],['income row',{transaction_type:'receita'}]])check('duplicate '+name+' remains financially duplicate but metadata is blocked',()=>{const r=run('Responder duplicidade',{ctx:saved,input:{...row,...patch}})[0].json;assert.equal(r.status,'duplicado');assert.equal(r.attributionEligible,false);assert.equal(run('Preparar identificação confirmada',{input:r})[0].json.shouldPersistPayer,false)});
check('exact event duplicate can finish only the pending metadata',()=>{const r=run('Responder duplicidade',{ctx:saved,input:row})[0].json;assert.equal(r.status,'duplicado');assert.equal(r.savedId,TX);assert.equal(run('Preparar identificação confirmada',{input:r})[0].json.shouldPersistPayer,true)});
const prepared={...saved,status:'registrado',savedId:TX,attributionEligible:true,attributionStatus:'pending'};
const att={transaction_id:TX,finance_user_id:W,kind:'participant',participant_ids:[B]};
check('metadata requires exact successful RPC result',()=>{const r=run('Conferir identificação salva',{ctx:prepared,input:{ok:true,attribution:att}})[0].json;assert.equal(r.attributionStatus,'confirmed');assert.equal(r.status,'registrado')});
for(const [name,r] of [['network error',{error:{message:'unavailable'}}],['missing ok',{attribution:att}],['wrong transaction',{ok:true,attribution:{...att,transaction_id:TX2}}],['wrong wallet',{ok:true,attribution:{...att,finance_user_id:A}}],['wrong payer',{ok:true,attribution:{...att,participant_ids:[A]}}],['wrong kind',{ok:true,attribution:{...att,kind:'joint'}}]])check('metadata '+name+' stays pending without changing financial status',()=>{const result=run('Conferir identificação salva',{ctx:prepared,input:r})[0].json;assert.equal(result.attributionStatus,'pending');assert.equal(result.status,'registrado');assert.equal(result.savedId,TX)});
check('complete finance result reports metadata pending without asking to repeat payments',()=>{const ctx={...base,transactions:[saved.tx],pendingConfirmation:true,proposalKey:base.messageId};const r=run('Confirmar lançamento',{ctx,items:[{json:prepared}],state:{pending:{[base.chatId]:{transactions:[saved.tx]}}}})[0].json;assert.equal(r.financialStatus,'registrado');assert.match(r.replyText,/identificação.*pendente/);assert.match(r.replyText,/não reenvie os pagamentos/);assert.equal(r.transactions[0].amount,'20.00')});
check('successful metadata result has no pending warning',()=>{const r=run('Confirmar lançamento',{ctx:{...base,transactions:[saved.tx]},items:[{json:{...prepared,attributionStatus:'confirmed'}}]})[0].json;assert.doesNotMatch(r.replyText,/identificação.*pendente/)});
check('unidentified historic transaction never invokes set RPC',()=>{const x={...prepared,tx:{...saved.tx,payer:payer('unknown',[])}};const r=run('Preparar identificação confirmada',{input:x})[0].json;assert.equal(r.shouldPersistPayer,false);assert.equal(r.attributionStatus,'not_requested')});
check('context lookup failure joins legacy data and exposes unavailable false',()=>{const x={...base,voiceContext:{important_enabled:true},ledgerContext:[row]};const r=run('Unir contexto de pagadores',{ctx:x,input:{error:'unavailable'}})[0].json;assert.equal(r.payerContext.available,false);assert.equal(r.voiceContext.important_enabled,true);assert.equal(r.ledgerContext[0].id,TX)});
check('context metadata is confined to supplied wallet and selected 50 IDs',()=>{const x={...base,ledgerContext:[row]};const r=run('Unir contexto de pagadores',{ctx:x,input:{available:true,participants:base.payerContext.participants,attributions:[att,{...att,transaction_id:TX2},{...att,finance_user_id:A}]}})[0].json;assert.equal(r.payerContext.attributions.length,1)});
check('text/audio intent input includes verified payer roster explicitly',()=>{const ctx={...base,audioTranscribed:true};const r=run('Preparar intenção financeira',{ctx,named:{'Unir contexto de pagadores':ctx,'Unir preferências de voz':{voiceContext:{}},'Unir preferências financeiras':{insightContext:{}},'Unir combinados do casal':{alertContext:[]},'Unir contexto da conversa':{ledgerContext:[]}}})[0].json;assert.equal(JSON.parse(r.intentInput).contextoDePagadores.actor_participant_id,A);assert.equal(r.payerContext.available,true)});
const history=[row,{...row,id:TX2,amount:30,description:'Outra despesa'},{...row,id:A,transaction_type:'receita',amount:50}];
check('person query uses verified identified recent expenses only and marks scope',()=>{const ctx={...base,text:'E as despesas da Ionara?',ledgerContext:history,payerContext:{...base.payerContext,attributions:[att]}};const r=run('Classificar comando',{ctx,ai:{intent:'outro',management:{action:'list'}}})[0].json;assert.match(r.replyText,/Pagamentos individuais identificados de Ionara/);assert.match(r.replyText,/Mercado teste/);assert.match(r.replyText,/1 despesa\(s\).*sem pagador/);assert.match(r.replyText,/não é um total mensal/);assert.doesNotMatch(r.replyText,/Outra despesa/)});
check('person query recognizes verified Ni without guessing Nicolas alias',()=>{
 const ctx={...base,text:'Quais os gastos do Ni?',ledgerContext:[row],payerContext:{...base.payerContext,participants:[{id:A,display_name:'Ni',active:true},{id:B,display_name:'Ionara',active:true}],attributions:[{...att,participant_ids:[A]}]}};
 const ai={intent:'outro',management:{action:'list'}};
 const r=run('Classificar comando',{ctx,ai})[0].json;
 assert.equal(r.financialStatus,'gestao_consulta_compartilhada');assert.match(r.replyText,/Pagamentos individuais identificados de Ni:/);assert.match(r.replyText,/Mercado teste/);assert.match(r.replyText,/não é um total mensal/);
 const alias=run('Classificar comando',{ctx:{...ctx,text:'Quais os gastos do Nicolas?'},ai})[0].json;
 assert.match(alias.replyText,/De quem você quer consultar/);assert.doesNotMatch(alias.replyText,/Pagamentos individuais identificados|Mercado teste/);
});
check('person query cannot claim ownership when metadata context is unavailable',()=>{const r=run('Classificar comando',{ctx:{...base,text:'Despesas da Ionara?',ledgerContext:history,payerContext:{available:false}},ai:{intent:'outro'}})[0].json;assert.match(r.replyText,/não está disponível/);assert.doesNotMatch(r.replyText,/Mercado teste/)});
check('person query separates joint payment without assigning half',()=>{const ctx={...base,text:'Despesas da Ionara?',ledgerContext:[row],payerContext:{...base.payerContext,attributions:[{...att,kind:'joint',participant_ids:[A,B]}]}};const r=run('Classificar comando',{ctx,ai:{intent:'outro'}})[0].json;assert.match(r.replyText,/Pagamentos conjuntos/);assert.match(r.replyText,/sem divisão presumida/)});
check('person query preserves identified history of inactive payer without allowing new assignment',()=>{const ctx={...base,text:'Despesas da Ionara?',ledgerContext:[row],payerContext:{...base.payerContext,participants:base.payerContext.participants.map(p=>p.id===B?{...p,active:false}:p),attributions:[att]}};const r=run('Classificar comando',{ctx,ai:{intent:'outro'}})[0].json;assert.match(r.replyText,/Pagamentos individuais identificados de Ionara/);assert.match(r.replyText,/Mercado teste/)});
check('recordKey values match original byte-for-byte for single, batch and retry',()=>{
 const original=baseline.nodes.find(n=>n.name==='Preparar itens do lançamento').parameters.jsCode;
 for(const transactions of [[draft()],[draft(),draft(undefined,{amount:30})]])for(const proposalKey of ['qa-source-event','retry-source-event']){
  const ctx={...base,transactions,pendingConfirmation:true,proposalKey};const old=vm.runInNewContext('(function(){'+original+'})()',{$input:{first:()=>({json:ctx})}});
  const updated=run('Preparar itens do lançamento',{ctx});assert.deepEqual(Array.from(updated,x=>x.json.recordKey),Array.from(old,x=>x.json.recordKey));assert.deepEqual(Array.from(updated,x=>x.json.itemIndex),Array.from(old,x=>x.json.itemIndex));
 }
});
check('no metadata failure path points to financial create',()=>{for(const name of ['Preparar identificação confirmada','Salvar identificação confirmada?','Salvar pagador confirmado','Conferir identificação salva']){const serialized=JSON.stringify(contract.connections[name]);assert.doesNotMatch(serialized,/Criar lançamento|Verificar idempotência/)};});
check('contract excludes credentials and HTTP authorization headers',()=>{assert.equal(contract.nodes.some(n=>n.credentials),false);assert.equal(contract.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest').some(n=>n.parameters.headerParameters),false)});
check('frozen payer proposals bypass conversation AI before confirmation',()=>{
 const condition=contract.nodes.find(n=>n.name==='Resposta verificada?').parameters.conditions.conditions[0].leftValue;
 const expr=condition.slice(4,-3);
 const valid={conversationStatus:'aguardando_confirmacao',pendingProposal:{transactions:[{payerFrozenVersion:1,payer:payer()}]}};
 const legacy={conversationStatus:'aguardando_confirmacao',pendingProposal:{transactions:[draft()]}};
 assert.equal(vm.runInNewContext(expr,{$json:valid}),true);
 assert.equal(vm.runInNewContext(expr,{$json:legacy}),false);
 assert.equal(vm.runInNewContext(expr,{$json:{conversationStatus:'registrado'}}),true);
});
check('audio-transcribed proposal keeps visible labels and frozen payer before direct reply',()=>{
 const {result,state}=proposal([draft()],{audioTranscribed:true,originalMediaKind:'audio'});
 assert.equal(result.financialStatus,'aguardando_confirmacao');assert.match(result.replyText,/Pagador: Ionara/);
 const condition=contract.nodes.find(n=>n.name==='Resposta verificada?').parameters.conditions.conditions[0].leftValue.slice(4,-3);
 assert.equal(vm.runInNewContext(condition,{$json:{conversationStatus:result.financialStatus,pendingProposal:state.pending[base.chatId]}}),true);
});
// Run the original 17 financial cases with the updated reviewed classifier and item preparation.
check('original 17 mixed-transaction regression checks pass with overlay',()=>{
 const overlaid={...baseline,nodes:baseline.nodes.map(n=>contract.nodes.find(x=>x.name===n.name)||n)};
 const source=fs.readFileSync(path.join(__dirname,'../finance-text-batch/test.cjs'),'utf8');
 const output=[];const fakeProcess={exitCode:0};
 const fakeRequire=name=>name==='node:fs'?{...fs,readFileSync:(filename,...rest)=>String(filename).endsWith('contract.json')?JSON.stringify(overlaid):fs.readFileSync(filename,...rest)}:require(name);
 vm.runInNewContext(source,{require:fakeRequire,__dirname:path.join(__dirname,'../finance-text-batch'),console:{log:line=>output.push(String(line)),error:line=>output.push(String(line))},process:fakeProcess,structuredClone},{timeout:10000});
 assert.equal(fakeProcess.exitCode,0,output.join('\n'));assert.ok(output.some(line=>line.includes('"checks":17')&&line.includes('"passed":true')),output.join('\n'));
});
console.log(JSON.stringify({checks,passed:!process.exitCode}));
