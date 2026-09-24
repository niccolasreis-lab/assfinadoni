import assert from 'node:assert/strict';
import test from 'node:test';
import mcp from '../api/v1/mcp.js';
import { setSession } from '../lib/server.js';

process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL = 'https://projeto-teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa-de-teste';
process.env.ENABLE_MCP = 'true';
const account = { id: '11111111-1111-4111-8111-111111111111', username: 'nicolasreis', session_version: 1, active: true, finance_user_id: '22222222-2222-4222-8222-222222222222', finance_users: { name: 'Nicolas' } };
let cookie; setSession({ setHeader(_name, value) { cookie = value.split(';')[0]; } }, account);
const headers = { cookie, origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com', 'content-type': 'application/json' };
function response() { return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } }; }

test('gateway MCP lista ferramentas e executa somente com a sessão autenticada', async () => {
  const old = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url); calls.push({ parsed, body: options?.body ? JSON.parse(options.body) : null });
    if (parsed.pathname.endsWith('/dashboard_accounts')) return { ok: true, status: 200, json: async () => [account] };
    if (parsed.pathname.endsWith('/rpc/finance_account_list')) return { ok: true, status: 200, json: async () => [] };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  try {
    const list = response(); await mcp({ method: 'GET', headers }, list); assert.equal(list.statusCode, 200); assert.ok(list.body.tools.get_balance);
    const run = response(); await mcp({ method: 'POST', headers, body: { tool: 'get_accounts', arguments: {} } }, run); assert.equal(run.statusCode, 200);
    assert.equal(calls.find((call) => call.parsed.pathname.endsWith('/rpc/finance_account_list')).body.p_user_id, account.finance_user_id);
    assert.ok(calls.some((call) => call.parsed.pathname.endsWith('/rpc/finance_audit_write')));
  } finally { globalThis.fetch = old; }
});

