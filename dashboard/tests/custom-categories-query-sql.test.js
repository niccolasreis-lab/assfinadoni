import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const W = '11111111-1111-4111-8111-111111111111';
const X = '22222222-2222-4222-8222-222222222222';
const missing = '33333333-3333-4333-8333-333333333333';
const migrations = new URL('../../supabase/migrations/', import.meta.url);

test('custom categories and conversational query preserve wallet scope and complete totals', async t => {
  const db = new PGlite();
  try {
    await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
    await db.exec(readFileSync(new URL('../../supabase/bootstrap.sql', import.meta.url), 'utf8'));
    for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) {
      if (name.includes('finance_trash_cron')) continue;
      await db.exec(readFileSync(new URL(name, migrations), 'utf8').replace(/^create extension if not exists pgcrypto with schema extensions;\s*/im, ''));
    }
    await db.query("insert into finance_users(id,telegram_chat_id,name)values($1,100,'QA wallet'),($2,200,'Other wallet')", [W, X]);
    await db.query("insert into finance_categories(finance_user_id,name)values($1,'Only Other Wallet')", [X]);
    await db.query("insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date)select $1,1000+i,'despesa',1.01,'Recorrencia','Internet Vivo '||i,'2026-01-01'::date+(i%28)from generate_series(1,60)i", [W]);
    await db.query("insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date)values($1,1,'receita',1000,'Outros','Salary','2026-01-10'),($1,2,'despesa',0.10,'Legacy Tag','Small A','2026-02-01'),($1,3,'despesa',0.20,'Legacy Tag','Small B','2026-02-02'),($2,4,'despesa',9999,'Only Other Wallet','Private','2026-01-10')", [W, X]);
    await db.query("insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,transaction_date,deleted_at)values($1,5,'despesa',500,'Recorrencia','Deleted','2026-01-10',now())", [W]);
    const ledger = async () => (await db.query('select md5(jsonb_agg(to_jsonb(t) order by id)::text)digest from finance_transactions t')).rows[0].digest;
    const baseline = await ledger();
    const call = async (fn, user, values, action) => {
      await db.exec('set role service_role');
      try {
        return (await db.query(action === undefined ? `select ${fn}($1,$2::jsonb) result` : `select ${fn}($1,$2,$3::jsonb) result`, action === undefined ? [user, JSON.stringify(values)] : [user, action, JSON.stringify(values)])).rows[0].result;
      } finally { await db.exec('reset role'); }
    };
    const categories = (values = {}, action = 'list', user = W) => call('finance_whatsapp_categories', user, values, action);
    const query = (values = {}, user = W) => call('finance_whatsapp_query', user, values);
    const count = async table => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;

    await t.test('catalog includes defaults and legacy labels only from the supplied wallet', async () => {
      const r = await categories();
      assert.equal(r.ok, true);
      assert.ok(r.categories.some(c => c.name === 'Alimentação'));
      assert.ok(r.categories.some(c => c.name === 'Legacy Tag'));
      assert.ok(r.categories.some(c => c.name === 'Recorrencia'));
      assert.equal(r.categories.some(c => c.name === 'Only Other Wallet'), false);
    });
    await t.test('a new category creates only a label and one audit entry', async () => {
      const auditBefore = await count('finance_audit_logs');
      const r = await categories({ name: '  Nova   Recorrência  ' }, 'create');
      assert.equal(r.ok, true);assert.equal(r.created, true);assert.equal(r.category.name, 'Nova Recorrência');assert.ok(r.category.id);
      assert.equal(await count('finance_audit_logs'), auditBefore + 1);
      assert.equal(await ledger(), baseline);
      const audit = (await db.query("select after_value,metadata from finance_audit_logs where entity_id=$1", [r.category.id])).rows[0];
      assert.equal(audit.after_value.name, 'Nova Recorrência');assert.equal(audit.metadata.label_only, true);
    });
    await t.test('case, composed/decomposed accents and repeated creation are idempotent', async () => {
      const first = await categories({ name: 'Nova Recorrência' }, 'create');
      const auditBefore = await count('finance_audit_logs');
      const retry = await categories({ name: 'NOVA RECORRENCIA' }, 'create');
      const decomposed = await categories({ name: 'Nova Recorre\u0302ncia' }, 'create');
      assert.equal(retry.created, false);assert.deepEqual(retry.category, first.category);assert.deepEqual(decomposed.category, first.category);
      assert.equal(await count('finance_audit_logs'), auditBefore);
    });
    await t.test('defaults need no seed and explicit legacy creation registers one canonical label for the dashboard', async () => {
      const before = await count('finance_categories');
      const standard=await categories({name:'ALIMENTACAO'},'create');assert.equal(standard.ok,true);assert.equal(standard.created,false);
      for(const name of ['Recorrência','legacy tag']){
        const first=await categories({name},'create');assert.equal(first.ok,true);assert.equal(first.created,true);assert.ok(first.category.id);
        const retry=await categories({name:name.toUpperCase()},'create');assert.equal(retry.created,false);assert.deepEqual(retry.category,first.category);
      }
      assert.equal(await count('finance_categories'), before+2);
    });
    await t.test('same label in another wallet is independent and never selected', async () => {
      const r = await categories({ name: 'Only Other Wallet' }, 'create');assert.equal(r.created, true);
      const rows = (await db.query("select finance_user_id from finance_categories where name='Only Other Wallet'order by finance_user_id")).rows;
      assert.deepEqual(rows.map(x => x.finance_user_id), [W, X]);
    });
    await t.test('invalid category payloads do not create labels or audit entries', async () => {
      const before = await count('finance_categories');const auditBefore = await count('finance_audit_logs');
      for (const value of [null, [], {name: ''}, {name: 'x'}, {name:'a'.repeat(61)}, {name:'<script>'}, {name:'Valid',wallet_id:X}, {name:42}]) assert.equal((await categories(value, 'create')).ok, false);
      assert.equal((await categories({}, 'delete')).ok, false);assert.equal((await categories({name:'x'},'list')).ok,false);
      assert.equal(await count('finance_categories'), before);assert.equal(await count('finance_audit_logs'), auditBefore);
    });
    await t.test('category ambiguity is rejected rather than guessing an existing variant', async () => {
      const r = await categories({name:'Nova Recorrência'},'create');
      const duplicate = (await db.query("insert into finance_categories(finance_user_id,name)values($1,'Nova Recorrencia')returning id", [W])).rows[0].id;
      try {
        assert.equal((await categories({name:'NOVA RECORRENCIA'},'create')).reason,'ambiguous_category');
        assert.equal((await query({category:'Nova Recorrencia'})).reason,'ambiguous_category');
      } finally {await db.query('delete from finance_categories where id=$1',[duplicate]);}
      assert.ok(r.category.id);
    });
    await t.test('query totals and match count include all 60 rows before a three-row limit', async () => {
      const r = await query({action:'total',category:'RECORRÊNCIA',type:'despesa',limit:3});
      assert.equal(r.ok,true);assert.equal(r.filters.category,'Recorrencia');assert.equal(r.totals.expense,60.60);assert.equal(r.totals.net,-60.60);
      assert.deepEqual(r.coverage,{complete:true,matchedCount:60,shownCount:3,limit:3});assert.equal(r.transactions.length,3);
      assert.ok(r.transactions.every(x=>x.category==='Recorrencia'&&x.description!=='Private'&&x.description!=='Deleted'));
    });
    await t.test('unbounded date filters stay explicitly null and precise cents are preserved', async () => {
      const r=await query();assert.equal(r.filters.date_from,null);assert.equal(r.filters.date_to,null);assert.equal(r.filters.type,null);
      assert.equal(r.coverage.matchedCount,63);assert.equal(r.coverage.shownCount,50);
      assert.deepEqual(r.totals,{income:1000,expense:60.90,net:939.10});
      const cents=await query({date_from:'2026-02-01',date_to:'2026-02-02'});assert.deepEqual(cents.totals,{income:0,expense:0.3,net:-0.3});
    });
    await t.test('search, type and inclusive date ranges are real bound filters', async () => {
      const r=await query({search:'internet vivo',type:'despesa',date_from:'2026-01-01',date_to:'2026-01-28',limit:1});assert.equal(r.coverage.matchedCount,60);assert.equal(r.totals.expense,60.6);
      const literal=await query({search:"%' OR 1=1 --"});assert.equal(literal.coverage.matchedCount,0);
      const income=await query({type:'receita'});assert.equal(income.transactions.length,1);assert.equal(income.totals.income,1000);
    });
    await t.test('breakdown groups the complete matching set by category and type', async () => {
      const r=await query({action:'breakdown',limit:1});assert.equal(r.breakdown.length,3);
      assert.equal(r.breakdown.find(x=>x.category==='Recorrencia'&&x.type==='despesa').total,60.6);
      assert.equal(r.breakdown.reduce((s,x)=>s+x.count,0),63);assert.equal(r.transactions.length,1);
    });
    await t.test('historical accent/case variants group under the canonical registered label', async () => {
      await db.query("update finance_transactions set category='RECORRÊNCIA' where user_id=$1 and telegram_message_id=1001",[W]);
      try {
        const r=await query({action:'breakdown',category:'recorrência'});assert.equal(r.coverage.matchedCount,60);assert.equal(r.breakdown.length,1);assert.equal(r.breakdown[0].category,'Recorrencia');assert.equal(r.breakdown[0].total,60.6);
      } finally {await db.query("update finance_transactions set category='Recorrencia' where user_id=$1 and telegram_message_id=1001",[W]);}
    });
    await t.test('unknown or other-wallet category cannot silently remove a filter', async () => {
      assert.equal((await query({category:'Category that does not exist'})).reason,'unknown_category');
      const other=await query({},X);assert.equal(other.coverage.matchedCount,1);assert.equal(other.totals.expense,9999);assert.equal(other.transactions[0].description,'Private');
      assert.equal((await query({category:'Nova Recorrência'},X)).reason,'unknown_category');
    });
    await t.test('invalid and unsupported filters never fall back to an unfiltered query', async () => {
      for(const f of [null,[],{payer:'Ni'},{sql:'select *'},{action:'delete'},{date_from:'2026-02-31'},{date_to:'tomorrow'},{date_from:'2026-03-01',date_to:'2026-02-01'},{type:'transferencia'},{search:'x'.repeat(121)},{category:[]},{limit:0},{limit:51},{limit:1.5},{limit:'5'}])assert.equal((await query(f)).ok,false,JSON.stringify(f));
      assert.equal((await query({},missing)).reason,'wallet_unavailable');assert.equal((await categories({},'list',missing)).reason,'wallet_unavailable');
    });
    await t.test('RPCs and helpers are invoker-only and cannot be called by public roles', async () => {
      const rows=(await db.query("select p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'execute')anon,has_function_privilege('authenticated',p.oid,'execute')authenticated,has_function_privilege('service_role',p.oid,'execute')service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('finance_category_key','finance_category_valid_name','finance_category_catalog','finance_whatsapp_categories','finance_whatsapp_query')")).rows;
      assert.equal(rows.length,5);for(const r of rows){assert.equal(r.prosecdef,false);assert.equal(r.anon,false);assert.equal(r.authenticated,false);assert.equal(r.service,true);}
      await db.exec('set role anon');try{await assert.rejects(db.query('select finance_whatsapp_query($1,$2::jsonb)',[W,'{}']),/permission denied/);}finally{await db.exec('reset role');}
    });
    await t.test('read queries and category writes never alter transaction content', async () => assert.equal(await ledger(),baseline));
  } finally {await db.close();}
});
