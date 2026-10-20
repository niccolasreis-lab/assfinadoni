import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';
const candidate = await readFile(new URL('../../supabase/proposals/transaction-attribution.sql', import.meta.url), 'utf8');
const W = '11111111-1111-4111-8111-111111111111';
const X = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OFF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PA = 'a0000000-0000-4000-8000-000000000001';
const PB = 'b0000000-0000-4000-8000-000000000001';
const PC = 'c0000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000001';
const T2 = '10000000-0000-4000-8000-000000000002';
const T3 = '10000000-0000-4000-8000-000000000003';
const fixture = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE finance_users(id uuid PRIMARY KEY);
CREATE TABLE dashboard_accounts(id uuid PRIMARY KEY,finance_user_id uuid REFERENCES finance_users(id),active boolean NOT NULL DEFAULT true);
CREATE TABLE finance_dashboard_couple_memberships(account_id uuid REFERENCES dashboard_accounts(id),finance_user_id uuid REFERENCES finance_users(id),PRIMARY KEY(account_id,finance_user_id));
CREATE TABLE finance_transactions(id uuid PRIMARY KEY,user_id uuid REFERENCES finance_users(id),transaction_type text NOT NULL,amount numeric NOT NULL,payment_details jsonb NOT NULL DEFAULT '{}',deleted_at timestamptz);
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
CREATE TABLE test_audit_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,request_id text,before_value jsonb,after_value jsonb);
CREATE FUNCTION finance_audit_write(uuid,text,text,text,uuid,uuid,text,jsonb,jsonb,jsonb) RETURNS void LANGUAGE sql AS $$INSERT INTO test_audit_events(request_id,before_value,after_value) VALUES($7,$8,$9)$$;
CREATE FUNCTION finance_dashboard_create_transaction() RETURNS text LANGUAGE sql AS $$SELECT 'legacy unchanged'::text$$;
INSERT INTO finance_users VALUES('${W}'),('${X}');
INSERT INTO dashboard_accounts VALUES('${A}','${W}',true),('${B}','${W}',true),('${C}','${X}',true),('${OFF}','${W}',false);
INSERT INTO finance_dashboard_couple_memberships VALUES('${A}','${W}'),('${B}','${W}'),('${C}','${X}'),('${OFF}','${W}');
INSERT INTO finance_transactions VALUES('${T}','${W}','despesa',20.10,'{"method":"hybrid","cash_amount":"5.00","installments":2}',NULL),('${T2}','${W}','despesa',30.20,'{}',NULL),('${T3}','${X}','despesa',50,'{}',NULL);
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT,UPDATE ON finance_transactions TO service_role;
GRANT SELECT ON dashboard_accounts,finance_dashboard_couple_memberships TO service_role;
GRANT INSERT ON test_audit_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE test_audit_events_id_seq TO service_role;
REVOKE ALL ON FUNCTION finance_audit_write(uuid,text,text,text,uuid,uuid,text,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance_audit_write(uuid,text,text,text,uuid,uuid,text,jsonb,jsonb,jsonb) TO service_role;
`;

test('persistência aditiva protege escopo, confirmação e integridade do ledger', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(fixture);
    const ledgerHash = async () => (await db.query('select md5(jsonb_agg(to_jsonb(t) order by id)::text) h from finance_transactions t')).rows[0].h;
    const legacyDefinition = async () => (await db.query("select pg_get_functiondef('finance_dashboard_create_transaction()'::regprocedure) d")).rows[0].d;
    const baseline = await ledgerHash();
    const legacy = await legacyDefinition();
    await db.exec(candidate);
    await db.exec(`INSERT INTO finance_wallet_participants(id,finance_user_id,account_id,display_name) VALUES('${PA}','${W}','${A}','Pessoa A'),('${PB}','${W}','${B}','Pessoa B'),('${PC}','${X}','${C}','Pessoa C')`);
    const call = async ({ account = A, tx = T, kind = 'participant', payers = [PB], recorder = null, confirmed = true, key = 'request-1', revision = 0 } = {}) => {
      await db.exec('SET ROLE service_role');
      try {
        return (await db.query('select finance_set_transaction_attribution($1::uuid,$2::uuid,$3::text,$4::uuid[],$5::uuid,$6::boolean,$7::text,$8::integer) result',
          [account, tx, kind, payers === null ? null : `{${payers.join(',')}}`, recorder, confirmed, key, revision])).rows[0].result;
      } finally { await db.exec('RESET ROLE'); }
    };
    const count = async (table) => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;

    await t.test('histórico não recebe backfill', async () => assert.equal(await count('finance_transaction_attributions'), 0));
    await t.test('confirmação ausente não escreve metadata nem auditoria', async () => {
      await assert.rejects(call({ confirmed: false }), /Confirmação/);
      await assert.rejects(call({ confirmed: null }), /Confirmação/);
      assert.equal(await count('finance_transaction_attributions'), 0);
      assert.equal(await count('test_audit_events'), 0);
    });
    await t.test('conta inativa é recusada', async () => assert.rejects(call({ account: OFF }), /Acesso/));
    await t.test('transação de outra carteira é recusada', async () => assert.rejects(call({ tx: T3 }), /Acesso/));
    await t.test('pessoa de outra carteira é recusada', async () => assert.rejects(call({ payers: [PC] }), /Participante/));
    await t.test('atribuição retroativa não pode inventar autor da origem', async () => {
      await assert.rejects(call({ recorder: PA }), /Autor da origem/);
      await assert.rejects(call({ recorder: PB }), /Autor da origem/);
    });
    await t.test('individual exige exatamente uma pessoa', async () => assert.rejects(call({ payers: [PA, PB] }), /check constraint/i));
    await t.test('conjunto exige duas pessoas diferentes', async () => {
      await assert.rejects(call({ kind: 'joint', payers: [PA] }), /check constraint/i);
      await assert.rejects(call({ kind: 'joint', payers: [PA, PA] }), /Participante repetido/);
    });
    await t.test('desconhecido não aceita participante oculto', async () => assert.rejects(call({ kind: 'unknown', payers: [PA] }), /check constraint/i));
    await t.test('lista nula não contorna a validação', async () => assert.rejects(call({ payers: null }), /Atribuição inválida/));
    await t.test('operador da atribuição não vira autor da origem', async () => {
      const r = await call();
      assert.equal(r.recorded_by_participant_id, null);
      assert.deepEqual(r.participant_ids, [PB]);
      assert.equal(r.attributed_by_account_id, A);
      assert.equal(r.revision, 1);
    });
    await t.test('reparenting privilegiado impede retry e nova revisão em carteira divergente', async () => {
      await db.query('insert into finance_dashboard_couple_memberships values($1,$2)', [A, X]);
      await db.query('update finance_transactions set user_id=$1 where id=$2', [X, T]);
      try {
        await assert.rejects(call(), /Carteira da atribuição não corresponde/);
        await assert.rejects(call({ key: 'reparented-revision', revision: 1 }), /Carteira da atribuição não corresponde/);
        const stored = (await db.query('select finance_user_id,revision from finance_transaction_attributions where transaction_id=$1', [T])).rows[0];
        assert.deepEqual(stored, { finance_user_id: W, revision: 1 });
      } finally {
        await db.query('update finance_transactions set user_id=$1 where id=$2', [W, T]);
        await db.query('delete from finance_dashboard_couple_memberships where account_id=$1 and finance_user_id=$2', [A, X]);
      }
    });
    await t.test('retry idêntico não muda revisão nem duplica auditoria', async () => {
      const before = await count('test_audit_events');
      const r = await call();
      assert.equal(r.revision, 1);
      assert.equal(await count('test_audit_events'), before);
    });
    await t.test('chave reutilizada com payload diferente é recusada', async () => assert.rejects(call({ payers: [PA] }), /Chave/));
    await t.test('nova chave com revisão antiga não sobrescreve', async () => assert.rejects(call({ key: 'stale', revision: 0 }), /consulte novamente/));
    await t.test('pagamento conjunto grava só metadados canônicos', async () => {
      const r = await call({ kind: 'joint', payers: [PB, PA], key: 'request-2', revision: 1 });
      assert.equal(r.revision, 2);
      assert.deepEqual(r.participant_ids, [PA, PB]);
    });
    await t.test('retry velho não desfaz revisão nova', async () => assert.rejects(call(), /consulte novamente/));
    await t.test('histórico anotado sem autor continua sem autor', async () => {
      const r = await call({ tx: T2, kind: 'unknown', payers: [], key: 'history-1' });
      assert.equal(r.recorded_by_participant_id, null);
      assert.equal(r.kind, 'unknown');
    });
    await t.test('editar pagador não preenche autoria antiga', async () => assert.rejects(call({ tx: T2, recorder: PA, key: 'history-2', revision: 1 }), /Autor da origem/));
    await t.test('inativo não recebe nova atribuição e histórico é preservado', async () => {
      await db.exec(`UPDATE finance_wallet_participants SET active=false WHERE id='${PB}'`);
      await assert.rejects(call({ tx: T2, key: 'inactive', revision: 1 }), /Participante/);
      assert.equal((await db.query('select cardinality(participant_ids) n from finance_transaction_attributions where transaction_id=$1', [T])).rows[0].n, 2);
    });
    await t.test('reaplicação preserva metadata, pagamentos e RPC legado', async () => {
      await db.exec(candidate);
      assert.equal(await count('finance_transaction_attributions'), 2);
      assert.equal(await ledgerHash(), baseline);
      assert.equal(await legacyDefinition(), legacy);
    });
    await t.test('RLS, invoker e grants continuam privados ao backend', async () => {
      const r = (await db.query("select has_function_privilege('anon','finance_set_transaction_attribution(uuid,uuid,text,uuid[],uuid,boolean,text,integer)','execute') anon_exec,has_function_privilege('authenticated','finance_set_transaction_attribution(uuid,uuid,text,uuid[],uuid,boolean,text,integer)','execute') user_exec,has_function_privilege('service_role','finance_set_transaction_attribution(uuid,uuid,text,uuid[],uuid,boolean,text,integer)','execute') server_exec,has_table_privilege('service_role','finance_transaction_attributions','insert') direct_insert,has_table_privilege('anon','finance_transaction_attributions','select') anon_select")).rows[0];
      assert.deepEqual(r, { anon_exec: false, user_exec: false, server_exec: true, direct_insert: true, anon_select: false });
      assert.equal((await db.query("select count(*)::int n from pg_class where relname in ('finance_wallet_participants','finance_transaction_attributions') and relrowsecurity")).rows[0].n, 2);
      assert.equal((await db.query("select prosecdef from pg_proc where oid='finance_set_transaction_attribution(uuid,uuid,text,uuid[],uuid,boolean,text,integer)'::regprocedure")).rows[0].prosecdef, false);
      assert.equal((await db.query("select rolbypassrls from pg_roles where rolname='service_role'")).rows[0].rolbypassrls, true);
    });
  } finally { await db.close(); }
});
