export function payerAttributionScopeCases(assert,api) {
 const W='11111111-1111-4111-8111-111111111111',W2='22222222-2222-4222-8222-222222222222';
 const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const T='10000000-0000-4000-8000-000000000001',U='10000000-0000-4000-8000-000000000002';
 const scope={coverage:'complete',date_from:'2026-10-01',date_to:'2026-10-31'};
 const members=[{id:A,finance_user_id:W,active:true,name:'Mesmo nome'},{id:B,finance_user_id:W2,active:true,name:'Mesmo nome'}];
 const tx=(id,user_id,amount,extra={})=>({id,user_id,amount,transaction_type:'despesa',transaction_date:'2026-10-20',...extra});
 const attr=(transaction_id,finance_user_id,participant_id)=>({transaction_id,finance_user_id,kind:'participant',participant_ids:[participant_id]});
 const base={walletIds:[W,W2],participants:members,transactions:[tx(T,W,10),tx(U,W2,20)],attributions:[attr(T,W,A),attr(U,W2,B)],scope};
 const run=extra=>api.summarizeExpenseScopeByPayer({...base,...extra});
 const page={...scope,coverage:'page',pagination:{page:1,page_size:50,has_more:false}};
 return [
 ['duas carteiras reconciliam o total sem perder a segunda',()=>{const r=run({});assert.equal(r.totals.total_cents,3000);assert.equal(r.by_wallet.length,2);assert.equal(r.totals.individually_attributed_cents,3000)}],
 ['nomes iguais não fundem participantes de carteiras distintas',()=>{const r=run({});assert.equal(r.by_wallet[0].individual_cents[0].participant_id,A);assert.equal(r.by_wallet[1].individual_cents[0].participant_id,B)}],
 ['carteira não autorizada é excluída',()=>assert.equal(run({walletIds:[W]}).totals.total_cents,1000)],
 ['vínculo de outra carteira não transfere autoria',()=>assert.throws(()=>run({attributions:[attr(T,W,B)]}))],
 ['mesma carteira repetida não dobra o total',()=>assert.throws(()=>run({walletIds:[W,W]}))],
 ['resumo vazio ainda informa período e cobertura',()=>{const r=run({transactions:[]});assert.equal(r.totals.total_cents,0);assert.equal(r.scope.coverage,'complete');assert.equal(r.scope.date_from,scope.date_from)}],
 ['página final não é anunciada como período completo',()=>{const r=run({scope:page});assert.equal(r.scope.coverage,'page');assert.equal(r.scope.pagination.has_more,false)}],
 ['resumo completo rejeita paginação contraditória',()=>assert.throws(()=>run({scope:{...scope,pagination:page.pagination}}))],
 ['página exige descrição completa da paginação',()=>assert.throws(()=>run({scope:{...scope,coverage:'page'}}))],
 ['página excedente é rejeitada',()=>assert.throws(()=>run({scope:{...page,pagination:{page:1,page_size:1,has_more:true}}}))],
 ['data fora do período não entra no total',()=>assert.equal(run({transactions:[tx(T,W,10,{transaction_date:'2026-09-30'}),tx(U,W2,20)]}).totals.total_cents,2000)],
 ['datas de período inválidas são rejeitadas',()=>{for(const x of [{...scope,date_from:'2026-02-31'},{...scope,date_from:'2026-11-01'}])assert.throws(()=>run({scope:x}))}],
 ['metadados fora do recorte não derrubam a consulta',()=>assert.equal(run({transactions:[tx(T,W,10)],attributions:[attr(U,W2,B),attr(U,W2,B)]}).totals.unknown_cents,1000)],
 ['receita e lixeira não entram no resumo por pagador',()=>assert.equal(run({transactions:[tx(T,W,10,{transaction_type:'receita'}),tx(U,W2,20,{deleted_at:'2026-10-20'})]}).totals.total_cents,0)],
 ['atribuição duplicada no recorte é rejeitada',()=>assert.throws(()=>run({attributions:[attr(T,W,A),attr(T,W,A)]}))],
 ['entrada não sofre mutação',()=>{const before=JSON.stringify(base);run({});assert.equal(JSON.stringify(base),before)}],
 ];}
