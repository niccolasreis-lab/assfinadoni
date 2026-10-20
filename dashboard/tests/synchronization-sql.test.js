import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const files = readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort();
const sql = name => readFileSync(new URL(name,migrations),'utf8');
const suffix = name => files.find(file=>file.endsWith(name));
const group='11111111-1111-4111-8111-111111111111';
const personal='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';
const account='44444444-4444-4444-8444-444444444444';
const foreign='55555555-5555-4555-8555-555555555555';
const inactive='66666666-6666-4666-8666-666666666666';

for (const fresh of [false,true]) test(`sincronização preserva contratos atuais e WhatsApp (${fresh?'instalação nova':'schema legado em produção'})`,async()=>{
  const db=new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync(new URL('../../supabase/bootstrap.sql',import.meta.url),'utf8'));
    for(const name of files.filter(name=>name<'20260924')) {
      // pg_cron is an external Supabase scheduler, not available in embedded Postgres.
      if(name.includes('finance_trash_cron')) continue;
      // gen_random_uuid is built in to PGlite; pgcrypto extension installation is not available.
      await db.exec(sql(name).replace(/^create extension if not exists pgcrypto with schema extensions;\s*/im,''));
    }
    const foundation=files.filter(name=>name.startsWith('20260924'));
    for(const name of foundation) if(fresh || name.includes('assistant_jev')) await db.exec(sql(name));
    for(const name of files.filter(name=>name.includes('_finance_whatsapp_'))) await db.exec(sql(name));
    const value=async(query,params=[]) => (await db.query(query,params)).rows[0]?.value;
    const wa=(fn,action,values={},owner=group)=>value(`select ${fn}($1,$2,$3::jsonb) value`,[action,owner,JSON.stringify(values)]);
    await db.query("insert into finance_users(id,telegram_chat_id,name) values ($1,120363433,'Casal'),($2,111,'Pessoal'),($3,222,'Outra')",[group,personal,other]);
    await db.query("insert into dashboard_accounts(id,username,display_name,password_hash,finance_user_id,active) values ($1,'nicolasreis','Nicolas','fixture',$2,true),($3,'outra','Outra','fixture',$4,true),($5,'inativa','Inativa','fixture',$6,false)",[account,personal,foreign,other,inactive,group]);
    // The third account references a distinct existing wallet; inactive membership is never sufficient.
    await db.query("insert into finance_transactions(user_id,telegram_message_id,transaction_type,amount,category,description,payment_details,transaction_date) values ($1,1,'despesa',186.71,'Viagem','Compras da viagem',$2::jsonb,(now() at time zone 'America/Sao_Paulo')::date)",[group,JSON.stringify({method:'pix'})]);
    await wa('finance_whatsapp_voice','configure',{weekly_enabled:true,important_enabled:false,speed:1.1,muted_until:new Date(Date.now()+3*3600000).toISOString()});
    await wa('finance_whatsapp_insights','weekly',{enabled:true});
    await wa('finance_whatsapp_insights','budget',{category:'Viagem',monthly_limit:500});
    const alert=await wa('finance_whatsapp_alert','create',{description:'Fatura fixture',amount:100,kind:'bill',due_at:new Date(Date.now()+2*86400000).toISOString(),source_message_id:'sync:alert'});
    assert.equal(alert.ok,true);
    const snapshot=()=>value("select jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'amount',amount,'category',category,'description',description,'transaction_date',transaction_date,'payment_details',payment_details,'deleted_at',deleted_at) order by id) value from finance_transactions");
    const waDefinitions=()=>value("select jsonb_object_agg(proname,pg_get_functiondef(p.oid)) value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('finance_whatsapp_alert','finance_whatsapp_voice','finance_whatsapp_insights','finance_whatsapp_spoken_report')");
    const before=await snapshot(); const definitions=await waDefinitions();
    const voiceBefore=await wa('finance_whatsapp_voice','context');
    const insightsBefore=await wa('finance_whatsapp_insights','context');
    const reconciliation=suffix('_finance_sync_preserve_live_contracts.sql'); assert.ok(reconciliation);
    await db.exec(sql(reconciliation));
    assert.deepEqual(await snapshot(),before,'migration must preserve all existing financial fields');
    assert.deepEqual(await waDefinitions(),definitions,'latest WhatsApp function bodies must remain untouched');
    assert.deepEqual(await wa('finance_whatsapp_voice','context'),voiceBefore,'voice preferences must survive');
    assert.deepEqual(await wa('finance_whatsapp_insights','context'),insightsBefore,'weekly schedule and limits must survive');
    await assert.rejects(wa('finance_whatsapp_alert','create',{},personal),/Carteira inválida/);
    assert.equal((await wa('finance_whatsapp_voice','configure',{weekly_enabled:false},personal)).ok,false);
    const report=await wa('finance_whatsapp_insights','report',{period:'current_week'}); assert.equal(report.ok,true); assert.match(report.body,/186,71/);
    const spoken=await wa('finance_whatsapp_spoken_report','claim',{body:report.body,source_message_id:'sync:spoken',explicit_voice:true});
    assert.equal(spoken.ok,true,'explicit weekly voice request still works while automatic voice is muted');
    assert.equal((await wa('finance_whatsapp_spoken_report','check',{voice_id:spoken.voice_id,voice_lease:spoken.voice_lease})).ok,true);
    assert.equal((await wa('finance_whatsapp_spoken_report','claim',{body:report.body,source_message_id:'sync:spoken',explicit_voice:true})).ok,false);
    const existing=before[0];
    const update=await db.query("update finance_transactions set description='Compras confirmadas' where id=$1 and amount=186.71 and description='Compras da viagem' and deleted_at is null returning id",[existing.id]);
    assert.equal(update.rows.length,1,'WhatsApp optimistic update guards remain compatible with additive fields/audit trigger');
    assert.equal(await value("select count(*)::int value from finance_audit_logs where entity_id=$1 and action='UPDATE'",[existing.id]),1);
    const hybrid={method:'misto',cash_amount:30,installments:2,installment_amount:35};
    const made=await value("select finance_dashboard_create_transaction($1,'despesa',100,'Outros','Híbrido fixture',current_date,$2::jsonb) value",[account,JSON.stringify(hybrid)]);
    assert.deepEqual(made.payment_details,hybrid); assert.equal(made.source,'WEB'); assert.ok(made.fingerprint);
    const changed={...hybrid,cash_amount:20,installment_amount:40};
    const edited=await value("select finance_dashboard_update_transaction($1,$2,'despesa',100,'Outros','Híbrido alterado',current_date,$3::jsonb) value",[account,made.id,JSON.stringify(changed)]);
    assert.deepEqual(edited.payment_details,changed);
    assert.equal(await value("select finance_dashboard_update_transaction($1,$2,'despesa',100,'Outros','Ataque',current_date,$3::jsonb) value",[foreign,made.id,JSON.stringify(changed)]),null);
    const enqueue=(aid,key)=>value("select finance_assistant_enqueue($1,$2,'dashboard',$3,'{}'::jsonb) value",[personal,aid,key]);
    await assert.rejects(enqueue(foreign,'foreign'),/Unknown account/);
    await assert.rejects(enqueue(inactive,'inactive'),/Unknown account/);
    const queued=await enqueue(account,'valid'); assert.equal((await enqueue(account,'valid')).id,queued.id);
    const claimed=await value('select finance_assistant_claim() value'); assert.equal(claimed.id,queued.id);
    const finished=await value("select finance_assistant_finish($1,$2,'{\"action\":\"chat\"}'::jsonb,'Tudo certo') value",[claimed.id,claimed.lease_token]); assert.equal(finished.status,'done');
    assert.equal(await value("select count(*)::int value from finance_processing_events where user_id=$1",[personal]),1,'rejected actors must not create processing events');
    const permissions=await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'finance_%' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))");
    assert.equal(permissions.rows.length,0,'every finance RPC must be private to backend service');
    await db.exec(sql(reconciliation));
    assert.deepEqual(edited.payment_details,(await value('select payment_details value from finance_transactions where id=$1',[made.id])),'rerunning reconciliation preserves hybrid payment details');
  } finally {await db.close();}
});
