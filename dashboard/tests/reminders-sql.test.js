import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Optional real PostgreSQL engine; install PGlite outside the project and provide its module path.
const engine=process.env.FINANCE_SQL_TEST_MODULE;
test('SQL real: isolamento, conclusão idempotente, offsets, leases, retry e cancelamento',{skip:!engine},async()=>{
 const {PGlite}=await import(engine);const db=new PGlite();
 try{
  await db.exec(`create role anon; create role authenticated; create role service_role;
   create table finance_users(id uuid primary key,telegram_chat_id bigint);
   create table dashboard_accounts(id uuid primary key,finance_user_id uuid references finance_users,active boolean,created_at timestamptz default now());
   create table finance_transactions(id uuid primary key default gen_random_uuid(),user_id uuid,telegram_message_id bigint,transaction_type text,amount numeric,category text,description text,transaction_date date,updated_by_account_id uuid);
   insert into finance_users values('11111111-1111-4111-8111-111111111111',123),('22222222-2222-4222-8222-222222222222',456);
   insert into dashboard_accounts(id,finance_user_id,active) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',true),('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',true);`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20260918092754_finance_reminders.sql',import.meta.url),'utf8'));
  const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333';
  const scalar=async(sql,params=[]) => (await db.query(sql,params)).rows[0].value;
  const create=values=>scalar('select finance_reminder_create($1,$2::jsonb) value',[user,JSON.stringify(values)]);
  const bill=await create({kind:'bill',description:'Test bill',due_date:'2030-01-04',amount:12.50,category:'Outros',external_key:'same-event'});
  assert.equal((await create({kind:'bill',description:'Ignored duplicate',due_date:'2030-01-04',external_key:'same-event'})).id,bill.id);
  assert.equal(await scalar("select finance_reminder_action($1,$2,'cancel') value",[other,bill.id]),null);
  await assert.rejects(scalar("select finance_reminder_action($1,$2,'complete',$3::jsonb,$4) value",[user,bill.id,JSON.stringify({transaction_date:'2999-01-01'}),account]));
  let first=await scalar("select finance_notification_claim('2030-01-01 11:59:00+00') value");assert.equal(first.length,0);
  first=await scalar("select finance_notification_claim('2030-01-01 12:00:00+00') value");assert.equal(first.length,1);assert.equal(first[0].occurrence,'due:2030-01-04:3');
  assert.equal((await scalar("select finance_notification_claim('2030-01-01 12:01:00+00') value")).length,0);
  const retry=await scalar("select finance_notification_claim('2030-01-01 12:06:00+00') value");assert.equal(retry.length,1);assert.notEqual(retry[0].lease_token,first[0].lease_token);
  assert.equal(await scalar('select finance_notification_ack($1,$2,true) value',[first[0].id,first[0].lease_token]),false);
  assert.equal(await scalar('select finance_notification_ack($1,$2,true) value',[retry[0].id,retry[0].lease_token]),true);
  const completions=await Promise.all([1,2].map(()=>scalar("select finance_reminder_action($1,$2,'complete',$3::jsonb,$4) value",[user,bill.id,JSON.stringify({transaction_date:'2020-01-01'}),account])));
  assert.equal(completions[0].completed_transaction_id,completions[1].completed_transaction_id);
  assert.equal(await scalar('select count(*)::integer value from finance_transactions'),1);
  assert.equal((await scalar("select finance_notification_claim('2030-01-04 12:00:00+00') value")).length,0);
  const late=await create({kind:'bill',description:'Overdue',due_date:'2030-01-01'});
  let overdue=await scalar("select finance_notification_claim('2030-01-10 12:00:00+00') value");assert.equal(overdue.length,1);assert.equal(overdue[0].occurrence,'overdue');
  await scalar('select finance_notification_ack($1,$2,true) value',[overdue[0].id,overdue[0].lease_token]);
  assert.equal((await scalar("select finance_notification_claim('2030-01-11 12:00:00+00') value")).length,0);
  await scalar("select finance_reminder_action($1,$2,'cancel') value",[user,late.id]);
  const review=await create({kind:'review',description:'Review'});
  await db.query("update finance_reminders set created_at='2030-01-01 12:00:00+00' where id=$1",[review.id]);
  for(let day=1;day<=3;day++){
   const claimed=await scalar(`select finance_notification_claim('2030-01-0${day} 12:00:00+00') value`);assert.equal(claimed.length,1);assert.equal(claimed[0].occurrence,`review:${day-1}`);
   await scalar('select finance_notification_ack($1,$2,true) value',[claimed[0].id,claimed[0].lease_token]);
  }
  assert.equal((await scalar("select finance_notification_claim('2030-01-10 12:00:00+00') value")).length,0);
  const failing=await create({kind:'bill',description:'Retry bounded',due_date:'2030-01-05'});
  for(const minute of ['00','06','12']){
   const attempt=await scalar(`select finance_notification_claim('2030-01-05 12:${minute}:00+00') value`);
   assert.equal(attempt.filter(item=>item.reminder_id===failing.id).length,1);
  }
  assert.equal((await scalar("select finance_notification_claim('2030-01-05 12:18:00+00') value")).length,0);
  assert.equal(await scalar("select status value from finance_notification_deliveries where reminder_id=$1",[failing.id]),'failed');
  assert.equal(await scalar('select finance_push_subscribe($1,$2,$3,$4) value',[account,'https://fcm.googleapis.com/test','public','auth']),true);
  assert.equal(Boolean(await scalar('select finance_push_subscribe($1,$2,$3,$4) value',['44444444-4444-4444-8444-444444444444','https://fcm.googleapis.com/test','other','other'])),false);
  assert.equal(await scalar("select count(*)::integer value from finance_push_subscriptions where account_id=$1",[account]),1);
  await db.exec(readFileSync(new URL('./reminders-smoke.sql',import.meta.url),'utf8'));
  assert.equal(await scalar('select count(*)::integer value from finance_transactions'),1,'smoke não deve persistir lançamentos');
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from finance_notification_config'));
  await assert.rejects(db.query("select finance_notification_claim()"));
  await db.exec('reset role');
 }finally{await db.close();}
});
