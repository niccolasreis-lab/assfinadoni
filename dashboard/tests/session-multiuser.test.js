import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/session.js';
import { hashPassword } from '../lib/server.js';

process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL = 'https://projeto-teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa-de-teste';

const accountId = '11111111-1111-4111-8111-111111111111';
const financeUserId = '22222222-2222-4222-8222-222222222222';

function response() {
  return { statusCode: 200, body: null, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}

function request(body) {
  return { method: 'POST', body, headers: { origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com',
    'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' } };
}

test('login exige username e senha, normaliza o username e retorna identidade pública', async () => {
  const passwordHash = await hashPassword('senha-ficticia-testes');
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const call = { url: new URL(url), body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    const data = call.url.pathname.endsWith('/dashboard_accounts')
      ? [{ id: accountId, username: 'nicolasreis', display_name: 'Nicolas', password_hash: passwordHash,
        finance_user_id: financeUserId, session_version: 1, active: true, locked_until: null, finance_users: { name: 'Nicolas Reis' } }]
      : null;
    return { ok: true, status: 200, json: async () => data };
  };
  try {
    const res = response();
    await handler(request({ username: '  NicolasReis ', password: 'senha-ficticia-testes' }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { authenticated: true, account: { id: accountId, username: 'nicolasreis', name: 'Nicolas Reis', telegram_linked: false } });
    assert.match(String(res.headers['Set-Cookie']), /HttpOnly; Secure; SameSite=Strict/);
    assert.equal(calls[0].url.searchParams.get('username'), 'eq.nicolasreis');
    assert.equal(calls[1].url.pathname.endsWith('/rpc/finance_dashboard_clear_login_failures'), true);
  } finally { globalThis.fetch = originalFetch; }
});

test('credenciais desconhecidas, senha errada e conta bloqueada usam o mesmo erro', async () => {
  const passwordHash = await hashPassword('senha-ficticia-testes');
  for (const scenario of [
    { rows: [], body: { username: 'desconhecido', password: 'senha-ficticia-testes' } },
    { rows: [{ id: accountId, username: 'nicolasreis', password_hash: passwordHash, finance_user_id: financeUserId, session_version: 1, active: true }], body: { username: 'nicolasreis', password: 'errada' } },
    { rows: [{ id: accountId, username: 'nicolasreis', password_hash: passwordHash, finance_user_id: financeUserId, session_version: 1, active: true, locked_until: '2999-01-01T00:00:00Z' }], body: { username: 'nicolasreis', password: 'senha-ficticia-testes' } },
    { rows: [{ id: accountId, username: 'nicolasreis', password_hash: passwordHash, finance_user_id: financeUserId, session_version: 1, active: false }], body: { username: 'nicolasreis', password: 'senha-ficticia-testes' } },
  ]) {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const call = { url: new URL(url), body: options.body ? JSON.parse(options.body) : null };
      calls.push(call);
      return { ok: true, status: 200, json: async () => call.url.pathname.endsWith('/dashboard_accounts') ? scenario.rows : null };
    };
    try {
      const res = response();
      await handler(request(scenario.body), res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error, 'Usuário ou senha inválidos.');
      assert.equal(calls.at(-1).url.pathname.endsWith('/rpc/finance_dashboard_record_login_failure'), true);
      assert.equal(res.headers['Set-Cookie'], undefined);
    } finally { globalThis.fetch = originalFetch; }
  }
});

test('login recusa origem cruzada antes de consultar credenciais', async () => {
  const originalFetch = globalThis.fetch;
  let consulted = false;
  globalThis.fetch = async () => { consulted = true; throw new Error('não deveria consultar'); };
  try {
    const res = response();
    await handler({ ...request({ username: 'nicolasreis', password: 'senha-ficticia-testes' }), headers: { ...request({}).headers, origin: 'https://malicioso.exemplo.com' } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(consulted, false);
  } finally { globalThis.fetch = originalFetch; }
});
