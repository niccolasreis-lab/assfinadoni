import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const group = '11111111-1111-4111-8111-111111111111';
const personal = '22222222-2222-4222-8222-222222222222';
const partnerWallet = '77777777-7777-4777-8777-777777777777';
const account = '33333333-3333-4333-8333-333333333333';
const partner = '44444444-4444-4444-8444-444444444444';
const person = '55555555-5555-4555-8555-555555555555';
const other = '66666666-6666-4666-8666-666666666666';
const subject = '5511000000001@s.whatsapp.net';

test('pagador funciona sobre todas as migrations preservando ledger e pagamento híbrido', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync(new URL('../../supabase/bootstrap.sql', import.meta.url), 'utf8'));
    for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) {
      if (name.includes('finance_trash_cron')) continue;
      await db.exec(readFileSync(new URL(name, migrations), 'utf8')
        .replace(/^create extension if not exists pgcrypto with schema extensions;\s*/im, ''));
    }
    await db.query("insert into finance_users(id,telegram_chat_id,name) values($1,120363433,'Casal teste'),($2,10,'Pessoal teste'),($3,11,'Pessoal parceiro teste')", [group, personal, partnerWallet]);
    await db.query("insert into dashboard_accounts(id,username,display_name,password_hash,finance_user_id,active) values($1,'pessoa_a','Pessoa A','fixture',$2,true),($3,'pessoa_b','Pessoa B','fixture',$4,true)", [account, personal, partner, partnerWallet]);
    await db.query('insert into finance_dashboard_couple_memberships(account_id,finance_user_id) values($1,$2),($3,$2)', [account, group, partner]);
    await db.query("insert into finance_wallet_participants(id,finance_user_id,account_id,display_name,whatsapp_jid) values($1,$2,$3,'Pessoa A',$4),($5,$2,$6,'Pessoa B',null)", [person, group, account, subject, other, partner]);
    const payment = { method: 'misto', cash_amount: 5, installments: 2, installment_amount: 12.5 };
    const tx = (await db.query("insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date,payment_details,source,external_event_id) values($1,987654,'despesa',30,'Outros','Fixture nova',current_date,$2::jsonb,'API','wa:fixture:0') returning id", [group, JSON.stringify(payment)])).rows[0].id;
    const before = (await db.query('select to_jsonb(t) value from finance_transactions t where id=$1', [tx])).rows[0].value;
    await db.exec('set role service_role');
    const write = () => db.query("select finance_whatsapp_set_payer($1,$2,$3,'wa:fixture:0','participant',$4::uuid[],true) value", [group, subject, tx, '{' + other + '}']);
    const created = (await write()).rows[0].value;
    const replay = (await write()).rows[0].value;
    const ctx = (await db.query('select finance_whatsapp_payer_context($1,$2,$3::uuid[]) value', [group, subject, '{' + tx + '}'])).rows[0].value;
    await db.exec('reset role');
    assert.equal(created.ok, true);
    assert.equal(created.attribution.recorded_by_participant_id, null);
    assert.deepEqual(created.attribution.participant_ids, [other]);
    assert.deepEqual(replay, created);
    assert.equal(ctx.attributions.length, 1);
    assert.equal(ctx.participants.length, 2);
    assert.equal(JSON.stringify(ctx).includes(subject), false);
    assert.deepEqual((await db.query('select to_jsonb(t) value from finance_transactions t where id=$1', [tx])).rows[0].value, before);
    const report = (await db.query('select finance_dashboard_couple_transactions($1,$2::jsonb) value', [account, JSON.stringify({ month: before.transaction_date.slice(0, 7) })])).rows[0].value;
    assert.equal(report.summary.expense, 30);
    assert.deepEqual(report.transactions[0].payment_details, payment);
    assert.equal((await db.query("select count(*)::int n from finance_audit_logs where entity_type='transaction_attribution' and entity_id=$1", [tx])).rows[0].n, 1);
    const publicRpcs = await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'finance_%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))");
    assert.equal(publicRpcs.rows.length, 0);
  } finally { await db.close(); }
});
