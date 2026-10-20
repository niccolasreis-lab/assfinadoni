export function payerAttributionCases(assert,api) {
 const W='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
 const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',OUT='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const T='10000000-0000-4000-8000-000000000001',T2='10000000-0000-4000-8000-000000000002',T3='10000000-0000-4000-8000-000000000003';
 const participants=[{id:A,finance_user_id:W,active:true,name:'Pessoa A'},{id:B,finance_user_id:W,active:true,name:'Pessoa B'},{id:OUT,finance_user_id:OTHER,active:true,name:'Pessoa externa'}];
 const ctx={walletId:W,participants};
 const choose=x=>api.normalizePayerSelection(x,ctx);
 const tx=(id,amount,extra={})=>({id,user_id:W,transaction_type:'despesa',amount,...extra});
 const att=(transaction_id,kind,participant_ids=[])=>({transaction_id,finance_user_id:W,kind,participant_ids});
 const sum=(transactions,attributions=[],extra={})=>api.summarizeExpensesByPayer({...ctx,transactions,attributions,...extra});
 return [
 ['ausência de responsável permanece desconhecida',()=>assert.deepEqual(choose(undefined),{kind:'unknown',participant_ids:[]})],
 ['autor identificado não se torna pagador',()=>{assert.equal(api.normalizeRecorder(A,ctx),A);assert.equal(choose(null).kind,'unknown')}],
 ['pagador pode ser diferente do autor',()=>{assert.equal(api.normalizeRecorder(A,ctx),A);assert.deepEqual(choose({kind:'participant',participant_ids:[B]}),{kind:'participant',participant_ids:[B]})}],
 ['nome citado não é aceito como identidade',()=>assert.throws(()=>choose({kind:'participant',participant_ids:['Pessoa B']}))],
 ['participante de outra carteira é recusado',()=>assert.throws(()=>choose({kind:'participant',participant_ids:[OUT]}))],
 ['autor de outra carteira é recusado',()=>assert.throws(()=>api.normalizeRecorder(OUT,ctx))],
 ['participante inativo não recebe nova atribuição',()=>assert.throws(()=>api.normalizePayerSelection({kind:'participant',participant_ids:[A]},{...ctx,participants:participants.map(p=>({...p,active:false}))}))],
 ['pagamento conjunto exige duas pessoas diferentes',()=>{assert.throws(()=>choose({kind:'joint',participant_ids:[A]}));assert.throws(()=>choose({kind:'joint',participant_ids:[A,A]}))}],
 ['desconhecido não aceita uma pessoa oculta',()=>assert.throws(()=>choose({kind:'unknown',participant_ids:[A]}))],
 ['individual não aceita vários pagadores',()=>assert.throws(()=>choose({kind:'participant',participant_ids:[A,B]}))],
 ['seleção conjunta é canônica sem mutar a entrada',()=>{const input={kind:'joint',participant_ids:[B,A]};assert.deepEqual(choose(input).participant_ids,[A,B]);assert.deepEqual(input.participant_ids,[B,A])}],
 ['histórico sem atribuição fica desconhecido',()=>assert.equal(sum([tx(T,'12.30')]).unknown_cents,1230)],
 ['receitas e lixeira não entram como despesas',()=>{const r=sum([tx(T,100,{transaction_type:'receita'}),tx(T2,10,{deleted_at:'2026-10-20'})]);assert.equal(r.total_cents,0);assert.equal(r.transaction_count,0)}],
 ['outra carteira não vaza no resumo',()=>assert.equal(sum([tx(T,12,{user_id:OTHER})],[{...att(T,'participant',[OUT]),finance_user_id:OTHER}]).total_cents,0)],
 ['centavos são somados exatamente',()=>{const r=sum([tx(T,'0.10'),tx(T2,'0.20')]);assert.equal(r.total_cents,30);assert.equal(r.unknown_cents,30)}],
 ['pagamento conjunto não duplica o total individual',()=>{const r=sum([tx(T,'30.00')],[att(T,'joint',[A,B])]);assert.equal(r.total_cents,3000);assert.equal(r.joint_cents,3000);assert.deepEqual(r.individual_cents,[])}],
 ['valores iguais em compras distintas são preservados',()=>assert.equal(sum([tx(T,20),tx(T2,20)]).transaction_count,2)],
 ['mesma linha repetida na consulta não duplica o total',()=>assert.equal(sum([tx(T,20),tx(T,20)]).total_cents,2000)],
 ['linhas repetidas com valores diferentes impedem resumo enganoso',()=>assert.throws(()=>sum([tx(T,20),tx(T,21)]))],
 ['atribuição externa não transfere despesa',()=>assert.equal(sum([tx(T,20)],[{...att(T,'participant',[A]),finance_user_id:OTHER}]).unknown_cents,2000)],
 ['atribuição duplicada é rejeitada',()=>assert.throws(()=>sum([tx(T,20)],[att(T,'participant',[A]),att(T,'participant',[B])]))],
 ['histórico preserva participante que ficou inativo',()=>assert.equal(sum([tx(T,20)],[att(T,'participant',[A])],{participants:participants.map(p=>({...p,active:false}))}).individual_cents[0].amount_cents,2000)],
 ['resumo é reconciliável entre pessoas, conjunto e desconhecido',()=>{const r=sum([tx(T,10),tx(T2,20),tx(T3,30)],[att(T,'participant',[A]),att(T2,'joint',[A,B])]);assert.equal(r.total_cents,r.unknown_cents+r.joint_cents+r.individual_cents.reduce((n,p)=>n+p.amount_cents,0));assert.equal(r.transaction_count,3)}],
 ['valores inválidos e precisão extra são recusados',()=>{for(const amount of [-1,0,'1.001','1e4',NaN,true])assert.throws(()=>sum([tx(T,amount)]))}],
 ['consulta e metadados não são modificados',()=>{const rows=[tx(T,'10.00')],meta=[att(T,'participant',[B])];const before=JSON.stringify([rows,meta]);sum(rows,meta);assert.equal(JSON.stringify([rows,meta]),before)}],
 ];}
