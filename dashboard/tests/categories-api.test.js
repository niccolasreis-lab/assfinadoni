import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/categories.js';
import { setSession } from '../lib/server.js';

process.env.SESSION_SECRET = 'segredo-para-testar-categorias-mais-de-trinta-e-dois';
process.env.SUPABASE_URL = 'https://teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-key';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OWN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHARED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000005'];
const accounts = [{id:A,username:'person_a',display_name:'Pessoa A',session_version:1,active:true,finance_user_id:OWN_A},{id:B,username:'person_b',display_name:'Pessoa B',session_version:1,active:true,finance_user_id:OWN_B}];
const cookie = account => {let value;setSession({setHeader(_name,header){value=header.split(';')[0];}},account);return value;};
const response = () => ({statusCode:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(value){this.statusCode=value;return this;},json(value){this.body=value;}});
const json = value => ({ok:true,status:200,json:async()=>value});
const row = (id,name,wallet) => ({id,name,finance_user_id:wallet,created_at:'2026-10-23T12:00:00Z'});

test('category API binds shared labels to explicit session memberships and keeps writes personal', async t => {
  const originalFetch = globalThis.fetch;
  let calls=[], memberships, rows, failMembership=false, activeAccount;
  globalThis.fetch = async (url,options) => {
    const parsed=new URL(url), name=parsed.pathname.split('/').at(-1);calls.push({name,params:parsed.searchParams,options});
    if(name==='dashboard_accounts')return json([activeAccount || accounts.find(a=>'eq.'+a.id===parsed.searchParams.get('id'))].filter(Boolean));
    if(name==='finance_dashboard_couple_memberships'){
      if(failMembership)return {ok:false,status:503,json:async()=>({code:'unavailable'})};
      return json(memberships ?? accounts.filter(a=>'eq.'+a.id===parsed.searchParams.get('account_id')).map(a=>({account_id:a.id,finance_user_id:SHARED})));
    }
    if(name==='finance_categories'&&options.method==='POST')return json([{id:ids[0],...JSON.parse(options.body)}]);
    if(name==='finance_categories')return json(rows || []);
    throw new Error('Unexpected backend request '+name);
  };
  const run=async({account=accounts[0],method='GET',query={},body,headers={}}={})=>{
    calls=[];const out=response();await handler({method,query,body,headers:{cookie:cookie(account),host:'finance.example',origin:'https://finance.example','content-type':'application/json',...headers}},out);return out;
  };
  try {
    await t.test('own and authorized shared labels are merged without losing distinct exact filter options',async()=>{
      memberships=[{account_id:A,finance_user_id:SHARED},{account_id:A,finance_user_id:SHARED.toUpperCase()}];
      rows=[row(ids[0],'Recorrência',OWN_A),row(ids[1],'Recorrencia',SHARED),row(ids[2],'Alimentação',SHARED),row(ids[3],'Internet',OWN_A)];
      const r=await run();assert.equal(r.statusCode,200);assert.deepEqual(new Set(r.body.categories.map(x=>x.name)),new Set(['Alimentação','Internet','Recorrência','Recorrencia']));
      assert.deepEqual(r.body.categories.slice(0,2).map(x=>x.name),['Alimentação','Internet']);assert.equal(r.body.categories.find(x=>x.name==='Recorrência').id,ids[0]);assert.equal(r.body.categories.find(x=>x.name==='Recorrencia').id,ids[1]);assert.ok(r.body.categories.every(x=>!Object.hasOwn(x,'finance_user_id')));
      const membershipCall=calls.find(c=>c.name==='finance_dashboard_couple_memberships');assert.equal(membershipCall.params.get('account_id'),'eq.'+A);
      const categoryCall=calls.find(c=>c.name==='finance_categories');assert.equal(categoryCall.params.get('finance_user_id'),`in.(${OWN_A},${SHARED})`);
    });
    await t.test('browser-supplied account, wallet and scope fields cannot broaden access',async()=>{
      memberships=[{account_id:A,finance_user_id:SHARED},{account_id:B,finance_user_id:OTHER},{account_id:A,finance_user_id:'bad),or=(true'}];
      rows=[row(ids[0],'Shared category',SHARED),row(ids[1],'Foreign category',OTHER),row(ids[2],'Partner personal',OWN_B),row('invalid','Bad category',OWN_A)];
      const r=await run({query:{account_id:B,finance_user_id:OTHER,wallet_ids:[OTHER],scope:'all'}});assert.equal(r.statusCode,200);assert.deepEqual(r.body.categories.map(x=>x.name),['Shared category']);
      const categoryCall=calls.find(c=>c.name==='finance_categories');assert.equal(categoryCall.params.get('finance_user_id'),`in.(${OWN_A},${SHARED})`);assert.equal(String(categoryCall.params).includes(OTHER),false);
    });
    await t.test('both members see the shared label while their private labels remain isolated',async()=>{
      memberships=undefined;
      rows=[row(ids[0],'Private A',OWN_A),row(ids[1],'Private B',OWN_B),row(ids[2],'Recorrencia',SHARED)];
      const a=await run();assert.deepEqual(a.body.categories.map(x=>x.name),['Private A','Recorrencia']);
      const b=await run({account:accounts[1]});assert.deepEqual(b.body.categories.map(x=>x.name),['Private B','Recorrencia']);
      assert.equal(calls.find(c=>c.name==='finance_dashboard_couple_memberships').params.get('account_id'),'eq.'+B);
    });
    await t.test('a member without shared access reads only the personal wallet',async()=>{
      memberships=[];rows=[row(ids[0],'Personal',OWN_A),row(ids[1],'Shared',SHARED)];
      const r=await run();assert.deepEqual(r.body.categories.map(x=>x.name),['Personal']);
      assert.equal(calls.find(c=>c.name==='finance_categories').params.get('finance_user_id'),`in.(${OWN_A})`);
    });
    await t.test('exact NFC duplicates collapse while accent, case and whitespace variants keep their stored labels',async()=>{
      memberships=[{account_id:A,finance_user_id:SHARED}];
      rows=[row(ids[0],'Nova  Recorrência',OWN_A),row(ids[1],'Nova  Recorre\u0302ncia',SHARED),row(ids[2],'NOVA RECORRENCIA',SHARED),row(ids[3],'nova recorrência',SHARED),row(ids[4],'<script>',SHARED)];
      const r=await run();assert.deepEqual(new Set(r.body.categories.map(x=>x.name)),new Set(['Nova  Recorrência','NOVA RECORRENCIA','nova recorrência']));assert.equal(r.body.categories.find(x=>x.name==='Nova  Recorrência').id,ids[0]);
    });
    await t.test('category creation still writes only the account personal wallet and does not consult memberships',async()=>{
      const r=await run({method:'POST',body:{name:'Recorrencia',finance_user_id:SHARED,account_id:B},query:{finance_user_id:OTHER}});assert.equal(r.statusCode,201);
      const write=calls.find(c=>c.name==='finance_categories');assert.equal(write.options.method,'POST');assert.deepEqual(JSON.parse(write.options.body),{finance_user_id:OWN_A,name:'Recorrencia'});
      assert.equal(calls.some(c=>c.name==='finance_dashboard_couple_memberships'),false);
    });
    await t.test('membership failures do not leak labels or silently claim a complete catalog',async()=>{
      failMembership=true;const r=await run();assert.equal(r.statusCode,500);assert.equal(r.body.categories,undefined);assert.equal(calls.some(c=>c.name==='finance_categories'),false);failMembership=false;
    });
    await t.test('invalid database wallet identifiers cannot become backend filter syntax',async()=>{
      activeAccount={...accounts[0],finance_user_id:'bad),or=(true'};const r=await run();assert.equal(r.statusCode,500);assert.equal(calls.length,1);activeAccount=undefined;
    });
    await t.test('authentication and same-origin protections remain enforced',async()=>{
      const anonymous=await run({headers:{cookie:''}});assert.equal(anonymous.statusCode,401);assert.equal(calls.length,0);
      const cross=await run({method:'POST',headers:{origin:'https://other.example'},body:{name:'Category'}});assert.equal(cross.statusCode,403);assert.equal(calls.filter(c=>c.name!=='dashboard_accounts').length,0);
      const method=await run({method:'DELETE'});assert.equal(method.statusCode,405);assert.equal(calls.filter(c=>c.name!=='dashboard_accounts').length,0);
    });
  } finally {globalThis.fetch=originalFetch;}
});
