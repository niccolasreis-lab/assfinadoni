import assert from 'node:assert/strict';
import test from 'node:test';
import attachments from '../api/transaction-attachments.js';
import { readBody, setSession } from '../lib/server.js';

process.env.SESSION_SECRET = 'attachment-test-secret-at-least-thirty-two-characters';
process.env.SUPABASE_URL = 'https://attachments-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
const account = { id: '11111111-1111-4111-8111-111111111111', finance_user_id: '22222222-2222-4222-8222-222222222222', session_version: 1, active: true };
const transactionId = '33333333-3333-4333-8333-333333333333';
let cookie;
setSession({ setHeader(_name, value) { cookie = value.split(';')[0]; } }, account);
const headers = { cookie, host: 'dashboard.example.com', origin: 'https://dashboard.example.com', 'content-type': 'application/json' };
function response() { return { statusCode: 0, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } }; }

test('upload aceita imagem acima de 4 KB sem ampliar o limite dos demais endpoints', async () => {
  const data_url = `data:image/png;base64,${Buffer.alloc(6000).toString('base64')}`;
  const body = { transaction_id: transactionId, filename: 'comprovante.png', content_type: 'image/png', data_url };
  assert.throws(() => readBody({ headers, body }));
  const previous = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    if (options.method === 'POST') writes.push(JSON.parse(options.body));
    const data = path.endsWith('/dashboard_accounts') ? [account] : path.endsWith('/finance_transactions') ? [{ id: transactionId, user_id: account.finance_user_id }] : [{ id: transactionId }];
    return { ok: true, status: 200, json: async () => data };
  };
  try {
    const res = response();
    await attachments({ method: 'POST', headers, body: JSON.stringify(body) }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(writes[0].data_url, data_url);
    assert.equal(writes[0].finance_user_id, account.finance_user_id);
    const oversized = response();
    await attachments({ method: 'POST', headers, body: JSON.stringify({ ...body, data_url: 'a'.repeat(1404097) }) }, oversized);
    assert.equal(oversized.statusCode, 400);
    assert.equal(writes.length, 1);
  } finally { globalThis.fetch = previous; }
});


test('PDF do casal exige vínculo da sessão e mantém o proprietário da carteira', async () => {
  const previous = globalThis.fetch;
  const wallet = '44444444-4444-4444-8444-444444444444';
  const body = { transaction_id: transactionId, filename: 'comprovante.pdf', content_type: 'application/pdf', data_url: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.7\nFicticio').toString('base64') };
  const writes = []; let member = true; let attachmentReads = 0;
  globalThis.fetch = async (url, options) => {
    const u = new URL(url); const path = u.pathname;
    let data = [];
    if (path.endsWith('/dashboard_accounts')) data = [account];
    if (path.endsWith('/finance_transactions')) data = [{ id: transactionId, user_id: wallet }];
    if (path.endsWith('/finance_dashboard_couple_memberships')) { assert.equal(u.searchParams.get('account_id'), 'eq.' + account.id); assert.equal(u.searchParams.get('finance_user_id'), 'eq.' + wallet); data = member ? [{ account_id: account.id }] : []; }
    if (path.endsWith('/finance_transaction_attachments')) {
      if (options.method === 'POST') { writes.push(JSON.parse(options.body)); data = [{ id: transactionId }]; }
      else { attachmentReads++; data = [{ ...body, id: transactionId }]; }
    }
    return { ok: true, status: 200, json: async () => data };
  };
  try {
    const saved = response(); await attachments({ method: 'POST', headers, body: JSON.stringify(body) }, saved);
    assert.equal(saved.statusCode, 201); assert.equal(writes[0].finance_user_id, wallet);
    const listed = response(); await attachments({ method: 'GET', headers, query: { transaction_id: transactionId } }, listed);
    assert.equal(listed.statusCode, 200); assert.equal(listed.body.attachments[0].filename, 'comprovante.pdf');
    member = false;
    for (const method of ['GET', 'POST']) { const denied = response(); await attachments({ method, headers, query: { transaction_id: transactionId }, body: JSON.stringify(body) }, denied); assert.equal(denied.statusCode, 404); }
    assert.equal(writes.length, 1); assert.equal(attachmentReads, 1);
  } finally { globalThis.fetch = previous; }
});

test('rejeita PDF falso, MIME divergente e HTML sem gravar anexos', async () => {
  const previous = globalThis.fetch; let writes = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'POST') writes++;
    const path = new URL(url).pathname;
    const data = path.endsWith('/dashboard_accounts') ? [account] : path.endsWith('/finance_transactions') ? [{ id: transactionId, user_id: account.finance_user_id }] : [];
    return { ok: true, status: 200, json: async () => data };
  };
  try {
    for (const [content_type, data_url] of [['application/pdf', 'data:application/pdf;base64,' + Buffer.from('not a PDF').toString('base64')], ['application/pdf', 'data:image/png;base64,YWJj'], ['text/html', 'data:text/html;base64,YWJj']]) {
      const res = response(); await attachments({ method: 'POST', headers, body: JSON.stringify({ transaction_id: transactionId, filename: 'teste.pdf', content_type, data_url }) }, res); assert.equal(res.statusCode, 400);
    }
    assert.equal(writes, 0);
  } finally { globalThis.fetch = previous; }
});
