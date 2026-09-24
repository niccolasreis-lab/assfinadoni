import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/duplicates.js';
import { setSession } from '../lib/server.js';

process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL = 'https://projeto-teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa-de-teste';

const account = {
  id: '11111111-1111-4111-8111-111111111111',
  username: 'nicolasreis',
  session_version: 1,
  active: true,
  finance_user_id: '22222222-2222-4222-8222-222222222222',
  finance_users: { name: 'Nicolas' },
};
let cookie;
setSession({ setHeader(_name, value) { cookie = value.split(';')[0]; } }, account);
const headers = { cookie, origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com', 'content-type': 'application/json' };
function response() { return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } }; }

test('lista duplicidades com escopo da sessão e resolve por RPC autorizada', async () => {
  const old = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    calls.push({ parsed, body: options?.body ? JSON.parse(options.body) : null });
    if (parsed.pathname.endsWith('/dashboard_accounts')) return { ok: true, status: 200, json: async () => [account] };
    if (parsed.pathname.endsWith('/rpc/finance_duplicate_candidates')) return { ok: true, status: 200, json: async () => [{ id: 'd1' }] };
    return { ok: true, status: 200, json: async () => ({ id: 'd1', status: 'ignored' }) };
  };
  try {
    const list = response();
    await handler({ method: 'GET', headers, query: { status: 'open', limit: '20' } }, list);
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.body.duplicates, [{ id: 'd1' }]);
    assert.equal(calls.at(-1).body.p_user_id, account.finance_user_id);
    const patch = response();
    await handler({ method: 'PATCH', headers, body: { id: '33333333-3333-4333-8333-333333333333', action: 'ignore' } }, patch);
    assert.equal(patch.statusCode, 200);
    assert.equal(calls.at(-1).body.p_account_id, account.id);
  } finally { globalThis.fetch = old; }
});

test('recusa status, ação, origem e ID inválidos antes de consultar RPC', async () => {
  const old = globalThis.fetch;
  let rpcCount = 0;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/dashboard_accounts')) return { ok: true, status: 200, json: async () => [account] };
    rpcCount += 1;
    return { ok: true, status: 200, json: async () => [] };
  };
  try {
    for (const query of [{ status: 'bad' }, { limit: '0' }]) {
      const res = response(); await handler({ method: 'GET', headers, query }, res); assert.equal(res.statusCode, 400);
    }
    const origin = response(); await handler({ method: 'PATCH', headers: { ...headers, origin: 'https://malicioso.exemplo.com' }, body: { id: '33333333-3333-4333-8333-333333333333', action: 'ignore' } }, origin); assert.equal(origin.statusCode, 403);
    const invalid = response(); await handler({ method: 'PATCH', headers, body: { id: 'bad', action: 'ignore' } }, invalid); assert.equal(invalid.statusCode, 400);
    assert.equal(rpcCount, 0);
  } finally { globalThis.fetch = old; }
});
