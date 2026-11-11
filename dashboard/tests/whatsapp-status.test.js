import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../handlers/whatsapp.js';
import { setSession } from '../lib/server.js';

process.env.SESSION_SECRET = 'whatsapp-status-synthetic-secret-at-least-32-chars';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
const account = { id: '11111111-1111-4111-8111-111111111111', finance_user_id: '22222222-2222-4222-8222-222222222222', active: true, session_version: 1, username: 'member' };
const wallet = '33333333-3333-4333-8333-333333333333';
const phone = '5511000000001@s.whatsapp.net';
let cookie; setSession({ setHeader(_name, value) { cookie = value.split(';')[0]; } }, account);
const response = () => ({ code: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
const request = (override = {}) => ({ method: 'GET', headers: { cookie }, query: { account_id: 'forged', user_id: 'forged' }, ...override });

test('pendências vêm apenas das carteiras e telefone vinculados à conta da sessão; nenhuma escrita ou contato é exposto', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (raw, options = {}) => {
    const url = new URL(raw); calls.push({ url, options });
    let value;
    if (url.pathname.endsWith('/dashboard_accounts')) value = [account];
    else if (url.pathname.endsWith('/finance_dashboard_couple_memberships')) { assert.equal(url.searchParams.get('account_id'), `eq.${account.id}`); value = [{ finance_user_id: wallet }]; }
    else if (url.pathname.endsWith('/finance_wallet_participants')) { assert.equal(url.searchParams.get('account_id'), `eq.${account.id}`); assert.equal(url.searchParams.get('finance_user_id'), `in.(${wallet})`); value = [{ finance_user_id: wallet, whatsapp_jid: phone }]; }
    else if (url.pathname.endsWith('/finance_pending_queue')) {
      assert.equal(url.searchParams.get('sender_id'), `eq.${phone}`); assert.equal(url.searchParams.get('user_id'), `eq.${wallet}`);
      assert.equal(url.searchParams.get('chat_id'), 'eq.120363433444431792@g.us');
      assert.doesNotMatch(url.searchParams.get('select'), /attachment|data_url/);
      value = [
        { source_message_id: 'hm_NEW', status: 'pending', transactions: [{ description: '<script>example</script>', amount: '25.00' }] },
        { source_message_id: 'hm_WORKING', status: 'processing', lease_until: '2999-01-01T00:00:00Z', transactions: [{ description: 'Casa', amount: '20.00' }] },
        { source_message_id: 'hm_EXPIRED_LEASE', status: 'processing', lease_until: '2000-01-01T00:00:00Z', transactions: [{ description: 'Pix', amount: '3.00' }] },
        { source_message_id: 'OLD_WORKFLOW', status: 'pending', transactions: [{ description: 'Old', amount: '1000.00' }] },
      ];
    } else { assert.equal(url.hostname, 'hermes-autopilot.n3hukr.easypanel.host'); assert.equal(options.headers, undefined); value = { status: 'ok', financial_execution: 'supabase_confirmed' }; }
    return { ok: true, status: 200, json: async () => value };
  };
  try {
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 200); assert.equal(res.body.pending_count, 2); assert.equal(res.body.processing_count, 1);
    assert.equal(res.body.service, 'available'); assert.equal(res.body.proposals.length, 3);
    assert.doesNotMatch(JSON.stringify(res.body), /5511000000001|test-only-key|forged|user_id|source_message_id/);
    assert(calls.every(call => call.options.method === undefined || call.options.method === 'GET'));
    assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally { globalThis.fetch = original; }
});

test('sem sessão ou permissão não consulta pendências; erros do banco não aparecem como fila vazia', async () => {
  const original = globalThis.fetch; let allowed = false, fail = false, queueQueries = 0;
  globalThis.fetch = async raw => {
    const path = new URL(raw).pathname;
    if (path.endsWith('/dashboard_accounts')) return { ok: true, status: 200, json: async () => [account] };
    if (path.endsWith('/finance_dashboard_couple_memberships')) return { ok: true, status: 200, json: async () => allowed ? [{ finance_user_id: wallet }] : [] };
    if (path.endsWith('/finance_wallet_participants')) return { ok: true, status: 200, json: async () => [{ finance_user_id: wallet, whatsapp_jid: phone }] };
    queueQueries++;
    if (fail) throw new Error('private infrastructure detail');
    throw new Error('unexpected request');
  };
  try {
    const anon = response(); await handler(request({ headers: {} }), anon); assert.equal(anon.code, 401);
    const denied = response(); await handler(request(), denied); assert.equal(denied.code, 403); assert.equal(queueQueries, 0);
    allowed = true;
    const write = response(); await handler(request({ method: 'POST' }), write); assert.equal(write.code, 405); assert.equal(queueQueries, 0);
    fail = true; const failed = response(); await handler(request(), failed); assert.equal(failed.code, 503);
    assert.equal(failed.body.pending_count, undefined); assert.doesNotMatch(JSON.stringify(failed.body), /private infrastructure/);
  } finally { globalThis.fetch = original; }
});

test('bot indisponível preserva propostas válidas do banco', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async raw => {
    const path = new URL(raw).pathname;
    const values = path.endsWith('/dashboard_accounts') ? [account]
      : path.endsWith('/finance_dashboard_couple_memberships') ? [{ finance_user_id: wallet }]
        : path.endsWith('/finance_wallet_participants') ? [{ finance_user_id: wallet, whatsapp_jid: phone }]
          : path.endsWith('/finance_pending_queue') ? [{ source_message_id: 'hm_A', status: 'pending', transactions: [{ description: 'Mercado', amount: '25.00' }] }] : null;
    if (values === null) throw new Error('service offline');
    return { ok: true, status: 200, json: async () => values };
  };
  try {
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 200); assert.equal(res.body.service, 'unavailable'); assert.equal(res.body.pending_count, 1);
  } finally { globalThis.fetch = original; }
});
