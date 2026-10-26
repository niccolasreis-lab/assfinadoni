import assert from 'node:assert/strict';
import test from 'node:test';
import session from '../api/session.js';
import { authenticated,hashPassword } from '../lib/server.js';
test('login e sessão usam a FK pessoal explícita quando há carteiras do casal',async()=>{
 process.env.SESSION_SECRET='session-fixture-with-more-than-32-characters';process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-key';
 const account={id:'11111111-1111-4111-8111-111111111111',username:'fixture_user',active:true,session_version:1,password_hash:await hashPassword('fixture-password'),finance_users:{name:'Pessoa fixture',telegram_chat_id:1}};
 const before=globalThis.fetch,lookups=[];globalThis.fetch=async(url)=>{
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/dashboard_accounts')){lookups.push(parsed.searchParams.get('select'));return {ok:true,status:200,json:async()=>[account]};}
  return {ok:true,status:200,json:async()=>null};
 };
 const headers={};const res={statusCode:200,setHeader(k,v){headers[k]=v;},status(c){this.statusCode=c;return this;},json(v){this.body=v;}};
 try{
  await session({method:'POST',headers:{host:'dashboard.example',origin:'https://dashboard.example','content-type':'application/json'},body:{username:'fixture_user',password:'fixture-password'}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.authenticated,true);
  assert(await authenticated({headers:{cookie:headers['Set-Cookie'].split(';')[0]}}));
  assert.equal(lookups.length,2);
  for(const select of lookups)assert(select.includes('finance_users!dashboard_accounts_finance_user_id_fkey(name,telegram_chat_id)'));
 }finally{globalThis.fetch=before;}
});
