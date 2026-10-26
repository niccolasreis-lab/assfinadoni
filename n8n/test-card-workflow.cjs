const fs=require('fs'),assert=require('node:assert/strict');
const w=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));const nodes=new Map(w.nodes.map(n=>[n.name,n]));const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
const context={chatId:'fixture',senderId:'fixture-sender',messageId:'fixture-first',user:{id:'11111111-1111-4111-8111-111111111111'},today:'2026-10-26',mediaKind:'text',text:'Paguei R$ 42,50 no mercado com cartão Nubank',categoryContext:{available:true,categories:[{name:'Lazer'},{name:'Alimentação'},{name:'Outros'}]},payerContext:{available:false,participants:[]}};
const state={};
async function classify(ai,ctx=context){const fn=new AsyncFunction('$input','$','$getWorkflowStaticData',nodes.get('Classificar comando').parameters.jsCode);return (await fn({first:()=>({json:{output:JSON.stringify(ai)}})},()=>({first:()=>({json:ctx})}),()=>state))[0].json;}
(async()=>{
 const proposal=await classify({intent:'novo_lancamento',new_transactions:[{amount:42.5,description:'Mercado',category:'Alimentação',transaction_date:context.today,transaction_type:'despesa',payment_method:'cartao',card_name:'Nubank',payer:{kind:'unknown',participant_ids:[]}}]});
 assert.equal(proposal.route,'reply');assert.match(proposal.replyText,/Nubank/);assert.equal(state.pending.fixture.transactions[0].payment_details.card_name,'Nubank');
 const adjusted=await classify({intent:'ajustar_pendente',category:'Lazer'}, {...context,text:'categoria lazer',messageId:'fixture-adjust'});
 assert.equal(adjusted.route,'reply');assert.equal(state.pending.fixture.transactions[0].payment_details.card_name,'Nubank');
 const confirmation=await classify({intent:'confirmar_pendente',payment_method:'cartao',card_name:'Nubank',category:'Lazer'}, {...context,text:'Sim. Cartão de crédito Nubank, lazer.',messageId:'fixture-confirm'});
 assert.equal(confirmation.route,'transaction');assert.equal(confirmation.transactions[0].payment_details.card_name,'Nubank');assert.equal(confirmation.proposalKey,'fixture-first');assert.equal(confirmation.pendingConfirmation,true);
 const pix=await classify({intent:'ajustar_pendente',payment_method:'pix'}, {...context,text:'foi no Pix',messageId:'fixture-pix'});
 assert.equal(pix.route,'reply');assert.equal(state.pending.fixture.transactions[0].payment_details.card_name,undefined);
 const noEvidence=await classify({intent:'confirmar_pendente',payment_method:'cartao',card_name:'Outro cartão'}, {...context,text:'sim',messageId:'fixture-hallucination'});
 assert.equal(noEvidence.route,'reply');assert.match(noEvidence.replyText,/informado por você/);
 const rpc=nodes.get('Criar lançamento');assert(rpc.parameters.url.endsWith('/finance_whatsapp_record_transaction'));assert.match(rpc.parameters.jsonBody,/p_confirmed:/);
 console.log('PASS: proposal, card confirmation, category preservation, Pix clearing, invented card rejected, atomic RPC');
})().catch(e=>{console.error(e);process.exitCode=1});
