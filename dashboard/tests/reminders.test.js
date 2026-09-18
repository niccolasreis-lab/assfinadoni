import assert from 'node:assert/strict';
import test from 'node:test';
import { createECDH } from 'node:crypto';
import reminders from '../api/reminders.js';
import push from '../api/push.js';
import dispatch from '../api/notification-dispatch.js';
import { setSession } from '../lib/server.js';
import { validateReminderCreate, validateReminderAction } from '../lib/reminders.js';
import { validatePushEndpoint, validatePushSubscription } from '../lib/notifications.js';

process.env.SESSION_SECRET='test-secret-for-reminders-with-at-least-thirty-two-characters';
process.env.SUPABASE_URL='https://test-reminders.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-key';
const account={id:'11111111-1111-4111-8111-111111111111',finance_user_id:'22222222-2222-4222-8222-222222222222',username:'testuser',session_version:1,active:true,finance_users:{name:'Test'}};
const rid='33333333-3333-4333-8333-333333333333';
const lease='44444444-4444-4444-8444-444444444444';
const secret='fictitious-dispatch-secret-with-32-characters';
let cookie;setSession({setHeader(_name,value){cookie=value.split(';')[0];}},account);
const headers={cookie,host:'dashboard.example.com',origin:'https://dashboard.example.com','content-type':'application/json'};
const endpoint='https://fcm.googleapis.com/fcm/send/test';
const subscription={endpoint,keys:{p256dh:createECDH('prime256v1').generateKeys().toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
function response(){return{statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;}};}
async function mocked(run,resolve=()=>({})){
 const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{const call={url:new URL(url),method:options.method,body:options.body?JSON.parse(options.body):null};calls.push(call);
  const data=call.url.pathname.endsWith('/dashboard_accounts')?[account]:call.url.pathname.endsWith('/finance_notification_config')?[{private_key:'private-test-only',public_key:'public-test-only',dispatch_secret:secret,vapid_subject:'https://dashboard.example.com'}]:await resolve(call);
  return{ok:true,status:200,json:async()=>data};};
 try{await run(calls);}finally{globalThis.fetch=old;}
}

test('lembretes validam tipo, datas, dinheiro, offsets e identificadores externos',()=>{
 assert.equal(validateReminderCreate({kind:'bill',description:'  Conta  ',due_date:'2030-01-01'}).description,'Conta');
 assert.deepEqual(validateReminderCreate({kind:'review',description:'Revisar',reminder_offsets:[]}).reminder_offsets,[]);
 for(const payload of [{kind:'bill',description:'Conta'},{kind:'bill',description:'Conta',due_date:'2030-02-30'},{kind:'review',description:'Revisar',amount:1.001},{kind:'review',description:'Revisar',amount:-1},{kind:'review',description:'Revisar',reminder_offsets:[0,0]},{kind:'review',description:'Revisar',reminder_offsets:[7]},{kind:'review',description:'Revisar',reminder_hour:24},{kind:'review',description:'Revisar',finance_user_id:rid},{kind:'review',description:'Revisar',source:'telegram'}])assert.throws(()=>validateReminderCreate(payload));
 assert.throws(()=>validateReminderAction({id:rid,action:'complete',transaction_date:'2999-01-01'}));
 assert.throws(()=>validateReminderAction({id:rid,action:'update',account_id:rid}));
 assert.throws(()=>validateReminderAction({id:rid,action:'cancel',amount:10}));
});

test('reminders usa carteira da sessão, filtra retorno e encaminha conclusão para RPC atômica',async()=>{
 await mocked(async calls=>{
  const res=response();await reminders({method:'GET',headers,query:{}},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.reminders[0].finance_user_id,undefined);assert.equal(res.body.telegram_linked,false);
  assert.equal(calls.at(-1).url.searchParams.get('finance_user_id'),`eq.${account.finance_user_id}`);
  const create=response();await reminders({method:'POST',headers,body:{kind:'review',description:'Revisar',external_key:'test-idempotency'}},create);
  assert.equal(create.statusCode,201);assert.equal(calls.at(-1).body.p_user_id,account.finance_user_id);assert.equal(calls.at(-1).body.p_values.source,'web');
  const complete=response();await reminders({method:'PATCH',headers,body:{id:rid,action:'complete',amount:10,category:'Outros',transaction_date:'2020-01-01'}},complete);
  assert.equal(complete.statusCode,200);assert.match(calls.at(-1).url.pathname,/finance_reminder_action$/);assert.equal(calls.at(-1).body.p_account_id,account.id);assert.equal(calls.at(-1).body.p_user_id,account.finance_user_id);
 },call=>call.url.pathname.endsWith('/finance_reminders')?[{id:rid,description:'Test',finance_user_id:account.finance_user_id}]:{id:rid,status:'pending'});
});

test('reminders recusa sem sessão, crossorigin, IDs extrínsecos e não encontrado sem mutação extra',async()=>{
 await mocked(async calls=>{
  for(const [request,code] of [[{method:'GET',headers:{}},401],[{method:'POST',headers:{...headers,origin:'https://other.example.com'},body:{}},403],[{method:'GET',headers,query:{account_id:rid}},400],[{method:'POST',headers,body:{kind:'review',description:'Test',finance_user_id:rid}},400]]){const res=response();await reminders(request,res);assert.equal(res.statusCode,code);}
  assert.ok(calls.every(call=>call.method==='GET'));
  const res=response();await reminders({method:'PATCH',headers,body:{id:rid,action:'cancel'}},res);assert.equal(res.statusCode,404);
 },()=>null);
});

test('lista todas as pendências com cursor e exclui encerradas antes de paginar',async()=>{
 const first=Array.from({length:500},(_,index)=>({id:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,status:'pending',description:'Fixture',created_at:'2020-01-01'}));
 await mocked(async calls=>{
  const res=response();await reminders({method:'GET',headers},res);
  assert.equal(res.statusCode,200);assert.equal(res.body.reminders.length,501);
  const reads=calls.filter(call=>call.url.pathname.endsWith('/finance_reminders'));
  assert.equal(reads.length,2);
  assert.ok(reads.every(call=>call.url.searchParams.get('status')==='eq.pending' && call.url.searchParams.get('finance_user_id')===`eq.${account.finance_user_id}`));
  assert.equal(reads[1].url.searchParams.get('id'),`gt.${first.at(-1).id}`);
 },call=>call.url.searchParams.has('id')?[{id:rid,status:'pending',description:'Old pending',created_at:'2019-01-01'}]:first);
});

test('push recusa endpoints SSRF e chaves malformadas antes do envio',()=>{
 assert.equal(validatePushEndpoint(endpoint),endpoint);assert.deepEqual(validatePushSubscription(subscription),subscription);
 for(const value of ['http://fcm.googleapis.com/send','https://127.0.0.1/send','https://localhost/send','https://fcm.googleapis.com.evil.test/send','https://fcm.googleapis.com:8443/send','https://user:pass@fcm.googleapis.com/send','https://169.254.169.254/latest','https://example.com/send','https://web.push.apple.com.evil.test/send'])assert.throws(()=>validatePushEndpoint(value));
 for(const keys of [{auth:'bad',p256dh:subscription.keys.p256dh},{auth:subscription.keys.auth,p256dh:Buffer.alloc(65).toString('base64url')},{auth:subscription.keys.auth,p256dh:'not-base64!'}])assert.throws(()=>validatePushSubscription({endpoint,keys}));
});

test('push não expõe segredos e mantém propriedade de endpoint no RPC',async()=>{
 await mocked(async calls=>{
  const config=response();await push({method:'GET',headers},config);assert.deepEqual(config.body,{publicKey:'public-test-only',supported:true});
  const add=response();await push({method:'POST',headers,body:{subscription}},add);assert.equal(add.statusCode,200);assert.equal(calls.at(-1).body.p_account_id,account.id);
  const remove=response();await push({method:'DELETE',headers,body:{endpoint}},remove);assert.equal(remove.statusCode,200);assert.equal(calls.at(-1).body.p_account_id,account.id);
 },()=>true);
 await mocked(async()=>{const res=response();await push({method:'POST',headers,body:{subscription}},res);assert.equal(res.statusCode,409);},()=>false);
});

test('dispatcher autentica antes de agir e expõe mensagens discretas com lease',async()=>{
 await mocked(async calls=>{
  const absent=response();await dispatch({method:'POST',headers:{'content-type':'application/json'},body:{}},absent);assert.equal(absent.statusCode,401);assert.equal(calls.length,0);
  const wrong=response();await dispatch({method:'POST',headers:{'content-type':'application/json','x-notification-secret':'incorrect-secret-with-at-least-thirty-two-characters'},body:{}},wrong);assert.equal(wrong.statusCode,401);assert.equal(calls.length,1);
  const res=response();await dispatch({method:'POST',headers:{'content-type':'application/json','x-notification-secret':secret},body:{}},res);assert.equal(res.statusCode,200);assert.equal(res.body.deliveries.length,1);assert.equal(res.body.deliveries[0].lease_token,lease);
  assert.doesNotMatch(JSON.stringify(res.body),/private-test|sensitive description|9876/);
  const ack=response();await dispatch({method:'PATCH',headers:{'content-type':'application/json','x-notification-secret':secret},body:{id:rid,lease_token:lease,success:true}},ack);assert.equal(ack.body.acknowledged,true);
  assert.equal(calls.at(-1).body.p_lease_token,lease);
 },call=>call.url.pathname.endsWith('/finance_notification_claim')?[{id:rid,lease_token:lease,channel:'telegram'}]:call.url.pathname.endsWith('/finance_notification_check')?{id:rid,lease_token:lease,channel:'telegram',chat_id:'test-chat',kind:'review',short_code:'abcd1234',description:'sensitive description',amount:9876}:true);
});
