import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../handlers/assistant.js';
import { setSession } from '../lib/server.js';
process.env.SESSION_SECRET='segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-not-a-secret';
const id='33333333-3333-4333-8333-333333333333';
const account={id:'11111111-1111-4111-8111-111111111111',username:'fixture',active:true,session_version:1,finance_user_id:'22222222-2222-4222-8222-222222222222',finance_users:{name:'Fixture'}};
let cookie;setSession({setHeader(_key,value){cookie=value.split(';')[0];}},account);
const headers={cookie,origin:'https://app.test',host:'app.test'};
const response=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}});
test('cancel endpoint requires a session and same origin',async()=>{
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url)=>{calls.push(url);assert(new URL(url).pathname.endsWith('/dashboard_accounts'));return {ok:true,json:async()=>[account]};};
 try {
  const unauth=response();await handler({method:'DELETE',headers:{},query:{id}},unauth);assert.equal(unauth.code,401);assert.equal(calls.length,0);
  const cross=response();await handler({method:'DELETE',headers:{...headers,origin:'https://other.test'},query:{id}},cross);assert.equal(cross.code,403);assert.equal(calls.length,1);
 }finally{globalThis.fetch=old;}
});
test('cancel endpoint scopes both reads and writes to authenticated identity',async()=>{
 const old=globalThis.fetch;const calls=[];
 const job={id,status:'queued',attempts:0,created_at:'2026-01-01T00:00:00Z',lease_token:null,lease_until:null};
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);if(u.pathname.endsWith('/dashboard_accounts'))return {ok:true,json:async()=>[account]};
  assert(u.pathname.endsWith('/finance_assistant_jobs'));assert.equal(u.searchParams.get('user_id'),'eq.'+account.finance_user_id);calls.push({u,options});
  return {ok:true,json:async()=>options.method==='PATCH'?[{...job,...JSON.parse(options.body)}]:[job]};
 };
 try{const res=response();await handler({method:'DELETE',headers,query:{id,user_id:'attacker'}},res);assert.equal(res.code,200);assert.equal(res.body.result.cancelled,true);assert.equal(res.body.result.changed,false);assert.equal(res.body.lease_token,undefined);assert.equal(calls.length,2);}finally{globalThis.fetch=old;}
});
