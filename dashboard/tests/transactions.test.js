import assert from 'node:assert/strict';
import test from 'node:test';
import transactions from '../api/transactions.js';
import shares from '../api/shares.js';
import { setSession } from '../lib/server.js';
process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL = 'https://projeto-teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa-de-teste';
delete process.env.TELEGRAM_CHAT_ID;
const aid = '11111111-1111-4111-8111-111111111111';
const tid = '22222222-2222-4222-8222-222222222222';
const account = { id: aid, username: 'nicolasreis', session_version: 1, active: true, finance_user_id: '33333333-3333-4333-8333-333333333333', finance_users: { name: 'Nicolas' } };
let cookie; setSession({ setHeader(_name, value) { cookie = value.split(';')[0]; } }, account);
const headers = { cookie, origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com', 'content-type': 'application/json' };
const values = { transaction_type: 'despesa', amount: 20, category: 'Transporte', description: 'Ônibus', transaction_date: '2026-09-15' };
function response() { return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } }; }
async function mocked(resolve, run) {
  const previous = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => { const call = { url: new URL(url), body: options.body ? JSON.parse(options.body) : null }; calls.push(call); return { ok: true, status: 200, json: async () => call.url.pathname.endsWith('/dashboard_accounts') ? [account] : resolve(call) }; };
  try { await run(calls); } finally { globalThis.fetch = previous; }
}
test('scopes, filtros e paginação usam a sessão; resumo permanece mensal', async () => {
  await mocked((call) => call.url.pathname.endsWith('list_transactions') ? { transactions: [{ id: tid }], has_more: true } : { income: 100, expense: 20, balance: 80, byCategory: { Transporte: 20 } }, async (calls) => {
    for (const scope of ['mine', 'shared', 'all']) {
      const res = response(); await transactions({ method: 'GET', headers, query: { month: '2026-09', scope, q: 'Ônibus', category: 'Transporte', type: 'despesa', date_from: '2026-08-01', date_to: '2026-10-31', page: '2', account_id: tid } }, res);
      assert.equal(res.statusCode, 200); assert.equal(res.body.summary.expense, 20);
      const list = calls.at(-2).body; assert.equal(list.p_account_id, aid); assert.equal(list.p_scope, scope); assert.equal(list.p_date_from, '2026-08-01'); assert.equal(list.p_date_to, '2026-10-31'); assert.equal(list.p_search, 'Ônibus'); assert.equal(list.p_page, 2); assert.equal(list.p_page_size, 50);
      const summary = calls.at(-1).body; assert.equal(summary.p_include_shared, false); assert.equal(summary.p_month_start, '2026-09-01'); assert.equal(summary.p_month_end, '2026-10-01');
      assert.deepEqual(res.body.pagination, { page: 2, pageSize: 50, hasMore: true });
    }
    const res = response(); await transactions({ method: 'GET', headers, query: { month: '2026-09', include_shared_summary: 'true', view: 'trash', scope: 'all' } }, res);
    assert.equal(calls.at(-1).body.p_include_shared, true); assert.equal(calls.at(-2).body.p_view, 'trash'); assert.equal(calls.at(-2).body.p_date_from, null);
  });
});
test('criação, edição, lixeira e restauração usam RPCs autorizadas pela sessão', async () => {
  await mocked(() => ({ id: tid }), async (calls) => {
    for (const [method, body, rpc, status] of [['POST', values, 'create', 201], ['PATCH', { ...values, id: tid, user_id: tid }, 'update', 200], ['DELETE', { id: tid }, 'delete', 200], ['PATCH', { id: tid, action: 'restore' }, 'restore', 200]]) {
      const res = response(); await transactions({ method, headers, body }, res); assert.equal(res.statusCode, status); assert.equal(calls.at(-1).body.p_account_id, aid); assert.match(calls.at(-1).url.pathname, new RegExp(`finance_dashboard_${rpc}_transaction$`)); assert.equal(calls.at(-1).body.user_id, undefined);
    }
  });
});
test('IDOR e restauração vencida retornam 404 sem confirmação falsa', async () => {
  await mocked(() => null, async () => {
    for (const [method, body] of [['PATCH', { ...values, id: tid }], ['DELETE', { id: tid }], ['PATCH', { id: tid, action: 'restore' }]]) { const res = response(); await transactions({ method, headers, body }, res); assert.equal(res.statusCode, 404); assert.equal(res.body.transaction, undefined); }
    for (const method of ['POST', 'DELETE']) { const res = response(); await shares({ method, headers, body: { transaction_id: tid } }, res); assert.equal(res.statusCode, 404); }
  });
});
test('compartilhar e revogar usam conta autenticada e ID do lançamento', async () => {
  await mocked(() => ({ id: tid }), async (calls) => {
    for (const method of ['POST', 'DELETE']) { const res = response(); await shares({ method, headers, body: { transaction_id: tid, account_id: tid } }, res); assert.equal(res.statusCode, method === 'POST' ? 201 : 200); assert.equal(calls.at(-1).body.p_account_id, aid); assert.equal(calls.at(-1).body.p_transaction_id, tid); }
  });
});
test('filtros inválidos não consultam RPCs e sessão ausente é recusada', async () => {
  await mocked(() => null, async (calls) => {
    for (const query of [{ scope: 'other' }, { page: '0' }, { category: 'Qualquer' }, { include_shared_summary: '1' }, { date_from: '2026-10-01', date_to: '2026-09-01' }]) { const res = response(); await transactions({ method: 'GET', headers, query }, res); assert.equal(res.statusCode, 400); }
    assert.ok(calls.every((call) => call.url.pathname.endsWith('/dashboard_accounts')));
    const res = response(); await transactions({ method: 'GET', headers: {}, query: {} }, res); assert.equal(res.statusCode, 401);
  });
});
