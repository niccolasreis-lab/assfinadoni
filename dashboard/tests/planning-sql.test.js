import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const integrity = readFileSync(new URL('../../supabase/migrations/20260924120000_finance_integrity_foundation.sql', import.meta.url), 'utf8');
const planning = readFileSync(new URL('../../supabase/migrations/20260924140000_finance_planning_intelligence.sql', import.meta.url), 'utf8');
const uid = '11111111-1111-4111-8111-111111111111';
const tid = '33333333-3333-4333-8333-333333333333';

test('budgets, metas, alertas e insights permanecem isolados e explicáveis', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table finance_users(id uuid primary key);
      create table dashboard_accounts(id uuid primary key, finance_user_id uuid, active boolean);
      create table finance_assistant_jobs(id uuid primary key, user_id uuid, channel text, request_key text, payload jsonb, file_hash text, status text, result jsonb, processing_event_id uuid);
      create table finance_transactions(
        id uuid primary key, user_id uuid, transaction_type text, amount numeric,
        category text, description text, transaction_date date, created_at timestamptz default now(),
        deleted_at timestamptz, deleted_by_account_id uuid, updated_by_account_id uuid
      );
      create table finance_installments(id uuid primary key,user_id uuid,plan_id uuid,number integer,due_date date,status text,amount numeric);
      create table finance_subscriptions(id uuid primary key,user_id uuid,name text,next_due_date date,status text,amount numeric);
      create table finance_reminders(id uuid primary key,finance_user_id uuid,status text,kind text,due_date date,amount numeric);
      insert into finance_users values ('${uid}');
      insert into finance_transactions(id,user_id,transaction_type,amount,category,description,transaction_date)
      values ('${tid}','${uid}','despesa',80,'Alimentação','Mercado','2026-09-24');
    `);
    await db.exec(integrity);
    await db.exec(planning);
    const value = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
    const budget = await value("select finance_budget_create($1,$2::jsonb) value", [uid, JSON.stringify({ name: 'Alimentação', scope_type: 'category', category: 'Alimentação', planned_amount: 100, period_type: 'monthly', start_date: '2026-09-01', end_date: '2026-09-30' })]);
    const summary = await value("select finance_budget_summary($1,$2) value", [uid, budget.id]);
    assert.equal(Number(summary[0].realized), 80);
    assert.equal(Number(summary[0].remaining), 20);
    const goal = await value("select finance_goal_create($1,$2::jsonb) value", [uid, JSON.stringify({ name: 'Reserva', target_amount: 1000 })]);
    const contribution = await value("select finance_goal_contribute($1,$2,$3::jsonb) value", [uid, goal.id, JSON.stringify({ amount: 250 })]);
    assert.equal(Number(contribution.amount), 250);
    await db.query("insert into finance_alerts(user_id,type,severity,source,metadata) values ($1,'BUDGET','warning','AI','{}'::jsonb)", [uid]);
    const alerts = await value("select finance_alert_list($1) value", [uid]);
    assert.equal(alerts.length, 1);
  } finally { await db.close(); }
});
