import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const integrity = readFileSync(new URL('../../supabase/migrations/20260924120000_finance_integrity_foundation.sql', import.meta.url), 'utf8');
const domain = readFileSync(new URL('../../supabase/migrations/20260924130000_finance_domain_foundation.sql', import.meta.url), 'utf8');
const uid = '11111111-1111-4111-8111-111111111111';
const aid = '22222222-2222-4222-8222-222222222222';
const tid = '33333333-3333-4333-8333-333333333333';

test('domínio financeiro valida contas, cartão, splits exatos e parcelas sem duplicar despesa', async () => {
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
      create table finance_reminders(id uuid primary key,finance_user_id uuid,status text,kind text,due_date date,amount numeric);
      create table finance_alerts(id uuid primary key,user_id uuid,created_at timestamptz default now());
      create table finance_installments(id uuid primary key default gen_random_uuid(),user_id uuid,plan_id uuid,number integer,due_date date,status text default 'planned',amount numeric);
      create table finance_subscriptions(id uuid primary key,user_id uuid,name text,next_due_date date,status text,amount numeric);
      insert into finance_users values ('${uid}');
      insert into dashboard_accounts values ('${aid}','${uid}',true);
      insert into finance_transactions(id,user_id,transaction_type,amount,category,description,transaction_date)
      values ('${tid}','${uid}','despesa',100,'Outros','Compra teste','2026-09-24');
    `);
    await db.exec(integrity);
    await db.exec(domain);
    const value = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
    const account = await value("select finance_account_create($1,$2::jsonb) value", [uid, JSON.stringify({ name: 'Carteira', type: 'cash', opening_balance: 0 })]);
    const card = await value("select finance_card_create($1,$2::jsonb) value", [uid, JSON.stringify({ name: 'Cartão principal', limit_amount: 1000, closing_day: 20, due_day: 28 })]);
    assert.equal(account.type, 'cash');
    assert.equal(card.name, 'Cartão principal');
    const splits = await value("select finance_transaction_splits_replace($1,$2,$3::jsonb,$4) value", [uid, tid, JSON.stringify([{ account_id: account.id, amount: 30 }, { credit_card_id: card.id, amount: 70 }]), aid]);
    assert.equal(splits.length, 2);
    const plan = await value("select finance_installment_plan_create($1,$2::jsonb,$3) value", [uid, JSON.stringify({ transaction_id: tid, credit_card_id: card.id, total_amount: 70, installment_count: 2, first_due_date: '2026-10-28' }), aid]);
    assert.equal(plan.installments.length, 2);
    assert.equal(plan.installments.reduce((sum, row) => sum + Number(row.amount), 0), 70);
    assert.equal(await value("select count(*)::int value from finance_transactions where deleted_at is null"), 1);
    await assert.rejects(db.query("select finance_transaction_splits_replace($1,$2,$3::jsonb,$4)", [uid, tid, JSON.stringify([{ account_id: account.id, amount: 29 }]), aid]));
  } finally {
    await db.close();
  }
});
