import assert from 'node:assert/strict';
import test from 'node:test';
import { executeFinanceTool, FinanceToolError, TOOL_DEFINITIONS } from '../lib/finance-tools.js';

const context = { userId: '11111111-1111-4111-8111-111111111111', accountId: '22222222-2222-4222-8222-222222222222' };

test('registro de ferramentas exige contexto, escopo e confirmação destrutiva', async () => {
  assert.ok(TOOL_DEFINITIONS.get_balance);
  const calls = [];
  const rpc = async (name, body) => { calls.push({ name, body }); return { ok: true }; };
  await executeFinanceTool('get_balance', {}, context, { rpc });
  await executeFinanceTool('create_transaction', { transaction_type: 'despesa', amount: 42, category: 'Alimentação', description: 'Almoço', transaction_date: '2026-09-24' }, context, { rpc });
  await assert.rejects(executeFinanceTool('delete_transaction', { id: '33333333-3333-4333-8333-333333333333' }, context, { rpc }), (error) => error instanceof FinanceToolError && error.code === 'CONFIRMATION_REQUIRED');
  await executeFinanceTool('delete_transaction', { id: '33333333-3333-4333-8333-333333333333' }, { ...context, confirmed: true }, { rpc });
  assert.equal(calls[0].name, 'finance_balance_summary');
  assert.equal(calls[1].body.p_account_id, context.accountId);
  assert.equal(calls[2].name, 'finance_dashboard_delete_transaction');
});

test('ferramenta indisponível não inventa dados e argumentos inválidos são rejeitados', async () => {
  await assert.rejects(executeFinanceTool('get_investments', {}, context, { rpc: async () => ({}) }), (error) => error.code === 'FEATURE_UNAVAILABLE');
  await assert.rejects(executeFinanceTool('get_transactions', { limit: 0 }, context, { rpc: async () => ({}) }), (error) => error.code === 'INVALID_ARGUMENT');
  await assert.rejects(executeFinanceTool('get_balance', {}, {}, { rpc: async () => ({}) }), (error) => error.code === 'UNAUTHORIZED');
});

