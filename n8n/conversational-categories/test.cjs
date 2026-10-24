/* Sanitized workflow tests: no network, private snapshots, DB, or message sends. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const os=require('node:os'),cp=require('node:child_process');
const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'contract.json'),'utf8'));
const code=name=>{const n=contract.nodes.find(n=>n.name===name);assert.ok(n?.parameters?.jsCode,'Missing code '+name);return n.parameters.jsCode};
const W='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222',ID='10000000-0000-4000-8000-000000000001';
const base={chatId:'qa-categories',senderId:'qa-person',messageId:'qa-message',user:{id:W},today:'2026-10-24',text:'',mediaKind:'text',intentInput:'{}',ledgerContext:[],payerContext:{available:false},categoryContext:{available:true,categories:[{name:'Recorrencia'},{name:'CASA Nova'}]}};
const key=base.chatId+':'+base.senderId;
const tx=(extra={})=>({id:ID,user_id:W,amount:'100.00',description:'Internet teste',category:'Assinaturas',transaction_type:'despesa',transaction_date:'2026-10-24',payment_details:{method:'pix'},payer:{kind:'unknown',participant_ids:[]},payerLabel:'não identificado',payerFrozenVersion:1,...extra});
const proposal=(rows=[tx()])=>({pending:{[base.chatId]:{transactions:rows,sourceMessageId:'qa-original',at:Date.now()}}});
function run(name,{ctx=base,input,ai,state={},named={},binary}={}){
 const data={json:ai?{output:JSON.stringify(ai)}:input===undefined?ctx:input,...(binary?{binary}:{} )};
 const pick=n=>named[n]??ctx;
 const env={$input:{first:()=>data,all:()=>[data],item:data},$:n=>({first:()=>({json:pick(n)}),item:{json:pick(n)},isExecuted:false}),$getWorkflowStaticData:()=>state,$now:{setZone:()=>({toISO:()=> '2026-10-24T12:00:00-03:00'})},Buffer,structuredClone};
 return vm.runInNewContext('(function(){'+code(name)+'})()',env,{timeout:4000});
}
const classify=(category,extra={})=>run('Classificar comando',{ai:{intent:'outro',category_action:category},...extra});
let checks=0;
const check=(name,fn)=>{try{fn();checks++;console.log('PASS '+name)}catch(e){process.exitCode=1;console.error('FAIL '+name+' '+e.stack)}};
check('explicit category creation routes metadata only, preserving exact canonical spelling',()=>{
 const r=classify({action:'create',name:'Recorrência',target:'none'})[0].json;assert.equal(r.route,'category_execute');assert.equal(r.categoryValues.name,'Recorrencia');assert.equal(r.categoryOperation,'create');assert.equal(r.transactions,undefined);
});
check('explicit creation also reaches RPC for a legacy catalog name',()=>{
 const r=classify({action:'create',name:'CASA Nova',target:'none'})[0].json;assert.equal(r.route,'category_execute');assert.equal(r.categoryValues.name,'CASA Nova');
});
check('catalog registered spelling wins over built-in and accent aliases',()=>{
 const ctx={...base,categoryContext:{available:true,categories:[{name:'ALIMENTACAO'},{name:'Recorrencia'}]}};
 const r=classify({action:'create',name:'alimentação',target:'none'},{ctx})[0].json;assert.equal(r.categoryValues.name,'ALIMENTACAO');
});
check('one or sixty-one character names fail before an RPC',()=>{
 for(const name of ['A','x'.repeat(61),'Nome@pessoa','<script>','\nNome']){const r=classify({action:'create',name,target:'none'})[0].json;assert.equal(r.route,'reply');assert.equal(r.financialStatus,'alerta_categoria');}
});
check('name validation accepts the same simple punctuation as the catalog RPC',()=>{
 for(const name of ["Casa & Família","Plano d’água","Casa/Obras (2026)","Casa-Nova"]){assert.equal(classify({action:'create',name,target:'none'})[0].json.route,'category_execute');}
});
check('catalog outage does not announce creation or switch a custom category to Outros',()=>{
 const ctx={...base,categoryContext:{available:false,categories:[]}};const r=classify({action:'create',name:'Recorrencia',target:'none'},{ctx})[0].json;assert.equal(r.route,'reply');assert.match(r.replyText,/Não consegui consultar/);
});
check('listing categories uses verified supplied catalog plus defaults',()=>{
 const r=classify({action:'list'})[0].json;assert.match(r.replyText,/Recorrencia/);assert.match(r.replyText,/Alimentação/);assert.equal(r.route,'reply');
});
check('create RPC success does not claim any expense was changed',()=>{
 const ctx={...base,categoryValues:{name:'Recorrencia'},categoryTarget:'none'};const r=run('Confirmar categoria da carteira',{ctx,input:{ok:true,created:true,category:{name:'Recorrencia'},categories:[{name:'Recorrencia'}]}})[0].json;assert.match(r.replyText,/Criei a categoria Recorrencia/);assert.match(r.replyText,/Nenhum lançamento foi alterado/);
});
check('unacknowledged category RPC cannot announce creation',()=>{
 const ctx={...base,categoryValues:{name:'Recorrencia'}};const r=run('Confirmar categoria da carteira',{ctx,input:{error:{message:'network'}}})[0].json;assert.match(r.replyText,/Não consegui confirmar/);
});
check('single pending category change preserves every other transaction field and original event',()=>{
 const state=proposal();const old=structuredClone(state.pending[base.chatId]);const r=classify({action:'apply',name:'Recorrência',target:'pending'},{state})[0].json;
 assert.equal(r.financialStatus,'aguardando_confirmacao');assert.equal(r.verifiedCategoryProposal,true);assert.equal(r.route,'reply');const changed=state.pending[base.chatId].transactions[0];assert.equal(changed.category,'Recorrencia');const a={...old.transactions[0]},b={...changed};delete a.category;delete b.category;assert.equal(JSON.stringify(a),JSON.stringify(b));assert.equal(state.pending[base.chatId].sourceMessageId,'qa-original');
});
check('multiple pending items require an explicit selection; nos dois can continue the same scoped category draft',()=>{
 const state=proposal([tx(),tx({id:undefined,amount:'25.00',transaction_type:'receita',description:'Reembolso teste'})]);const first=classify({action:'apply',name:'Recorrencia',target:'pending'},{state})[0].json;assert.equal(first.financialStatus,'alerta_categoria');assert.equal(state.pending[base.chatId].transactions[0].category,'Assinaturas');
 const second=classify({action:'apply',name:null,target:'pending',apply_all:true},{state})[0].json;assert.equal(second.financialStatus,'aguardando_confirmacao');assert.ok(state.pending[base.chatId].transactions.every(t=>t.category==='Recorrencia'));assert.equal(state.pending[base.chatId].transactions[1].transaction_type,'receita');
});
check('item selection changes only requested pending positions',()=>{
 const state=proposal([tx(),tx({id:undefined,amount:'20.00'})]);classify({action:'apply',name:'Recorrencia',target:'pending',item_numbers:[2]},{state});assert.equal(state.pending[base.chatId].transactions[0].category,'Assinaturas');assert.equal(state.pending[base.chatId].transactions[1].category,'Recorrencia');
});
check('a changed pending event cannot inherit an old item-selection authorization',()=>{
 const state=proposal([tx(),tx({id:undefined,amount:'20.00'})]);classify({action:'apply',name:'Recorrencia',target:'pending'},{state});state.pending[base.chatId].sourceMessageId='different-event';const r=classify({action:'apply',name:null,target:'pending',apply_all:true},{state})[0].json;assert.match(r.replyText,/proposta.*mudou/i);assert.equal(state.pending[base.chatId].transactions[0].category,'Assinaturas');
});
check('category conversation context cannot cross wallet, sender, or expiry',()=>{
 for(const draft of [{userId:OTHER,at:Date.now(),name:'Recorrencia'},{userId:W,at:Date.now()-16*60*1000,name:'Recorrencia'}]){
  const state={categoryConversations:{[key]:draft}};const r=classify({action:'apply',name:null,target:'pending'},{state})[0].json;assert.match(r.replyText,/Qual nome/);
 }
 const state={categoryConversations:{[base.chatId+':other-sender']:{userId:W,at:Date.now(),name:'Recorrencia'}}};assert.match(classify({action:'apply',name:null,target:'pending'},{state})[0].json.replyText,/Qual nome/);
});
check('new custom category on a transaction is resolved; an unknown explicit category cannot silently become Outros',()=>{
 for(const category of ['Recorrência','Inexistente']){
  const state={};const r=run('Classificar comando',{ctx:{...base,text:'Paguei100internet categoria '+category},state,ai:{intent:'novo_lancamento',new_transactions:[{amount:100,description:'Internet',category,transaction_type:'despesa',transaction_date:base.today,payer:{kind:'unknown',participant_ids:[]}}]}})[0].json;
  if(category==='Recorrência'){assert.equal(state.pending[base.chatId].transactions[0].category,'Recorrencia');assert.equal(r.financialStatus,'aguardando_confirmacao');}else{assert.equal(state.pending?.[base.chatId],undefined);assert.equal(r.financialStatus,'alerta_categoria');}
 }
});
check('a category label named Recorrencia is not mistaken for an automatic recurrence schedule',()=>{
 const state={};const r=run('Classificar comando',{ctx:{...base,text:'Inclua100,00 despesa na categoria Recorrencia'},state,ai:{intent:'novo_lancamento',new_transactions:[{amount:100,description:'Internet',category:'Recorrencia',transaction_type:'despesa',transaction_date:base.today,payer:{kind:'unknown',participant_ids:[]}}]}})[0].json;
 assert.equal(r.financialStatus,'aguardando_confirmacao');assert.equal(state.pending[base.chatId].transactions[0].category,'Recorrencia');assert.doesNotMatch(r.replyText,/recorrentes automaticamente/);
});
check('unknown-category source data survives category creation without auto-registering its transaction',()=>{
 const state={};const ctx={...base,text:'Paguei100internet categoria Nova categoria'};
 run('Classificar comando',{ctx,state,ai:{intent:'novo_lancamento',new_transactions:[{amount:100,description:'Internet',category:'Nova categoria',transaction_type:'despesa',transaction_date:base.today,payer:{kind:'unknown',participant_ids:[]}}]}});
 const request=classify({action:'create',name:'Nova categoria',target:'none'},{ctx,state})[0].json;
 run('Confirmar categoria da carteira',{ctx:request,state,input:{ok:true,created:true,category:{name:'Nova categoria'}}});
 assert.equal(state.categoryConversations[key].sourceText,ctx.text);assert.equal(state.categoryConversations[key].sourceMessageId,ctx.messageId);assert.equal(state.pending?.[base.chatId],undefined);
});
check('async category creation cannot apply to a replacement pending transaction',()=>{
 const state=proposal();const request=classify({action:'create',name:'Nova categoria',target:'pending'},{state})[0].json;state.pending[base.chatId].sourceMessageId='replacement';
 const r=run('Confirmar categoria da carteira',{ctx:request,state,input:{ok:true,created:true,category:{name:'Nova categoria'}}})[0].json;assert.match(r.replyText,/proposta.*mudou/i);assert.equal(state.pending[base.chatId].transactions[0].category,'Assinaturas');
});
check('legacy pending category adjustment uses the current catalog without changing payer data',()=>{
 const state=proposal();const r=run('Classificar comando',{ctx:{...base,text:'Use categoria Recorrência'},state,ai:{intent:'ajustar_pendente',category:'Recorrência'}})[0].json;assert.equal(state.pending[base.chatId].transactions[0].category,'Recorrencia');assert.equal(state.pending[base.chatId].transactions[0].payerFrozenVersion,1);assert.equal(r.route,'reply');
});
check('existing selected category adjustment creates only the established edit-confirmation proposal',()=>{
 const row=tx();const ctx={...base,ledgerContext:[row]};const state={management:{[key]:{userId:W,at:Date.now(),rows:[row],selected:row}}};const r=classify({action:'apply',name:'Recorrencia',target:'selected'},{ctx,state})[0].json;
 assert.equal(r.financialStatus,'gestao_confirmacao');assert.equal(r.route,'reply');assert.equal(state.management[key].proposal.kind,'update');assert.deepEqual({...state.management[key].proposal.changes},{category:'Recorrencia'});assert.equal(state.management[key].proposal.record.category,'Assinaturas');assert.equal(row.category,'Assinaturas');
});
check('existing-category confirmation continues through the original management edit route',()=>{
 const row=tx(),ctx={...base,ledgerContext:[row]},state={management:{[key]:{userId:W,at:Date.now(),rows:[row],selected:row}}};classify({action:'apply',name:'Recorrencia',target:'selected'},{ctx,state});
 const token=state.management[key].proposal.token;const r=run('Classificar comando',{ctx:{...ctx,text:'Pode deixar assim'},state,ai:{intent:'outro',management:{action:'confirm',confirm_operation_id:token}}})[0].json;assert.equal(r.route,'manage_update');assert.equal(r.manageChanges.category,'Recorrencia');
});
check('new category creation with selected target proposes an edit without writing a financial record',()=>{
 const row=tx(),ctx={...base,ledgerContext:[row],categoryValues:{name:'Nova categoria'},categoryTarget:'selected'};const state={management:{[key]:{userId:W,at:Date.now(),rows:[row],selected:row}}};const r=run('Confirmar categoria da carteira',{ctx,state,input:{ok:true,created:true,category:{name:'Nova categoria'},categories:[{name:'Nova categoria'}]}})[0].json;assert.equal(r.financialStatus,'gestao_confirmacao');assert.equal(state.management[key].proposal.changes.category,'Nova categoria');assert.equal(row.category,'Assinaturas');
});
check('unidentified or foreign existing targets ask instead of applying a category to an arbitrary row',()=>{
 const row=tx({user_id:OTHER}),ctx={...base,ledgerContext:[row]},state={management:{[key]:{userId:W,at:Date.now(),rows:[row],selected:row}}};const r=classify({action:'apply',name:'Recorrencia',target:'selected'},{ctx,state})[0].json;assert.match(r.replyText,/Qual lançamento/);assert.equal(state.management[key].proposal,undefined);
});
const query=(fields,extra={})=>run('Classificar comando',{ai:{intent:'outro',financial_query:{action:'list',...fields}},...extra})[0].json;
check('semantic query resolves canonical category and emits only allowed typed filters',()=>{
 const r=query({category:'Recorrência',type:'despesa',date_from:'2026-10-01',date_to:'2026-10-31',limit:5});assert.equal(r.route,'query_execute');assert.equal(r.queryValues.category,'Recorrencia');assert.deepEqual(Object.keys(r.queryValues).sort(),['action','category','date_from','date_to','limit','search','type'].sort());
});
check('invalid dates, direction, category, payer, SQL and excessive limits do not reach query RPC',()=>{
 for(const fields of [{date_from:'2026-02-30'},{date_from:'2026-11-01',date_to:'2026-10-01'},{type:'transferencia'},{category:'Inexistente'},{payer:'Ionara'},{sql:'select *'},{limit:51},{limit:'5'},{search:'x'.repeat(121)}])assert.equal(query(fields).route,'reply');
});
check('a requested subtotal of only displayed items is clarified rather than replaced with the full-filter total',()=>{
 const r=query({action:'total',limit:3,subset_only:true});assert.equal(r.route,'reply');assert.match(r.replyText,/totais.*todos.*filtros/);assert.equal(r.queryValues,undefined);
});
check('query continuation inherits only the same unexpired wallet/person filters',()=>{
 const filters={action:'total',date_from:'2026-10-01',date_to:'2026-10-31',category:'Recorrencia',type:null,search:null,limit:10};
 const state={queryConversations:{[key]:{at:Date.now(),userId:W,filters}}};const r=query({action:'list',inherit:true,type:'despesa'},{state});assert.equal(r.queryValues.date_from,'2026-10-01');assert.equal(r.queryValues.category,'Recorrencia');assert.equal(r.queryValues.type,'despesa');assert.equal(r.queryValues.limit,10);
 const foreign={queryConversations:{[key]:{at:Date.now(),userId:OTHER,filters}}};const no=query({action:'list',inherit:true},{state:foreign});assert.equal(no.queryValues.category,null);assert.equal(no.queryValues.date_from,null);
});
check('a person query cannot be disguised as description search and return a fictitious zero total',()=>{
 const r=query({search:'Ionara'},{ctx:{...base,text:'Quanto Ionara pagou este mês?'}});assert.equal(r.route,'reply');assert.equal(r.financialStatus,'gestao_consulta_compartilhada');assert.doesNotMatch(r.replyText,/R\$/);
});
const queryValues={action:'list',date_from:null,date_to:null,type:'despesa',category:'Recorrencia',search:null,limit:1};
const rpcResult=()=>({ok:true,filters:{date_from:null,date_to:null,type:'despesa',category:'Recorrencia',search:null},coverage:{complete:true,matchedCount:3,shownCount:1,limit:1},totals:{income:0,expense:300,net:-300},transactions:[{id:ID,transaction_type:'despesa',amount:100,category:'Recorrência',description:'Internet teste',transaction_date:'2026-10-24'}],breakdown:[]});
check('native RPC response without action in filters keeps list and complete totals before pagination',()=>{
 const state={},ctx={...base,queryValues};const r=run('Formatar consulta financeira verificada',{ctx,state,input:rpcResult()})[0].json;assert.match(r.replyText,/Internet teste/);assert.match(r.replyText,/Recorrencia/);assert.match(r.replyText,/300,00/);assert.match(r.replyText,/Mostrando 1 de 3/);assert.equal(state.queryConversations[key].filters.action,'list');
});
check('long descriptions are bounded without truncating the independently verified total or coverage',()=>{
 const response=rpcResult();response.transactions[0].description='x'.repeat(1000);const r=run('Formatar consulta financeira verificada',{ctx:{...base,queryValues},input:response})[0].json;assert.ok(!r.replyText.includes('x'.repeat(181)));assert.match(r.replyText,/300,00/);assert.match(r.replyText,/1 de 3/);
});
check('native flat breakdown uses its exact category/type/count/total contract',()=>{
 const response=rpcResult();response.breakdown=[{category:'Recorrencia',type:'despesa',count:3,total:300}];const r=run('Formatar consulta financeira verificada',{ctx:{...base,queryValues:{...queryValues,action:'breakdown'}},input:response})[0].json;assert.match(r.replyText,/Recorrencia — saídas/);assert.match(r.replyText,/3 lançamento/);
});
check('unavailable, incomplete, null totals and mismatched filters cannot invent totals or update query context',()=>{
 for(const mutate of [r=>r.ok=false,r=>r.coverage.complete=false,r=>r.totals.expense=null,r=>r.totals.income='',r=>r.filters.category='Outros',r=>r.coverage.shownCount=2]){
  const response=rpcResult();mutate(response);const state={};const r=run('Formatar consulta financeira verificada',{ctx:{...base,queryValues},state,input:response})[0].json;assert.match(r.replyText,/Não consegui concluir/);assert.equal(state.queryConversations?.[key],undefined);
 }
});
check('malformed breakdown cannot be cached as a verified query',()=>{
 const response=rpcResult();response.breakdown=[{category:'Recorrencia',type:'despesa',count:2,total:300}];const state={};const r=run('Formatar consulta financeira verificada',{ctx:{...base,queryValues:{...queryValues,action:'breakdown'}},state,input:response})[0].json;assert.match(r.replyText,/Não consegui concluir/);assert.equal(state.queryConversations?.[key],undefined);
});
check('image normalizer uses explicit registered category and preserves date notice',()=>{
 const ctx={...base,mediaKind:'image'},state={};const r=run('Normalizar anexo IA',{ctx,state,input:{text:JSON.stringify({transactions:[{amount:100,description:'Internet',category:'Recorrência',transaction_type:'despesa',transaction_date:null}]})}})[0].json;assert.equal(state.pending[base.chatId].transactions[0].category,'Recorrencia');assert.match(r.replyText,/Data não visível/);assert.equal(r.verifiedAttachmentProposal,true);
});
check('image normalizer refuses an unknown explicit category as a whole batch',()=>{
 const state={};const r=run('Normalizar anexo IA',{ctx:{...base,mediaKind:'image'},state,input:{text:JSON.stringify({transactions:[{amount:100,description:'Internet',category:'Inexistente',transaction_type:'despesa',transaction_date:null}]})}})[0].json;assert.equal(state.pending?.[base.chatId],undefined);assert.equal(r.financialStatus,'alerta_categoria');
});
check('legacy media parser respects the supplied category rather than inferring Assinaturas',()=>{
 const ctx={...base,route:'parse',mediaExtracted:true,mediaTx:{amount:100,description:'Internet',category:'Recorrência',transaction_type:'despesa',transaction_date:base.today}};const state={};run('Interpretar lançamento',{ctx,state});assert.equal(state.pending[base.chatId].transactions[0].category,'Recorrencia');
});
check('safe contract exports no HTTP URLs, credentials, headers or financial writer nodes',()=>{
 for(const n of contract.nodes){assert.equal(n.credentials,undefined);assert.equal(n.parameters?.headerParameters,undefined);assert.equal(n.parameters?.url,undefined);assert.ok(!['Criar lançamento','Atualizar lançamento escolhido','Enviar áudio do Bot do Ni','Responder WhatsApp'].includes(n.name));}
 assert.doesNotMatch(JSON.stringify(contract),/eyJ[A-Za-z0-9_-]{16,}\.|55\d{10,11}/);
});
check('new RPC body expressions have no interior n8n closing delimiter and evaluate to the exact typed payload',()=>{
 const sample={user:{id:W},categoryOperation:'create',categoryValues:{name:'Recorrencia'},queryValues:{action:'total',limit:50}};
 for(const n of contract.nodes.filter(n=>n.rpc)){
  const expression=n.rpcBodyExpression;assert.ok(expression.startsWith('={{ ')&&expression.endsWith(' }}'));
  const inside=expression.slice(4,-3);assert.ok(!inside.includes('}}'),'Interior closing delimiter in '+n.name);
  const payload=JSON.parse(vm.runInNewContext(inside,{$json:sample},{timeout:1000}));assert.equal(payload.p_user_id,W);
  if(n.name==='Consultar categorias da carteira'){assert.equal(payload.p_action,'list');assert.deepEqual(payload.p_values,{});}
  else if(n.name==='Salvar categoria da carteira'){assert.equal(payload.p_action,'create');assert.deepEqual(payload.p_values,{name:'Recorrencia'});}
  else{assert.equal(payload.p_action,undefined);assert.deepEqual(payload.p_values,{action:'total',limit:50});}
 }
});
check('both model output budgets accommodate reasoning while prompts request compact complete responses',()=>{
 for(const name of ['OpenAI Chat Model · intenção em lote','OpenAI Chat Model · omniroute']){const model=contract.nodes.find(n=>n.name===name);assert.equal(model.parameters.options.maxTokens,6000);assert.equal(model.parameters.options.timeout,45000);assert.equal(model.parameters.options.maxRetries,1);assert.equal(model.parameters.model.value,'static-best-coding 2');}
 const prompt=contract.nodes.find(n=>n.name==='AI Agent · intenção financeira').parameters.options.systemMessage;assert.match(prompt,/SAÍDA COMPACTA PRIORITÁRIA/);assert.match(prompt,/sempre com intent/);assert.match(prompt,/omita ações "none"/);assert.match(prompt,/JSON válido e completo/);
 const conversation=contract.nodes.find(n=>n.name==='AI Agent · conversa financeira').parameters.options.systemMessage;assert.match(conversation,/RESPOSTA CURTA E COMPLETA/);assert.match(conversation,/até 2 parágrafos/);assert.match(conversation,/sem acrescentar JSON/);assert.match(conversation,/valor monetário pela metade/);
});
function overlaySuite(folder,expected){
 const dirname=path.join(__dirname,'..',folder),contractPath=path.join(dirname,'contract.json');const old=JSON.parse(fs.readFileSync(contractPath,'utf8'));const replacement={...old,nodes:old.nodes.map(n=>contract.nodes.find(p=>p.name===n.name)||n)};
 const fakeFs={...fs,readFileSync:(file,...args)=>path.resolve(String(file))===path.resolve(contractPath)?JSON.stringify(replacement):fs.readFileSync(file,...args)};
 const output=[],proc={argv:['node','test.cjs'],exitCode:0};vm.runInNewContext(fs.readFileSync(path.join(dirname,'test.cjs'),'utf8'),{require:name=>name==='node:fs'?fakeFs:require(name),__dirname:dirname,process:proc,console:{log:s=>output.push(String(s)),error:s=>output.push(String(s))},structuredClone,Buffer},{timeout:25000});assert.equal(proc.exitCode,0,output.join('\n'));assert.ok(output.some(s=>s.includes('"checks":'+expected)&&s.includes('"passed":true')),output.join('\n'));
}
check('current classifier overlay preserves all 53 payer checks including original mixed batch regressions',()=>overlaySuite('payer-attribution',53));
check('current classifier overlay preserves all 20 input-clarity checks',()=>overlaySuite('finance-input-clarity',20));
check('current image preparation, normalizer and conversation overlay preserves all 30 image regressions',()=>{
 const folder=path.join(__dirname,'../image-reading');const original=JSON.parse(fs.readFileSync(path.join(folder,'contract.json'),'utf8'));
 const overlaid={...original,nodes:original.nodes.map(n=>contract.nodes.find(v=>v.name===n.name)||n)};
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'finance-category-image-'));
 try{const file=path.join(tmp,'contract.json');fs.writeFileSync(file,JSON.stringify(overlaid));const r=cp.spawnSync(process.execPath,[path.join(folder,'test.cjs'),'--contract',file],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);assert.match(r.stdout,/"checks":30,"passed":30,"failed":0/);}finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
console.log(JSON.stringify({checks,passed:!process.exitCode,networkCalls:0,financialWrites:0}));
