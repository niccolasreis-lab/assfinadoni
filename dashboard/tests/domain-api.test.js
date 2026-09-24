import assert from 'node:assert/strict';
import test from 'node:test';
import accounts from '../api/accounts.js';
import cards from '../api/cards.js';
import splits from '../api/splits.js';
import installments from '../api/installments.js';
import { setSession } from '../lib/server.js';

process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL = 'https://projeto-teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa-de-teste';
const account = { id: '11111111-1111-4111-8111-111111111111', username: 'nicolasreis', session_version: 1, active: true, finance_user_id: '22222222-2222-4222-8222-222222222222', finance_users: { name: 'Nicolas' } };
let cookie; setSession({ setHeader(_name, value) { cookie = value.split(';')[0]; } }, account);
const headers = { cookie, origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com', 'content-type': 'application/json' };
function response() { return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } }; }

test('endpoints do domínio usam a carteira autenticada e RPCs tipadas', async () => {
  const old = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url); const body = options?.body ? JSON.parse(options.body) : null; calls.push({ parsed, body });
    if (parsed.pathname.endsWith('/dashboard_accounts')) return { ok: true, status: 200, json: async () => [account] };
    if (parsed.pathname.endsWith('/rpc/finance_account_list')) return { ok: true, status: 200, json: async () => [] };
    if (parsed.pathname.endsWith('/rpc/finance_card_list')) return { ok: true, status: 200, json: async () => [] };
    if (parsed.pathname.endsWith('/rpc/finance_installment_list')) return { ok: true, status: 200, json: async () => [] };
    return { ok: true, status: 200, json: async () => ({ id: 'created' }) };
  };
  try {
    const a = response(); await accounts({ method: 'POST', headers, body: { name: 'Carteira', type: 'cash' } }, a); assert.equal(a.statusCode, 201);
    const c = response(); await cards({ method: 'GET', headers, query: {} }, c); assert.equal(c.statusCode, 200);
    const s = response(); await splits({ method: 'PATCH', headers, body: { transaction_id: '33333333-3333-4333-8333-333333333333', splits: [{ account_id: '44444444-4444-4444-8444-444444444444', amount: 20 }] } }, s); assert.equal(s.statusCode, 200);
    const i = response(); await installments({ method: 'GET', headers, query: { plan_id: '55555555-5555-4555-8555-555555555555' } }, i); assert.equal(i.statusCode, 200);
    assert.equal(calls.find((call) => call.parsed.pathname.endsWith('/rpc/finance_account_create')).body.p_user_id, account.finance_user_id);
    assert.equal(calls.find((call) => call.parsed.pathname.endsWith('/rpc/finance_transaction_splits_replace')).body.p_account_id, account.id);
  } finally { globalThis.fetch = old; }
});
