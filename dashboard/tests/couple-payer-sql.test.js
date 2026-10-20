import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const proposals = new URL('../../supabase/proposals/dashboard-couple-payer.sql', import.meta.url);
const migrations = new URL('../../supabase/migrations/', import.meta.url);
const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const W3 = '33333333-3333-4333-8333-333333333333';
const PERSONAL_A = '44444444-4444-4444-8444-444444444444';
const PERSONAL_B = '55555555-5555-4555-8555-555555555555';
const PERSONAL_OFF = '66666666-6666-4666-8666-666666666666';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OFF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const P1 = 'a0000000-0000-4000-8000-000000000001';
const P2 = 'a0000000-0000-4000-8000-000000000002';
const P3 = 'a0000000-0000-4000-8000-000000000003';
const P4 = 'a0000000-0000-4000-8000-000000000004';
const P5 = 'a0000000-0000-4000-8000-000000000005';
const P6 = 'a0000000-0000-4000-8000-000000000006';
const P7 = 'a0000000-0000-4000-8000-000000000007';

test('Casal filtra pagador antes de paginar sem modificar resumo, histórico ou permissões', async (t) => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync(new URL('../../supabase/bootstrap.sql', import.meta.url), 'utf8'));
    for (const name of readdirSync(migrations).filter(file => file.endsWith('.sql')).sort()) {
      if (name.includes('finance_trash_cron')) continue;
      await db.exec(readFileSync(new URL(name, migrations), 'utf8')
        .replace(/^create extension if not exists pgcrypto with schema extensions;\s*/im, ''));
    }
    const oldDefinition = (await db.query("select pg_get_functiondef('finance_dashboard_couple_transactions(uuid,jsonb)'::regprocedure) value")).rows[0].value;
    await db.exec(readFileSync(proposals, 'utf8'));
    await db.query('insert into finance_users(id,telegram_chat_id,name) values($1,120363433,\'Casal um\'),($2,120363434,\'Casal dois\'),($3,120363435,\'Não autorizado\'),($4,1,\'Pessoal A\'),($5,2,\'Pessoal B\'),($6,4,\'Pessoal inativo\')', [W1, W2, W3, PERSONAL_A, PERSONAL_B, PERSONAL_OFF]);
    await db.query("insert into dashboard_accounts(id,username,display_name,password_hash,finance_user_id,active) values($1,'pessoa_a','Pessoa A','fixture',$2,true),($3,'pessoa_b','Pessoa B','fixture',$4,true),($5,'pessoa_c','Pessoa C','fixture',$6,true),($7,'inativo','Inativo','fixture',$8,false)", [A, PERSONAL_A, B, PERSONAL_B, C, W3, OFF, PERSONAL_OFF]);
    await db.query('insert into finance_dashboard_couple_memberships(account_id,finance_user_id) values($1,$2),($1,$3),($4,$2),($5,$2)', [A, W1, W2, B, OFF]);
    await db.query("insert into finance_wallet_participants(id,finance_user_id,account_id,display_name) values($1,$2,$3,'Nome repetido'),($4,$2,$5,'Nome repetido'),($6,$7,null,'Nome repetido'),($8,$9,$10,'Segredo'),($11,$2,null,'Ex participante'),($12,$2,null,'Pessoa +55 (11) 99999-0000'),($13,$2,null,'5511000000007@s.whatsapp.net')", [P1, W1, A, P2, B, P3, W2, P4, W3, C, P5, P6, P7]);
    // All 55 newest rows belong to P2. A filter applied after an old 50-row page would miss P1.
    await db.query("insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date) select $1,1000+i,'despesa',1,'Outros','Pessoa A #'||i,'2026-10-01'::date from generate_series(1,60) i", [W1]);
    await db.query("insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date) select $1,2000+i,'despesa',2,'Alimentação','Pessoa B #'||i,'2026-10-20'::date from generate_series(1,55) i", [W1]);
    for (const [prefix, payer] of [['Pessoa A #', P1], ['Pessoa B #', P2]]) {
      await db.query("insert into finance_transaction_attributions(transaction_id,finance_user_id,kind,participant_ids,attributed_by_account_id,request_id,revision) select id,user_id,'participant',ARRAY[$1::uuid],$2,'fixture:'||id,1 from finance_transactions where description like $3", [payer, A, `${prefix}%`]);
    }
    let sequence = 3000;
    const ids = {};
    const insert = async (name, amount, { wallet = W1, type = 'despesa', payerKind, payerIds = [] } = {}) => {
      const id = (await db.query("insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date) values($1,$2,$3,$4,'Outros',$5,'2026-10-15') returning id", [wallet, ++sequence, type, amount, name])).rows[0].id;
      ids[name] = id;
      if (payerKind) await db.query('insert into finance_transaction_attributions(transaction_id,finance_user_id,kind,participant_ids,attributed_by_account_id,request_id,revision) values($1,$2,$3,$4::uuid[],$5,$6,1)', [id, wallet, payerKind, `{${payerIds.join(',')}}`, wallet === W3 ? C : A, `fixture:${id}`]);
      return id;
    };
    await insert('Conjunto', 7, { payerKind: 'joint', payerIds: [P1, P2] });
    await insert('Legado', 5);
    await insert('Desconhecido explícito', 3, { payerKind: 'unknown' });
    await insert('Outra carteira permitida', 4, { wallet: W2, payerKind: 'participant', payerIds: [P3] });
    await insert('Estranho', 500, { wallet: W3, payerKind: 'participant', payerIds: [P4] });
    await insert('Histórico inativo', 6, { payerKind: 'participant', payerIds: [P5] });
    await db.query('update finance_wallet_participants set active=false where id=$1', [P5]);
    await insert('Nome com telefone', 2, { payerKind: 'participant', payerIds: [P6] });
    await insert('Nome somente JID', 2, { payerKind: 'participant', payerIds: [P7] });
    await insert('Entrada', 100, { type: 'receita' });
    await insert('Lixeira recente', 9, { payerKind: 'participant', payerIds: [P1] });
    await insert('Lixeira legado', 4);
    await insert('Lixeira expirada', 99, { payerKind: 'participant', payerIds: [P1] });
    await db.query("update finance_transactions set deleted_at=now()-interval '1 day' where id=any($1::uuid[])", [`{${ids['Lixeira recente']},${ids['Lixeira legado']}}`]);
    await db.query("update finance_transactions set deleted_at=now()-interval '31 days' where id=$1", [ids['Lixeira expirada']]);
    // Simulate privileged legacy corruption. Safe reads must not expose foreign IDs or count a duplicate as joint.
    await insert('Pagador estrangeiro corrompido', 8);
    await insert('Conjunto duplicado corrompido', 11);
    await insert('Wallet divergente corrompida', 13);
    await db.exec('alter table finance_transaction_attributions disable trigger finance_transaction_attribution_guard');
    for (const [name, wallet, kind, payers] of [
      ['Pagador estrangeiro corrompido', W1, 'participant', [P4]],
      ['Conjunto duplicado corrompido', W1, 'joint', [P1, P1]],
      ['Wallet divergente corrompida', W2, 'participant', [P3]],
    ]) await db.query('insert into finance_transaction_attributions(transaction_id,finance_user_id,kind,participant_ids,attributed_by_account_id,request_id,revision) values($1,$2,$3,$4::uuid[],$5,$6,1)', [ids[name], wallet, kind, `{${payers.join(',')}}`, A, `corrupt:${ids[name]}`]);
    await db.exec('alter table finance_transaction_attributions enable trigger finance_transaction_attribution_guard');
    const ledgerHash = async () => (await db.query('select md5(jsonb_agg(to_jsonb(t) order by id)::text) value from finance_transactions t')).rows[0].value;
    const metadataHash = async () => (await db.query('select md5(jsonb_agg(to_jsonb(t) order by transaction_id)::text) value from finance_transaction_attributions t')).rows[0].value;
    const baseline = { ledger: await ledgerHash(), metadata: await metadataHash() };
    const query = async (values = {}, { account = A, legacy = false } = {}) => {
      await db.exec('set role service_role');
      try {
        const name = legacy ? 'finance_dashboard_couple_transactions' : 'finance_dashboard_couple_payer_transactions';
        return (await db.query(`select ${name}($1,$2::jsonb) value`, [account, JSON.stringify({ month: '2026-10', ...values })])).rows[0].value;
      } finally { await db.exec('reset role'); }
    };
    const original = await query({}, { legacy: true });

    await t.test('contrato antigo e resumo mensal permanecem iguais', async () => {
      const result = await query();
      assert.deepEqual(result.summary, original.summary);
      assert.equal(result.summary.expense, 231);
      assert.equal(result.summary.income, 100);
      assert.deepEqual(result.pagination, original.pagination);
      assert.equal(result.scope, 'couple');
      assert.equal(result.readOnly, true);
      assert.deepEqual(result.transactions.map(row => row.id), original.transactions.map(row => row.id));
      assert.equal(result.transactions.every(row => row.read_only === true), true);
      for (let index = 0; index < result.transactions.length; index++) {
        const { payer, ...oldFields } = result.transactions[index];
        assert.equal(typeof payer.kind, 'string');
        assert.deepEqual(oldFields, original.transactions[index]);
      }
    });
    await t.test('filtro de pessoa ocorre antes da paginação e preserva ordenação', async () => {
      const first = await query({ payer_kind: 'participant', payer_id: P1 });
      const second = await query({ payer_kind: 'participant', payer_id: P1, page: 2 });
      assert.equal(first.transactions.length, 50);
      assert.equal(second.transactions.length, 10);
      assert.equal(first.pagination.hasMore, true);
      assert.equal(second.pagination.hasMore, false);
      const rows = [...first.transactions, ...second.transactions];
      assert.equal(new Set(rows.map(row => row.id)).size, 60);
      assert.equal(rows.every(row => row.description.startsWith('Pessoa A #')), true);
      assert.equal(rows.every(row => row.payer.kind === 'participant' && row.payer.participant_ids[0] === P1), true);
    });
    await t.test('nomes iguais não combinam pessoas ou carteiras', async () => {
      const p2 = await query({ payer_kind: 'participant', payer_id: P2, page: 2 });
      assert.equal(p2.transactions.length, 5);
      assert.equal(p2.transactions.every(row => row.description.startsWith('Pessoa B #')), true);
      const p3 = await query({ payer_kind: 'participant', payer_id: P3 });
      assert.equal(p3.transactions.length, 1);
      assert.equal(p3.transactions[0].user_id, W2);
      assert.equal(p3.transactions[0].payer.labels[0], 'Nome repetido');
    });
    await t.test('participant sem ID consulta todos individuais', async () => {
      const result = await query({ payer_kind: 'participant', page: 3 });
      assert.equal(result.transactions.length, 19);
      assert.equal(result.pagination.hasMore, false);
      assert.equal(result.transactions.every(row => row.payer.kind === 'participant'), true);
    });
    await t.test('unknown inclui legado e metadata inválida sem expor pessoas externas', async () => {
      const result = await query({ payer_kind: 'unknown' });
      assert.equal(result.transactions.length, 5);
      for (const row of result.transactions) assert.deepEqual(row.payer, { kind: 'unknown', participant_ids: [], labels: [] });
      assert.equal(result.transactions.some(row => row.transaction_type === 'receita'), false);
      assert.equal(JSON.stringify(result).includes(P4), false);
    });
    await t.test('joint contém somente conjunto válido e não duplica nomes', async () => {
      const result = await query({ payer_kind: 'joint' });
      assert.equal(result.transactions.length, 1);
      assert.equal(result.transactions[0].description, 'Conjunto');
      assert.deepEqual(result.transactions[0].payer.participant_ids, [P1, P2]);
      assert.deepEqual(result.transactions[0].payer.labels, ['Nome repetido', 'Nome repetido']);
    });
    await t.test('qualquer filtro de pagador conserva resumo mensal integral', async () => {
      for (const filter of [{ payer_kind: 'unknown' }, { payer_kind: 'joint' }, { payer_kind: 'participant', payer_id: P1 }]) {
        assert.deepEqual((await query(filter)).summary, original.summary);
      }
    });
    await t.test('filtros anteriores continuam server-side e não alteram resumo', async () => {
      assert.equal((await query({ payer_kind: 'participant', payer_id: P1, q: 'Pessoa A #6' })).transactions.length, 2);
      assert.equal((await query({ payer_kind: 'participant', payer_id: P1, category: 'Alimentação' })).transactions.length, 0);
      assert.equal((await query({ payer_kind: 'participant', payer_id: P1, date_from: '2026-10-10' })).transactions.length, 0);
      assert.equal((await query({ payer_kind: 'participant', type: 'receita' })).transactions.length, 0);
      assert.deepEqual((await query({ q: 'nada corresponde' })).summary, original.summary);
    });
    await t.test('receita preservada em all tem pagador não aplicável para a UI', async () => {
      const result = await query({ type: 'receita' });
      assert.equal(result.transactions.length, 1);
      assert.deepEqual(result.transactions[0].payer, { kind: 'unknown', participant_ids: [], labels: [] });
    });
    await t.test('lixeira conserva atribuições e exclui registros expirados', async () => {
      const person = await query({ view: 'trash', payer_kind: 'participant', payer_id: P1 });
      assert.equal(person.transactions.length, 1);
      assert.equal(person.transactions[0].description, 'Lixeira recente');
      const unknown = await query({ view: 'trash', payer_kind: 'unknown' });
      assert.equal(unknown.transactions.length, 1);
      assert.equal(unknown.transactions[0].description, 'Lixeira legado');
      assert.deepEqual(person.summary, original.summary);
    });
    await t.test('participante inativo mantém rótulo e pode filtrar histórico', async () => {
      const result = await query({ payer_kind: 'participant', payer_id: P5 });
      assert.equal(result.transactions.length, 1);
      assert.equal(result.transactions[0].payer.labels[0], 'Ex participante');
      assert.equal(result.payer_participants.find(person => person.id === P5).active, false);
    });
    await t.test('roster autorizado preserva homônimos e não retorna contatos', async () => {
      const result = await query();
      assert.equal(result.payer_participants.length, 6);
      assert.equal(result.payer_participants.filter(person => person.display_name === 'Nome repetido').length, 3);
      assert.equal(result.payer_participants.some(person => person.id === P4 || person.finance_user_id === W3), false);
      assert.equal(result.payer_participants.find(person => person.id === P6).display_name, 'Pessoa');
      assert.equal(result.payer_participants.find(person => person.id === P7).display_name, 'Participante');
      for (const person of result.payer_participants) assert.deepEqual(Object.keys(person).sort(), ['active', 'display_name', 'finance_user_id', 'id']);
      const phone = await query({ payer_kind: 'participant', payer_id: P6 });
      assert.deepEqual(phone.transactions[0].payer.labels, ['Pessoa']);
      assert.equal(JSON.stringify(result).includes('99999-0000'), false);
      assert.equal(JSON.stringify(result).includes('@s.whatsapp.net'), false);
    });
    await t.test('ID UUID válido fora das carteiras permitidas falha fechado', async () => {
      await assert.rejects(query({ payer_kind: 'participant', payer_id: P4 }), { code: '42501' });
      await assert.rejects(query({ payer_kind: 'participant', payer_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }), { code: '42501' });
    });
    await t.test('mesmo pagador deixa de ser autorizado para conta de outra seleção de carteiras', async () => {
      await assert.rejects(query({ payer_kind: 'participant', payer_id: P3 }, { account: B }), /Pagador não autorizado/);
      const result = await query({}, { account: B });
      assert.equal(result.payer_participants.some(person => person.finance_user_id === W2), false);
    });
    await t.test('conta inativa ou sem vínculo não consulta dados', async () => {
      await assert.rejects(query({}, { account: OFF }), /não autorizado/);
      await assert.rejects(query({}, { account: C }), /não autorizado/);
    });
    await t.test('combinações e UUIDs inválidos são recusados', async () => {
      await assert.rejects(query({ payer_kind: 'foreign' }), { code: '22023' });
      await assert.rejects(query({ payer_kind: 'unknown', payer_id: P1 }), { code: '22023' });
      await assert.rejects(query({ payer_kind: 'participant', payer_id: 'Pessoa A' }), { code: '22023' });
      await assert.rejects(query({ payer_kind: 'participant', page: 0 }), /Filtros inválidos/);
    });
    await t.test('reaplicação não modifica ledger, metadata ou RPC antiga', async () => {
      await db.exec(readFileSync(proposals, 'utf8'));
      assert.deepEqual({ ledger: await ledgerHash(), metadata: await metadataHash() }, baseline);
      assert.equal((await db.query("select pg_get_functiondef('finance_dashboard_couple_transactions(uuid,jsonb)'::regprocedure) value")).rows[0].value, oldDefinition);
    });
    await t.test('somente backend executa nova RPC e SECURITY INVOKER permanece', async () => {
      const result = (await db.query("select has_function_privilege('anon','finance_dashboard_couple_payer_transactions(uuid,jsonb)','execute') anon,has_function_privilege('authenticated','finance_dashboard_couple_payer_transactions(uuid,jsonb)','execute') authenticated,has_function_privilege('service_role','finance_dashboard_couple_payer_transactions(uuid,jsonb)','execute') service")).rows[0];
      assert.deepEqual(result, { anon: false, authenticated: false, service: true });
      assert.equal((await db.query("select prosecdef from pg_proc where oid='finance_dashboard_couple_payer_transactions(uuid,jsonb)'::regprocedure")).rows[0].prosecdef, false);
    });
  } finally { await db.close(); }
});
