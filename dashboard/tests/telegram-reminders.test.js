import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { parseTelegramCommand } from '../api/telegram-reminders.js';
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
process.env.SESSION_SECRET = 'test-secret-long-enough-for-session-value';
const secret = 'notification-secret-test-32-characters';
function res() { return { setHeader() {}, status(n) { this.statusCode=n; return this; }, json(b) { this.body=b; } }; }
test('comandos Telegram aceitam datas reais, moeda brasileira e códigos sem aceitar filtros arbitrários', () => {
  assert.deepEqual(parseTelegramCommand('/lembrete@bot 30/09/2026 Luz | 1.250,50 | moradia').values,{kind:'bill',due_date:'2026-09-30',description:'Luz',amount:1250.50,category:'Moradia'});
  assert.throws(()=>parseTelegramCommand('/lembrete 31/02/2026 Luz'));
  assert.throws(()=>parseTelegramCommand('/pagar 1234 or true'));
  assert.throws(()=>parseTelegramCommand('/validar aabb1122 -5 | Moradia'));
  assert.equal(parseTelegramCommand('gastei 50 no almoço'),null);
});
test('endpoint autentica integração e resolve proprietário pelo chat, ignorando user_id externo', async () => {
  const old=globalThis.fetch, calls=[];
  globalThis.fetch=async(url,init)=> {
    const u=new URL(url), body=init.body?JSON.parse(init.body):null;calls.push({u,body});
    let value=[];
    if(u.pathname.endsWith('/finance_notification_config')) value=[{dispatch_secret:secret}];
    if(u.pathname.endsWith('/finance_users')) value=[{id:'owner-from-chat'}];
    if(u.pathname.endsWith('/finance_reminder_create')) value={short_code:'abcd1234'};
    return {ok:true,status:200,json:async()=>value};
  };
  try {
    const denied=res();await handler({method:'POST',headers:{},body:{}},denied);assert.equal(denied.statusCode,401);assert.equal(calls.length,0);
    const response=res();await handler({method:'POST',headers:{'x-notification-secret':secret,'content-type':'application/json'},body:{chat_id:'123',update_id:'456',user_id:'attacker',text:'/lembrete 30/09/2026 Luz | 100 | Moradia'}},response);
    assert.equal(response.body.handled,true);assert.match(response.body.text,/abcd1234/);
    assert.equal(calls.at(-1).body.p_user_id,'owner-from-chat');assert.equal(calls.at(-1).body.p_values.external_key,'telegram:123:456');
    assert.equal(calls.find(c=>c.u.pathname.endsWith('/finance_users')).u.searchParams.get('telegram_chat_id'),'eq.123');
    const group=res();await handler({method:'POST',headers:{'x-notification-secret':secret,'content-type':'application/json'},body:{chat_id:'-123',update_id:'456'}},group);assert.equal(group.statusCode,400);
  } finally { globalThis.fetch=old; }
});
test('pendências preservam informação válida e ações são restritas à conta do chat', async () => {
  const old=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{
    const u=new URL(url), body=init.body?JSON.parse(init.body):null;calls.push({u,body});
    let value=[];
    if(u.pathname.endsWith('/finance_notification_config'))value=[{dispatch_secret:secret}];
    if(u.pathname.endsWith('/finance_users'))value=[{id:'safe-owner'}];
    if(u.pathname.endsWith('/finance_reminder_create'))value={short_code:'aabb1234'};
    return {ok:true,status:200,json:async()=>value};
  };
  const headers={'x-notification-secret':secret,'content-type':'application/json'};
  try{
    const saved=res();await handler({method:'POST',headers,body:{chat_id:'123',update_id:'456',action:'review',description:'Compra sem categoria',amount:0,category:'???',transaction_date:'invalid'}},saved);
    assert.match(saved.body.text,/pendência/);assert.equal(calls.at(-1).body.p_values.amount,null);assert.equal(calls.at(-1).body.p_values.category,null);
    const foreign=res();await handler({method:'POST',headers,body:{chat_id:'123',update_id:'457',text:'/cancelar aabb1234'}},foreign);
    assert.match(foreign.body.text,/não encontrado/);assert.equal(calls.at(-1).u.searchParams.get('finance_user_id'),'eq.safe-owner');assert.ok(!calls.some(c=>c.u.pathname.endsWith('/finance_reminder_action')));
  }finally{globalThis.fetch=old;}
});
