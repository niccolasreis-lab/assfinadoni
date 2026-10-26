import assert from 'node:assert/strict';
import test from 'node:test';
import session from '../api/session.js';
test('falha de login registra apenas etapa e configuração, sem credenciais',async()=>{
 process.env.SUPABASE_URL='https://fixture.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='private-key-fixture';process.env.SESSION_SECRET='private-session-fixture-with-32-characters';
 const fetchBefore=globalThis.fetch,logBefore=console.error;const logs=[];
 globalThis.fetch=async()=>{throw Error('Do not log private-password-fixture or private-key-fixture');};console.error=(...args)=>logs.push(args);
 const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(body){this.body=body;}};
 try{
  await session({method:'POST',headers:{origin:'https://dashboard.example',host:'dashboard.example','content-type':'application/json'},body:{username:'fixture_user',password:'private-password-fixture'}},res);
  assert.equal(res.statusCode,500);assert.equal(logs[0][1].stage,'account_lookup');
  assert(!JSON.stringify(logs).includes('private-password-fixture'));assert(!JSON.stringify(logs).includes('private-key-fixture'));assert(!JSON.stringify(logs).includes('fixture_user'));
 }finally{globalThis.fetch=fetchBefore;console.error=logBefore;}
});
