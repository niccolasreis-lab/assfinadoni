import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelQueuedJob,queuedJobStalled,publicJob } from '../lib/assistant.js';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',now=Date.parse('2026-10-28T19:00:00Z');
const waiting={id,status:'queued',attempts:0,created_at:'2026-10-28T18:00:00Z',lease_token:null,lease_until:null};
test('only an old queued job is labelled stalled; public result excludes private fields',()=>{
 assert(queuedJobStalled(waiting,now));assert(!queuedJobStalled({...waiting,status:'processing'},now));assert(!queuedJobStalled({...waiting,created_at:new Date(now).toISOString()},now));assert(!queuedJobStalled({...waiting,created_at:'invalid'},now));
 const result=publicJob({...waiting,payload:{secret:'file'},lease_token:'secret'});assert.equal(result.stalled,true);assert.equal(result.payload,undefined);assert.equal(result.lease_token,undefined);
});
test('cancellation is scoped to owner and untouched queue state; no financial call',async()=>{
 const calls=[];const database=async(path,options)=>{calls.push({path,options});return options?[{...waiting,status:'failed',result:options.body.result}]:[waiting];};
 const result=await cancelQueuedJob(owner,id,{database,now});assert.equal(result.result.cancelled,true);assert.equal(result.result.changed,false);assert.equal(calls.length,2);
 for(const call of calls){assert(call.path.startsWith('finance_assistant_jobs?'));assert.equal(new URLSearchParams(call.path.split('?')[1]).get('user_id'),'eq.'+owner);}
 const query=new URLSearchParams(calls[1].path.split('?')[1]);for(const [key,value]of Object.entries({status:'eq.queued',attempts:'eq.0',lease_token:'is.null',lease_until:'is.null'}))assert.equal(query.get(key),value);
 assert.deepEqual(calls[1].options.body.payload,{});
});
test('worker claim race is rejected instead of reporting a cancellation',async()=>{
 let count=0;await assert.rejects(cancelQueuedJob(owner,id,{now,database:async()=>++count===1?[waiting]:[]}),error=>error.status===409);
});
test('processing, leased, fresh and attempted jobs cannot be cancelled',async()=>{
 for(const patch of [{status:'processing'},{lease_token:owner},{lease_until:'2026-10-28T20:00:00Z'},{attempts:1},{created_at:new Date(now).toISOString()}]){
  let calls=0;await assert.rejects(cancelQueuedJob(owner,id,{now,database:async()=>{calls++;return [{...waiting,...patch}];}}),error=>error.status===409);assert.equal(calls,1);
 }
});
test('missing/foreign jobs return 404 and invalid identifiers never query the database',async()=>{
 await assert.rejects(cancelQueuedJob(owner,id,{database:async()=>[]}),error=>error.status===404);
 await assert.rejects(cancelQueuedJob(owner,'invalid',{database:()=>{throw Error('must not query');}}),error=>error.status===400);
});
test('repeat cancellation is idempotent and does not rewrite a final result',async()=>{
 let count=0;const result=await cancelQueuedJob(owner,id,{database:async()=>{count++;return [{...waiting,status:'failed',result:{cancelled:true,changed:false}}];}});assert.equal(count,1);assert.equal(result.result.cancelled,true);
});
