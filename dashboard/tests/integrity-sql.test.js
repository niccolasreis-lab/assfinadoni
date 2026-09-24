import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20260924120000_finance_integrity_foundation.sql', import.meta.url), 'utf8');
const uid = '11111111-1111-4111-8111-111111111111';
const aid = '22222222-2222-4222-8222-222222222222';
const tid = '33333333-3333-4333-8333-333333333333';
const cid = '44444444-4444-4444-8444-444444444444';

test('fundação mantém eventos idempotentes, fingerprint estável, auditoria e merge explícito', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table finance_users(id uuid primary key);
      create table dashboard_accounts(id uuid primary key, finance_user_id uuid, active boolean);
      create table finance_assistant_jobs(
        id uuid primary key, user_id uuid, channel text, request_key text, payload jsonb,
        file_hash text, status text, result jsonb, processing_event_id uuid
      );
      create table finance_transactions(
        id uuid primary key, user_id uuid, transaction_type text, amount numeric,
        category text, description text, transaction_date date, created_at timestamptz default now(),
        deleted_at timestamptz, deleted_by_account_id uuid, updated_by_account_id uuid
      );
      insert into finance_users values ('${uid}');
      insert into dashboard_accounts values ('${aid}','${uid}',true);
    `);
    await db.exec(migration);
    const value = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
    const first = await value("select finance_processing_event_begin($1,'TELEGRAM','update:42','42','hash-a','{}'::jsonb) value", [uid]);
    const second = await value("select finance_processing_event_begin($1,'TELEGRAM','update:42','42','hash-a','{}'::jsonb) value", [uid]);
    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.event.id, first.event.id);

    const fp1 = await value("select finance_transaction_fingerprint($1,'despesa',42.00,'2026-09-24','  Mercado   Teste ','Alimentação','TELEGRAM') value", [uid]);
    const fp2 = await value("select finance_transaction_fingerprint($1,'despesa',42,'2026-09-24','Mercado Teste','Alimentação','TELEGRAM') value", [uid]);
    assert.equal(fp1, fp2);

    await db.query("insert into finance_transactions(id,user_id,transaction_type,amount,category,description,transaction_date,fingerprint) values ($1,$2,'despesa',42,'Alimentação','Mercado Teste','2026-09-24',$3),($4,$2,'despesa',42,'Alimentação','Mercado Teste','2026-09-24',$3)", [tid, uid, fp1, cid]);
    const audit = await value("select finance_audit_write($1,'TELEGRAM','CREATE','transaction',$2,null,'telegram:42',null,'{}'::jsonb,'{}'::jsonb) value", [uid, tid]);
    assert.equal(audit.entity_type, 'transaction');
    await db.query("insert into finance_transaction_duplicates(user_id,transaction_id,candidate_transaction_id,kind,confidence) values ($1,$2,$3,'EXACT_DUPLICATE',0.99)", [uid, tid, cid]);
    const duplicate = await value("select id value from finance_transaction_duplicates limit 1");
    const resolved = await value("select finance_duplicate_resolve($1,$2,$3,'merge') value", [uid, aid, duplicate]);
    assert.equal(resolved.status, 'merged');
    assert.equal(await value("select deleted_at is not null value from finance_transactions where id=$1", [cid]), true);
  } finally {
    await db.close();
  }
});
