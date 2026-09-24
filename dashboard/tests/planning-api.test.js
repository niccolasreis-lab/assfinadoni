import assert from 'node:assert/strict';
import test from 'node:test';
import budgets from '../api/budgets.js';
import goals from '../api/goals.js';
import alerts from '../api/alerts.js';
import insights from '../api/insights.js';
import { setSession } from '../lib/server.js';

process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL = 'https://projeto-teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa-de-teste';
process.env.ENABLE_BUDGETS = 'true'; process.env.ENABLE_GOALS = 'true'; process.env.ENABLE_SMART_ALERTS = 'true'; process.env.ENABLE_AI_AGENTS = 'true';
const account = { id: '11111111-1111-4111-8111-111111111111', username: 'nicolasreis', session_version: 1, active: true, finance_user_id: '22222222-2222-4222-8222-222222222222', finance_users: { name: 'Nicolas' } };
let cookie; setSession({ setHeader(_name, value) { cookie = value.split(';')[0]; } }, account);
const headers = { cookie, origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com', 'content-type': 'application/json' };
function response() { return { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } }; }

test('planejamento e inteligência preservam o escopo da sessão e as flags', async () => {
  const old = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(url); calls.push(parsed);
    if (parsed.pathname.endsWith('/dashboard_accounts')) return { ok: true, status: 200, json: async () => [account] };
    return { ok: true, status: 200, json: async () => [] };
  };
  try {
    const b = response(); await budgets({ method: 'GET', headers, query: {} }, b); assert.equal(b.statusCode, 200);
    const g = response(); await goals({ method: 'GET', headers, query: {} }, g); assert.equal(g.statusCode, 200);
    const a = response(); await alerts({ method: 'GET', headers, query: {} }, a); assert.equal(a.statusCode, 200);
    const i = response(); await insights({ method: 'GET', headers, query: {} }, i); assert.equal(i.statusCode, 200);
    assert.ok(calls.some((url) => url.pathname.endsWith('/rpc/finance_budget_summary')));
    assert.ok(calls.some((url) => url.pathname.endsWith('/rpc/finance_goal_list')));
  } finally { globalThis.fetch = old; }
});
