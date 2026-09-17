import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/transactions.js';
import { setSession } from '../lib/server.js';

process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL = 'https://projeto-teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa-de-teste';
process.env.TELEGRAM_CHAT_ID = '123456789';

const userId = '11111111-1111-4111-8111-111111111111';
const transactionId = '22222222-2222-4222-8222-222222222222';
let cookie;
setSession({ setHeader(_name, value) { cookie = value.split(';')[0]; } });
const headers = { cookie, origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com', 'content-type': 'application/json' };

function response() {
  return { statusCode: 200, body: null, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
}

function mockFetch(resolve) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const call = { url: new URL(url), method: options.method, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    return { ok: true, status: 200, json: async () => resolve(call) };
  };
  return { calls, restore() { globalThis.fetch = original; } };
}

test('filtros cruzam meses, pagina 50 linhas e deixam o resumo no mês selecionado', async () => {
  const row = { id: transactionId, transaction_type: 'despesa', amount: 10, category: 'Alimentação' };
  const mock = mockFetch(({ url }) => url.pathname.endsWith('/finance_users') ? [{ id: userId, name: 'Ni' }]
    : url.searchParams.get('select') === 'transaction_type,amount,category' ? [row]
      : Array.from({ length: 51 }, () => row));
  try {
    const res = response();
    await handler({ method: 'GET', headers, query: { month: '2026-09', q: 'Mercado', category: 'Alimentação', type: 'despesa', date_from: '2026-08-01', date_to: '2026-10-31', page: '2' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.transactions.length, 50);
    assert.deepEqual(res.body.pagination, { page: 2, pageSize: 50, hasMore: true });
    assert.deepEqual(res.body.summary, { income: 0, expense: 10, balance: -10, byCategory: { Alimentação: 10 } });
    const list = mock.calls[1].url.searchParams;
    assert.equal(list.get('user_id'), `eq.${userId}`);
    assert.equal(list.get('deleted_at'), 'is.null');
    assert.equal(list.get('description'), 'ilike.%Mercado%');
    assert.equal(list.get('category'), 'eq.Alimentação');
    assert.equal(list.get('transaction_type'), 'eq.despesa');
    assert.deepEqual(list.getAll('transaction_date'), ['gte.2026-08-01', 'lte.2026-10-31']);
    assert.equal(list.get('offset'), '50');
    const summary = mock.calls[2].url.searchParams;
    assert.deepEqual(summary.getAll('transaction_date'), ['gte.2026-09-01', 'lt.2026-10-01']);
  } finally { mock.restore(); }
});

test('lixeira mostra apenas excluídos restauráveis e mantém resumo ativo', async () => {
  const mock = mockFetch(({ url }) => url.pathname.endsWith('/finance_users') ? [{ id: userId, name: 'Ni' }]
    : url.searchParams.get('select') === 'transaction_type,amount,category' ? []
      : [{ id: transactionId, deleted_at: new Date().toISOString() }]);
  try {
    const res = response();
    await handler({ method: 'GET', headers, query: { month: '2026-09', view: 'trash' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.transactions.length, 1);
    assert.equal(res.body.pagination.hasMore, false);
    assert.equal(res.body.summary.balance, 0);
    const list = mock.calls[1].url.searchParams;
    assert.match(list.get('deleted_at'), /^gte\.\d{4}-\d{2}-\d{2}T/);
    assert.equal(list.get('order'), 'deleted_at.desc,id.desc');
    assert.equal(list.getAll('transaction_date').length, 0);
  } finally { mock.restore(); }
});

test('restauração exige chat, prazo e uma linha marcada', async () => {
  const mock = mockFetch(({ url }) => url.pathname.endsWith('/finance_users') ? [{ id: userId, name: 'Ni' }] : [{ id: transactionId, deleted_at: null }]);
  try {
    const res = response();
    await handler({ method: 'PATCH', headers, body: { id: transactionId, action: 'restore' } }, res);
    assert.equal(res.statusCode, 200);
    const call = mock.calls[1];
    assert.equal(call.method, 'PATCH');
    assert.equal(call.body.deleted_at, null);
    assert.equal(call.url.searchParams.get('user_id'), `eq.${userId}`);
    assert.match(call.url.searchParams.get('deleted_at'), /^gte\.\d{4}-\d{2}-\d{2}T/);
  } finally { mock.restore(); }
});

test('restauração vencida não retorna confirmação de sucesso', async () => {
  const mock = mockFetch(({ url }) => url.pathname.endsWith('/finance_users') ? [{ id: userId, name: 'Ni' }] : []);
  try {
    const res = response();
    await handler({ method: 'PATCH', headers, body: { id: transactionId, action: 'restore' } }, res);
    assert.equal(res.statusCode, 404);
    assert.match(res.body.error, /prazo de restauração/);
    assert.equal(mock.calls[1].body.deleted_at, null);
  } finally { mock.restore(); }
});

test('filtros inválidos não consultam lançamentos', async () => {
  const mock = mockFetch(({ url }) => url.pathname.endsWith('/finance_users') ? [{ id: userId, name: 'Ni' }] : []);
  try {
    for (const query of [
      { month: '2026-09', date_from: '2026-10-01', date_to: '2026-09-30' },
      { month: '2026-09', category: 'Qualquer' },
      { month: '2026-09', page: '0' },
      { month: '2026-09', type: 'transferência' },
    ]) {
      const res = response();
      await handler({ method: 'GET', headers, query }, res);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(mock.calls.length, 4);
    assert.ok(mock.calls.every(({ url }) => url.pathname.endsWith('/finance_users')));
  } finally { mock.restore(); }
});
