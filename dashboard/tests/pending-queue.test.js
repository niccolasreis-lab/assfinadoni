import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const sql=readFileSync(new URL('../../supabase/migrations/20261030162026_finance_pending_queue.sql',import.meta.url),'utf8');
const user='11111111-1111-4111-8111-111111111111';
const tx=amount=>({amount,transaction_type:'despesa',category:'Alimentação',description:'Teste',transaction_date:'2026-10-30'});
test('fila durável isola pessoas, acumula propostas e conclui somente as fontes confirmadas',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create table finance_users(id uuid primary key);insert into finance_users values('${user}');`);await db.exec(sql);
 const action=async(sender,act,payload={})=>(await db.query('select finance_pending_queue_action($1,$2,$3,$4,$5::jsonb) r',[user,'group',sender,act,JSON.stringify(payload)])).rows[0].r;
 const put=(sender,id,amount)=>action(sender,'put',{source_message_id:id,transactions:[tx(amount)],attachment:{fileName:id+'.jpg'}});
 await put('a','first',95.86);await put('a','second',58.06);await put('a','third',76.50);
 let loaded=await action('a','load');assert.equal(loaded.pending_count,3);assert.equal(loaded.receipts.length,3);
 await put('b','other',12);assert.equal((await action('a','load')).pending_count,3);assert.equal((await action('b','load')).pending_count,1);
 await put('a','first',95.86);assert.equal((await action('a','load')).pending_count,3);
 const earlier=loaded.receipts[0];await action('a','claim',{confirmation_id:'confirm-old',receipts:[earlier]});
 await put('a','fourth',9);await action('a','ack',{confirmation_id:'confirm-old',receipts:[{source_message_id:earlier.source_message_id,complete:true}]});
 loaded=await action('a','load');assert.equal(loaded.pending_count,3);assert(loaded.receipts.some(r=>r.source_message_id==='fourth'));
 await assert.rejects(action('a','claim',{confirmation_id:'stale',receipts:[earlier]}));
 await assert.rejects(action('b','claim',{confirmation_id:'cross-sender',receipts:[loaded.receipts[0]]}));
 const old=loaded.receipts[0];await action('a','adjust',{receipts:[{...old,transactions:[{...old.transactions[0],category:'Outros'}]}]});
 await assert.rejects(action('a','claim',{confirmation_id:'old-version',receipts:[old]}));
 const fresh=(await action('a','load')).receipts[0];await assert.rejects(action('a','claim',{confirmation_id:'missing-version',receipts:[{...fresh,version:null}]}));
 await action('a','claim',{confirmation_id:'current',receipts:[fresh]});await assert.rejects(action('a','claim',{confirmation_id:'parallel',receipts:[fresh]}));
 await action('a','ack',{confirmation_id:'wrong',receipts:[{source_message_id:fresh.source_message_id,complete:true}]});
 assert.equal((await action('a','load')).pending_count,2);
 await action('a','ack',{confirmation_id:'current',receipts:[{source_message_id:fresh.source_message_id,complete:false}]});assert.equal((await action('a','load')).pending_count,3);
 for(const r of (await action('a','load')).receipts)await action('a','cancel',{receipts:[r]});assert.equal((await action('a','load')).pending_count,0);assert.equal((await action('b','load')).pending_count,1);
 for(let i=0;i<10;i++)await put('c','receipt_'+i,1);await assert.rejects(put('c','overflow',1));assert.equal((await action('c','load')).pending_count,10);
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_function_privilege('${role}','finance_pending_queue_action(uuid,text,text,text,jsonb)','execute') v`)).rows[0].v,false);
 }finally{await db.close()}
});
