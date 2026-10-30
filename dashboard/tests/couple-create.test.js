import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import handler from '../api/transactions.js';
import {setSession} from '../lib/server.js';
const migration=readFileSync(new URL('../../supabase/migrations/20261030155831_finance_dashboard_couple_create.sql',import.meta.url),'utf8');
const aid='11111111-1111-4111-8111-111111111111', bid='22222222-2222-4222-8222-222222222222', uid='33333333-3333-4333-8333-333333333333', personal='44444444-4444-4444-8444-444444444444', rid='55555555-5555-4555-8555-555555555555';
const values={transaction_type:'despesa',amount:'18.50',category:'Alimentação',description:'Padaria',transaction_date:'2026-01-01',payment_details:{method:'nao_informado',cash_amount:'0.00',installments:0}};
test('criação na carteira do casal valida vínculo, conta ativa e repetição atômica',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table dashboard_accounts(id uuid primary key,finance_user_id uuid,active boolean);
 create table finance_dashboard_couple_memberships(account_id uuid,finance_user_id uuid);
 create table finance_transactions(id uuid primary key,user_id uuid,telegram_message_id bigint,transaction_type text,amount numeric,category text,description text,transaction_date date,payment_details jsonb,updated_by_account_id uuid,source text,fingerprint text,deleted_at timestamptz);
 create function finance_transaction_fingerprint(uuid,text,numeric,date,text,text,text) returns text language sql as $$select 'fingerprint'::text$$;
 insert into dashboard_accounts values('${aid}','${personal}',true),('${bid}','${personal}',true);
 insert into finance_dashboard_couple_memberships values('${aid}','${uid}'),('${bid}','${uid}');`);
 await db.exec(migration);
 const create=async(account,request,v=values)=>(await db.query('select finance_dashboard_couple_create_transaction($1,$2,$3::jsonb) v',[account,request,JSON.stringify(v)])).rows[0].v;
 const first=await create(aid,rid);assert.equal(first.user_id,uid);assert.equal(first.updated_by_account_id,aid);assert.equal(first.source,'WEB');
 assert.equal((await create(aid,rid)).id,first.id);
 await assert.rejects(create(aid,rid,{...values,amount:'19.50'}));await assert.rejects(create(bid,rid));
 assert.equal((await create(bid,'66666666-6666-4666-8666-666666666666')).user_id,uid);
 assert.equal((await db.query('select count(*)::int n from finance_transactions')).rows[0].n,2);
 await db.exec(`delete from finance_dashboard_couple_memberships where account_id='${bid}'`);
 await assert.rejects(create(bid,'77777777-7777-4777-8777-777777777777'));
 await db.exec(`insert into finance_dashboard_couple_memberships values('${aid}','${personal}')`);
 await assert.rejects(create(aid,'88888888-8888-4888-8888-888888888888'));
 await db.exec(`delete from finance_dashboard_couple_memberships where finance_user_id='${personal}';update dashboard_accounts set active=false where id='${aid}'`);
 await assert.rejects(create(aid,'88888888-8888-4888-8888-888888888888'));
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_function_privilege('${role}','finance_dashboard_couple_create_transaction(uuid,uuid,jsonb)','execute') v`)).rows[0].v,false);
 }finally{await db.close()}
});
process.env.SESSION_SECRET='couple-create-test-secret-at-least-thirty-two-characters';process.env.SUPABASE_URL='https://test.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
let cookie;const account={id:aid,finance_user_id:personal,active:true,session_version:1};setSession({setHeader(_n,v){cookie=v.split(';')[0]}},account);
const headers={cookie,host:'dashboard.example.com',origin:'https://dashboard.example.com','content-type':'application/json'};
const response=()=>({setHeader(){},status(c){this.statusCode=c;return this},json(b){this.body=b}});
test('API usa a sessão e nunca aceita dono ou carteira fornecidos pelo navegador',async()=>{
 const previous=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,o)=>{const path=new URL(url).pathname;calls.push({path,body:o.body?JSON.parse(o.body):null});return{ok:true,status:200,json:async()=>path.endsWith('dashboard_accounts')?[account]:{id:rid,user_id:uid}}};
 try{
 const req={method:'POST',headers,body:{...values,payment_method:'nao_informado',scope:'couple',request_id:rid,account_id:bid,user_id:personal}};
 const res=response();await handler(req,res);assert.equal(res.statusCode,201);
 assert.match(calls.at(-1).path,/finance_dashboard_couple_create_transaction$/);assert.equal(calls.at(-1).body.p_account_id,aid);assert.equal(calls.at(-1).body.p_request_id,rid);assert.equal(calls.at(-1).body.p_values.user_id,undefined);
 const invalid=response();await handler({...req,body:{...req.body,request_id:'bad'}},invalid);assert.equal(invalid.statusCode,400);
 const origin=response();await handler({...req,headers:{...headers,origin:'https://elsewhere.example.com'}},origin);assert.equal(origin.statusCode,403);
 }finally{globalThis.fetch=previous}
});
