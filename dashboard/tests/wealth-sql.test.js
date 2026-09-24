import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const integrity = readFileSync(new URL('../../supabase/migrations/20260924120000_finance_integrity_foundation.sql', import.meta.url), 'utf8');
const wealth = readFileSync(new URL('../../supabase/migrations/20260924150000_finance_wealth.sql', import.meta.url), 'utf8');
const uid = '11111111-1111-4111-8111-111111111111';

test('patrimônio separa valor informado, investimentos, dívidas e caixa', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table finance_users(id uuid primary key);
      create table dashboard_accounts(id uuid primary key, finance_user_id uuid, active boolean);
      create table finance_assistant_jobs(id uuid primary key, user_id uuid, channel text, request_key text, payload jsonb, file_hash text, status text, result jsonb, processing_event_id uuid);
      create table finance_transactions(id uuid primary key,user_id uuid,transaction_type text,amount numeric,category text,description text,transaction_date date,created_at timestamptz default now(),deleted_at timestamptz,deleted_by_account_id uuid,updated_by_account_id uuid);
      insert into finance_users values ('${uid}');
      insert into finance_transactions values ('33333333-3333-4333-8333-333333333333','${uid}','receita',1000,'Outros','Salário','2026-09-01',now(),null,null,null);
    `);
    await db.exec(integrity);
    await db.exec(wealth);
    const value = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
    await value("select finance_investment_create($1,$2::jsonb) value", [uid, JSON.stringify({ category: 'Renda fixa', asset: 'CDB', invested_amount: 200, current_value: 210, recorded_at: '2026-09-24' })]);
    await db.query("insert into finance_liabilities(user_id,name,category,outstanding_amount,recorded_at) values ($1,'Dívida','Outros',50,'2026-09-24')", [uid]);
    const net = await value("select finance_net_worth($1) value", [uid]);
    assert.equal(Number(net.investments), 210);
    assert.equal(Number(net.liabilities), 50);
    assert.equal(Number(net.net_worth), 1160);
  } finally { await db.close(); }
});
