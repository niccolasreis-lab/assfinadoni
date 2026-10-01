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
