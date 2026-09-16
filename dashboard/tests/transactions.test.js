import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/transactions.js';
import { setSession } from '../lib/server.js';

process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL = 'https://projeto-teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa-de-teste';
process.env.TELEGRAM_CHAT_ID = '123456789';

const ownerId = '11111111-1111-4111-8111-111111111111';
const transactionId = '22222222-2222-4222-8222-222222222222';
let cookie;
setSession({ setHeader(_name, value) { cookie = value.split(';')[0]; } });

function response() {
  return { statusCode: 200, body: null, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}

test('todas as operações REST permanecem vinculadas ao chat configurado', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method, body: options.body });
    const data = String(url).includes('finance_users') ? [{ id: ownerId, name: 'Ni' }]
      : options.method === 'GET' ? [{ id: transactionId, transaction_type: 'despesa', amount: 20, category: 'Transporte', description: 'Ônibus', transaction_date: '2026-09-15' }]
      : options.method === 'DELETE' ? [{ id: transactionId }]
      : [{ id: transactionId }];
    return { ok: true, status: 200, json: async () => data };
  };
  try {
    const base = { headers: { cookie, origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com', 'content-type': 'application/json' } };
    const get = response();
    await handler({ ...base, method: 'GET', query: { month: '2026-09' } }, get);
    assert.equal(get.statusCode, 200);
    assert.match(calls[0].url, /telegram_chat_id=eq\.123456789/);
    assert.match(calls[1].url, new RegExp(`user_id=eq\\.${ownerId}`));
    const values = { transaction_type: 'despesa', amount: 20, category: 'Transporte', description: 'Ônibus', transaction_date: '2026-09-15' };
    const post = response();
    await handler({ ...base, method: 'POST', body: values }, post);
    assert.equal(post.statusCode, 201);
    assert.equal(JSON.parse(calls.at(-1).body).user_id, ownerId);
    assert.ok(JSON.parse(calls.at(-1).body).telegram_message_id < 0);
    const patch = response();
    await handler({ ...base, method: 'PATCH', body: { ...values, id: transactionId } }, patch);
    assert.equal(patch.statusCode, 200);
    assert.match(calls.at(-1).url, new RegExp(`id=eq\\.${transactionId}.*user_id=eq\\.${ownerId}`));
    const remove = response();
    await handler({ ...base, method: 'DELETE', body: { id: transactionId } }, remove);
    assert.equal(remove.statusCode, 200);
    assert.match(calls.at(-1).url, new RegExp(`id=eq\\.${transactionId}.*user_id=eq\\.${ownerId}`));
  } finally { globalThis.fetch = originalFetch; }
});
