import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const { PGlite } = await import(process.env.FINANCE_SQL_TEST_MODULE || '@electric-sql/pglite');
const base = await readFile(new URL('../../supabase/proposals/transaction-attribution.sql', import.meta.url), 'utf8');
const candidate = await readFile(new URL('../../supabase/proposals/whatsapp-payer.sql', import.meta.url), 'utf8');
const W = '11111111-1111-4111-8111-111111111111';
const X = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OFF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PA = 'a0000000-0000-4000-8000-000000000001';
const PB = 'b0000000-0000-4000-8000-000000000001';
const PC = 'c0000000-0000-4000-8000-000000000001';
const POFF = 'd0000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000001';
const LEGACY = '10000000-0000-4000-8000-000000000002';
const FOREIGN = '10000000-0000-4000-8000-000000000003';
const NOEVENT = '10000000-0000-4000-8000-000000000004';
const INCOME = '10000000-0000-4000-8000-000000000005';
const DELETED = '10000000-0000-4000-8000-000000000006';
const OTHER_SOURCE = '10000000-0000-4000-8000-000000000007';
const JIDA = '5511000000001@s.whatsapp.net';
const JIDB = '5511000000002@s.whatsapp.net';
const JIDC = '5511000000003@s.whatsapp.net';
const JIDOFF = '5511000000004@s.whatsapp.net';
const fixture = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE TABLE finance_users(id uuid PRIMARY KEY,telegram_chat_id bigint);
CREATE TABLE dashboard_accounts(id uuid PRIMARY KEY,finance_user_id uuid REFERENCES finance_users(id),active boolean NOT NULL DEFAULT true);
CREATE TABLE finance_dashboard_couple_memberships(account_id uuid REFERENCES dashboard_accounts(id),finance_user_id uuid REFERENCES finance_users(id),PRIMARY KEY(account_id,finance_user_id));
CREATE TABLE finance_transactions(id uuid PRIMARY KEY,user_id uuid REFERENCES finance_users(id),transaction_type text NOT NULL,amount numeric NOT NULL,payment_details jsonb NOT NULL DEFAULT '{}',deleted_at timestamptz,source text,external_event_id text);
ALTER TABLE finance_transactions ENABLE ROW LEVEL SECURITY;
CREATE TABLE test_audit_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,request_id text,before_value jsonb,after_value jsonb);
CREATE FUNCTION finance_audit_write(uuid,text,text,text,uuid,uuid,text,jsonb,jsonb,jsonb) RETURNS void LANGUAGE sql AS $$INSERT INTO test_audit_events(request_id,before_value,after_value) VALUES($7,$8,$9)$$;
INSERT INTO finance_users VALUES('${W}',120363433),('${X}',999999999);
INSERT INTO dashboard_accounts VALUES('${A}','${W}',true),('${B}','${W}',true),('${C}','${X}',true),('${OFF}','${W}',false);
INSERT INTO finance_dashboard_couple_memberships VALUES('${A}','${W}'),('${B}','${W}'),('${C}','${X}'),('${OFF}','${W}');
INSERT INTO finance_transactions VALUES
('${T}','${W}','despesa',20.10,'{"method":"hybrid","cash_amount":"5.00","installments":2}',NULL,'API','event-new-1'),
('${LEGACY}','${W}','despesa',30.20,'{}',NULL,'SYSTEM',NULL),
('${FOREIGN}','${X}','despesa',50,'{}',NULL,'API','event-foreign'),
('${NOEVENT}','${W}','despesa',40,'{}',NULL,'API',NULL),
('${INCOME}','${W}','receita',10,'{}',NULL,'API','event-income'),
('${DELETED}','${W}','despesa',10,'{}','2026-10-20T00:00:00Z','API','event-deleted'),
('${OTHER_SOURCE}','${W}','despesa',10,'{}',NULL,'WEB','event-web');
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT,UPDATE ON finance_transactions TO service_role;
GRANT SELECT ON finance_users,dashboard_accounts,finance_dashboard_couple_memberships TO service_role;
GRANT INSERT ON test_audit_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE test_audit_events_id_seq TO service_role;
REVOKE ALL ON FUNCTION finance_audit_write(uuid,text,text,text,uuid,uuid,text,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance_audit_write(uuid,text,text,text,uuid,uuid,text,jsonb,jsonb,jsonb) TO service_role;
`;

test('WhatsApp associa somente eventos comprovados e identidades vinculadas', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(fixture);
    const ledgerHash = async () => (await db.query('select md5(jsonb_agg(to_jsonb(t) order by id)::text) h from finance_transactions t')).rows[0].h;
    const baseline = await ledgerHash();
    await db.exec(base);
    const baseDefinition = (await db.query("select pg_get_functiondef('finance_set_transaction_attribution(uuid,uuid,text,uuid[],uuid,boolean,text,integer)'::regprocedure) d")).rows[0].d;
    await db.exec(candidate);
    await db.exec(`INSERT INTO finance_wallet_participants(id,finance_user_id,account_id,display_name,whatsapp_jid) VALUES('${PA}','${W}','${A}','Pessoa A','${JIDA}'),('${PB}','${W}','${B}','Pessoa B','${JIDB}'),('${PC}','${X}','${C}','Pessoa C','${JIDC}'),('${POFF}','${W}','${OFF}','Pessoa inativa','${JIDOFF}')`);
    const serviceQuery = async (sql, params = []) => {
      await db.exec('SET ROLE service_role');
      try { return await db.query(sql, params); }
      finally { await db.exec('RESET ROLE'); }
    };
    const context = async ({ wallet = W, jid = JIDA, txs = [] } = {}) => (await serviceQuery(
      'select finance_whatsapp_payer_context($1::uuid,$2::text,$3::uuid[]) result',
      [wallet, jid, txs === null ? null : `{${txs.join(',')}}`])).rows[0].result;
    const assign = async ({ wallet = W, jid = JIDA, tx = T, event = 'event-new-1', kind = 'participant', payers = [PB], confirmed = true } = {}) => {
      const envelope = (await serviceQuery(
        'select finance_whatsapp_set_payer($1::uuid,$2::text,$3::uuid,$4::text,$5::text,$6::uuid[],$7::boolean) result',
        [wallet, jid, tx, event, kind, payers === null ? null : `{${payers.join(',')}}`, confirmed])).rows[0].result;
      assert.equal(envelope.ok, true);
      assert.deepEqual(Object.keys(envelope).sort(), ['attribution', 'ok']);
      return envelope.attribution;
    };
    const metadataCount = async () => (await db.query('select count(*)::int n from finance_transaction_attributions')).rows[0].n;
    const auditCount = async () => (await db.query('select count(*)::int n from test_audit_events')).rows[0].n;

    await t.test('contexto identifica ator sem expor números dos participantes', async () => {
      const result = await context();
      assert.equal(result.available, true);
      assert.equal(result.actor_account_id, A);
      assert.equal(result.actor_participant_id, PA);
      assert.equal(result.participants.length, 3);
      for (const person of result.participants) assert.deepEqual(Object.keys(person).sort(), ['active', 'display_name', 'id']);
      assert.equal(JSON.stringify(result).includes('@s.whatsapp.net'), false);
      assert.deepEqual(result.attributions, []);
    });
    await t.test('desconhecido não recebe dados do grupo', async () => assert.deepEqual(await context({ jid: '5511000000099@s.whatsapp.net' }), { available: false }));
    await t.test('JID inválido é recusado sem dados', async () => assert.deepEqual(await context({ jid: 'perfil@lid' }), { available: false }));
    await t.test('carteira fora da guarda do bot é recusada', async () => assert.deepEqual(await context({ wallet: X, jid: JIDC }), { available: false }));
    await t.test('conta inativa não produz contexto', async () => assert.deepEqual(await context({ jid: JIDOFF }), { available: false }));
    await t.test('participante inativo não produz contexto', async () => {
      await db.query('update finance_wallet_participants set active=false where id=$1', [PB]);
      assert.deepEqual(await context({ jid: JIDB }), { available: false });
      await db.query('update finance_wallet_participants set active=true where id=$1', [PB]);
    });
    await t.test('membership removido impede contexto e atribuição', async () => {
      await db.query('delete from finance_dashboard_couple_memberships where account_id=$1 and finance_user_id=$2', [B, W]);
      assert.deepEqual(await context({ jid: JIDB }), { available: false });
      await assert.rejects(assign({ jid: JIDB }), /não autorizada/);
      await db.query('insert into finance_dashboard_couple_memberships values($1,$2)', [B, W]);
    });
    await t.test('contexto limita a consulta a 50 IDs', async () => {
      await assert.rejects(context({ txs: Array(51).fill(T) }), /Consulta/);
      await assert.rejects(context({ txs: null }), /Consulta/);
    });
    await t.test('sem confirmação não há metadata ou auditoria', async () => {
      await assert.rejects(assign({ confirmed: false }), /Confirmação/);
      await assert.rejects(assign({ confirmed: null }), /Confirmação/);
      assert.equal(await metadataCount(), 0);
      assert.equal(await auditCount(), 0);
    });
    await t.test('evento precisa corresponder exatamente ao ledger', async () => {
      await assert.rejects(assign({ event: 'event-new-2' }), /evento de origem/);
      await assert.rejects(assign({ event: ' event-new-1' }), /Evento/);
      await assert.rejects(assign({ event: null }), /Evento/);
    });
    await t.test('histórico sem evento não recebe atribuição', async () => {
      await assert.rejects(assign({ tx: LEGACY }), /evento de origem/);
      await assert.rejects(assign({ tx: NOEVENT }), /evento de origem/);
      assert.equal(await metadataCount(), 0);
    });
    await t.test('origem WEB, receita, lixeira e outra carteira são recusadas', async () => {
      for (const [tx, event] of [[OTHER_SOURCE, 'event-web'], [INCOME, 'event-income'], [DELETED, 'event-deleted'], [FOREIGN, 'event-foreign']]) {
        await assert.rejects(assign({ tx, event }), /evento de origem/);
      }
    });
    await t.test('pagador precisa pertencer à mesma carteira', async () => assert.rejects(assign({ payers: [PC] }), /Participante/));
    await t.test('pessoa confirmadora não se torna autor da origem ou pagador', async () => {
      const result = await assign();
      assert.equal(result.attributed_by_account_id, A);
      assert.equal(result.recorded_by_participant_id, null);
      assert.deepEqual(result.participant_ids, [PB]);
      assert.equal(result.request_id, 'event-new-1:payer');
      assert.equal(result.revision, 1);
    });
    await t.test('retry idêntico não duplica auditoria nem revisões', async () => {
      const before = await auditCount();
      const result = await assign();
      assert.equal(result.revision, 1);
      assert.equal(await auditCount(), before);
      assert.equal(await metadataCount(), 1);
    });
    await t.test('replay com outro confirmador não reescreve atribuição', async () => {
      await assert.rejects(assign({ jid: JIDB }), /outro contexto/);
      assert.equal((await context({ txs: [T] })).attributions[0].revision, 1);
    });
    await t.test('retry com pagador diferente é recusado', async () => assert.rejects(assign({ payers: [PA] }), /Chave/));
    await t.test('consulta lê somente IDs e carteira coerentes com o ledger', async () => {
      await db.query(`insert into finance_transaction_attributions(transaction_id,finance_user_id,kind,participant_ids,attributed_by_account_id,request_id,revision) values($1,$2,'participant',ARRAY[$3::uuid],$4,'foreign-attribution',1)`, [FOREIGN, X, PC, C]);
      const result = await context({ txs: [T, FOREIGN, LEGACY] });
      assert.deepEqual(result.attributions.map(row => row.transaction_id), [T]);
      assert.equal(result.attributions[0].kind, 'participant');
      assert.equal(JSON.stringify(result).includes(JIDC), false);
    });
    await t.test('reparenting privilegiado do ledger não vaza metadata antiga', async () => {
      await db.query('update finance_transactions set user_id=$1 where id=$2', [X, T]);
      assert.deepEqual((await context({ txs: [T] })).attributions, []);
      await db.query('update finance_transactions set user_id=$1 where id=$2', [W, T]);
    });
    await t.test('vínculo de número é administrativo, único na carteira e opcional', async () => {
      await assert.rejects(serviceQuery('update finance_wallet_participants set whatsapp_jid=$1 where id=$2', [JIDB, PA]), /permission denied/);
      await assert.rejects(db.query('update finance_wallet_participants set whatsapp_jid=$1 where id=$2', [JIDA, PB]), /unique constraint/);
      await assert.rejects(db.query('update finance_wallet_participants set whatsapp_jid=$1 where id=$2', ['apelido', PB]), /check constraint/);
      await db.query('update finance_wallet_participants set whatsapp_jid=null where id=$1', [PB]);
      assert.deepEqual(await context({ jid: JIDB }), { available: false });
      await db.query('update finance_wallet_participants set whatsapp_jid=$1 where id=$2', [JIDB, PB]);
    });
    await t.test('reaplicar guarda novos registros e não modifica RPC base', async () => {
      await db.exec(candidate);
      assert.equal(await metadataCount(), 2);
      assert.equal((await db.query("select pg_get_functiondef('finance_set_transaction_attribution(uuid,uuid,text,uuid[],uuid,boolean,text,integer)'::regprocedure) d")).rows[0].d, baseDefinition);
      assert.equal(await ledgerHash(), baseline);
    });
    await t.test('novas RPCs são invoker e executáveis somente pelo backend', async () => {
      const signatures = ['finance_whatsapp_payer_context(uuid,text,uuid[])', 'finance_whatsapp_set_payer(uuid,text,uuid,text,text,uuid[],boolean)'];
      for (const signature of signatures) {
        const result = (await db.query("select has_function_privilege('anon',$1,'execute') a,has_function_privilege('authenticated',$1,'execute') u,has_function_privilege('service_role',$1,'execute') s", [signature])).rows[0];
        assert.deepEqual(result, { a: false, u: false, s: true });
        assert.equal((await db.query('select prosecdef from pg_proc where oid=$1::regprocedure', [signature])).rows[0].prosecdef, false);
      }
    });
  } finally { await db.close(); }
});
