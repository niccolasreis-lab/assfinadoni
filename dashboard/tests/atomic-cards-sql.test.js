import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration=readFileSync(new URL('../../supabase/migrations/20261026192356_finance_atomic_events_and_card_binding.sql',import.meta.url),'utf8');
const domain=readFileSync(new URL('../../supabase/migrations/20260924130000_finance_domain_foundation.sql',import.meta.url),'utf8');
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',aid='33333333-3333-4333-8333-333333333333';
const tx={amount:42.5,transaction_type:'despesa',description:'Compra fixture',category:'Lazer',transaction_date:'2026-10-26',payment_details:{method:'cartao',installments:1,card_name:'Nubank'}};
test('eventos atômicos, cartões por carteira e isolamento do dashboard',async t=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table finance_users(id uuid primary key);
   create table dashboard_accounts(id uuid primary key,finance_user_id uuid,active boolean);
   create table finance_dashboard_couple_memberships(account_id uuid,finance_user_id uuid);
   create table finance_transactions(id uuid primary key default gen_random_uuid(),user_id uuid references finance_users(id),telegram_message_id bigint,external_event_id text,idempotency_key text,transaction_type text,amount numeric,description text,category text,transaction_date date,payment_details jsonb,source text,deleted_at timestamptz,unique(user_id,telegram_message_id));
   insert into finance_users values('${uid}'),('${other}');insert into dashboard_accounts values('${aid}','${other}',true);
   insert into finance_dashboard_couple_memberships values('${aid}','${uid}');`);
  await db.exec(domain.slice(domain.indexOf('create table if not exists public.finance_credit_cards ('),domain.indexOf('create table if not exists public.finance_card_statements (')));
  await db.exec(migration);
  const value=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.v;
  const record=(event,key,values=tx,confirmed=true,user=uid)=>value('select finance_whatsapp_record_transaction($1,$2,$3,$4::jsonb,$5) v',[user,event,key,JSON.stringify(values),confirmed]);
  let first;
  await t.test('sem confirmação não grava nem cadastra cartão',async()=>{await assert.rejects(record('wa:test:0',1,tx,false));assert.equal(await value('select count(*)::int v from finance_credit_cards'),0);});
  await t.test('primeira gravação vincula cartão sem inventar limite ou vencimento',async()=>{first=await record('wa:test:0',1);assert.equal(first._idempotent_replay,false);assert(first.payment_details.credit_card_id);assert.equal(first.payment_details.card_name,'Nubank');assert.equal(await value('select limit_amount v from finance_credit_cards limit 1'),null);});
  await t.test('repetição com outro hash retorna mesmo lançamento',async()=>{const again=await record('wa:test:0',2);assert.equal(again.id,first.id);assert.equal(again._idempotent_replay,true);assert.equal(await value('select count(*)::int v from finance_transactions'),1);});
  await t.test('mesmo evento com valor ou cartão diferente é recusado',async()=>{await assert.rejects(record('wa:test:0',2,{...tx,amount:50}));await assert.rejects(record('wa:test:0',2,{...tx,payment_details:{method:'cartao',card_name:'Outro'}}));assert.equal(await value('select count(*)::int v from finance_credit_cards'),1);});
  await t.test('compras distintas do mesmo valor são preservadas',async()=>{const row=await record('wa:test:1',3);assert.notEqual(row.id,first.id);assert.equal(row.payment_details.credit_card_id,first.payment_details.credit_card_id);});
  await t.test('índice protege também inserção direta com chave numérica diferente',async()=>{await assert.rejects(db.query("insert into finance_transactions(user_id,telegram_message_id,external_event_id) values($1,999,'wa:test:0')",[uid]));});
  await t.test('carteira alheia não pode usar o cartão existente',async()=>{await assert.rejects(record('wa:other:0',4,{...tx,payment_details:{method:'cartao',credit_card_id:first.payment_details.credit_card_id}},true,other));});
  await t.test('dashboard só lista cartões de carteiras autorizadas',async()=>{assert.equal((await value("select finance_dashboard_card_list($1,'mine') v",[aid])).length,0);const cards=await value("select finance_dashboard_card_list($1,'all') v",[aid]);assert.equal(cards.length,1);assert.equal(cards[0].wallet_scope,'couple');await assert.rejects(value("select finance_dashboard_card_list(gen_random_uuid(),'all') v"));});
  await t.test('cliente antigo não perde cartão ao editar outro campo',async()=>{await db.query("update finance_transactions set payment_details='{"+'"method":"cartao","installments":1'+"}'::jsonb where id=$1",[first.id]);assert.equal(await value("select payment_details->>'card_name' v from finance_transactions where id=$1",[first.id]),'Nubank');});
  await t.test('nome vazio explícito e troca para Pix removem vínculo',async()=>{await db.query("update finance_transactions set payment_details='{"+'"method":"cartao","card_name":null'+"}'::jsonb where id=$1",[first.id]);assert.equal(await value("select payment_details ? 'credit_card_id' v from finance_transactions where id=$1",[first.id]),false);await db.query("update finance_transactions set payment_details=$2::jsonb where id=$1",[first.id,JSON.stringify(tx.payment_details)]);await db.query("update finance_transactions set payment_details='{"+'"method":"pix"'+"}'::jsonb where id=$1",[first.id]);assert.equal(await value("select payment_details ? 'card_name' v from finance_transactions where id=$1",[first.id]),false);});
  await t.test('nome não aceita número completo de cartão',async()=>{await assert.rejects(record('wa:pan:0',5,{...tx,payment_details:{method:'cartao',card_name:'4111 1111 1111 1111'}}));});
  await t.test('eventos removidos permanentemente não ressuscitam',async()=>{await db.query('delete from finance_transactions where id=$1',[first.id]);await assert.rejects(record('wa:test:0',42));await assert.rejects(db.query("insert into finance_transactions(user_id,telegram_message_id,external_event_id) values($1,1000,'wa:test:0')",[uid]));});
  await t.test('funções financeiras não ficam executáveis publicamente',async()=>{assert.equal(await value("select has_function_privilege('anon','finance_whatsapp_record_transaction(uuid,text,bigint,jsonb,boolean)','execute') v"),false);assert.equal(await value("select has_function_privilege('authenticated','finance_dashboard_card_list(uuid,text)','execute') v"),false);});
 } finally {await db.close();}
});
