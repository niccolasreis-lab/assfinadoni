import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../supabase/migrations/20261020111206_finance_dashboard_couple_view.sql', import.meta.url), 'utf8');
const personal = '11111111-1111-4111-8111-111111111111';
const group = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const member = '44444444-4444-4444-8444-444444444444';
const outsider = '55555555-5555-4555-8555-555555555555';

test('Casal exige associação explícita, preserva carteira pessoal e filtra lixeira sem somá-la', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table finance_users(id uuid primary key);
      create table dashboard_accounts(id uuid primary key,finance_user_id uuid,active boolean);
      create table finance_transactions(id uuid primary key default gen_random_uuid(),user_id uuid,transaction_type text,amount numeric,category text,description text,transaction_date date,created_at timestamptz default now(),deleted_at timestamptz);
      insert into finance_users values ('${personal}'),('${group}'),('${other}');
      insert into dashboard_accounts values ('${member}','${personal}',true),('${outsider}','${other}',true);
      insert into finance_transactions(user_id,transaction_type,amount,category,description,transaction_date,deleted_at) values
        ('${personal}','despesa',900,'Outros','Privado','2026-10-10',null),
        ('${group}','despesa',40,'Alimentação','Mercado casal','2026-10-10',null),
        ('${group}','receita',100,'Outros','Entrada casal','2026-10-11',null),
        ('${group}','despesa',300,'Outros','Excluído','2026-10-10',now()),
        ('${group}','despesa',500,'Outros','Lixeira expirada','2026-10-10',now()-interval '31 days');`);
    await db.exec(migration);
    const report = async (account,values={}) => (await db.query('select finance_dashboard_couple_transactions($1,$2) value',[account,{month:'2026-10',...values}])).rows[0].value;
    await assert.rejects(report(member), /não autorizado/);
    await db.query('insert into finance_dashboard_couple_memberships(account_id,finance_user_id) values ($1,$2)',[member,group]);
    const initial = await report(member);
    assert.equal(initial.transactions.length,2);
    assert.equal(initial.summary.expense,40); assert.equal(initial.summary.income,100); assert.equal(initial.summary.balance,60);
    assert.ok(initial.transactions.every(row=>row.user_id===group && row.read_only===true));
    assert.equal((await report(member,{q:'Mercado',type:'despesa'})).transactions.length,1);
    assert.equal((await report(member,{q:'Privado'})).transactions.length,0);
    assert.equal((await report(member,{date_from:'2026-10-11',date_to:'2026-10-11'})).transactions.length,1);
    const trash = await report(member,{view:'trash'}); assert.equal(trash.transactions.length,1); assert.equal(trash.summary.expense,40);
    await assert.rejects(report(outsider), /não autorizado/);
    await db.query('update dashboard_accounts set active=false where id=$1',[member]);
    await assert.rejects(report(member), /não autorizado/);
    assert.equal((await db.query('select finance_user_id from dashboard_accounts where id=$1',[member])).rows[0].finance_user_id,personal);
    assert.equal((await db.query('select count(*)::int n from finance_transactions')).rows[0].n,5);
    const acl=(await db.query("select has_function_privilege('anon','finance_dashboard_couple_transactions(uuid,jsonb)','EXECUTE') anon, has_function_privilege('authenticated','finance_dashboard_couple_transactions(uuid,jsonb)','EXECUTE') authenticated, relrowsecurity rls from pg_class where relname='finance_dashboard_couple_memberships'")).rows[0];
    assert.deepEqual(acl,{anon:false,authenticated:false,rls:true});
    await db.query('update dashboard_accounts set active=true where id=$1',[member]);
    await db.query("insert into finance_transactions(user_id,transaction_type,amount,category,description,transaction_date) select $1,'despesa',1,'Outros','Página '||i,'2026-10-12' from generate_series(1,52) i",[group]);
    const page1=await report(member); const page2=await report(member,{page:2});
    assert.equal(page1.transactions.length,50); assert.equal(page1.pagination.hasMore,true);
    assert.equal(page2.transactions.length,4); assert.equal(page2.pagination.hasMore,false);
    assert.equal(new Set([...page1.transactions,...page2.transactions].map(row=>row.id)).size,54);
    assert.equal(page2.summary.expense,92);
  } finally { await db.close(); }
});
