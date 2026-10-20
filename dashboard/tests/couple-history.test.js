import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryLoader } from '../public/charts.js';

test('histórico separa cache e resultados de Casal e Minhas para a mesma conta', async () => {
  const calls=[];
  const summary=amount=>({income:0,expense:amount,balance:-amount,byCategory:{Outros:amount}});
  const history=createHistoryLoader(async(month,_shared,scope)=>{calls.push({month,scope});return summary(scope==='couple'?40:900);});
  const personal=await history.load({month:'2026-10',account:'nicolas',shared:false,scope:'mine',summary:summary(900)});
  const together=await history.load({month:'2026-10',account:'nicolas',shared:false,scope:'couple',summary:summary(40)});
  assert.ok(personal.every(point=>point.summary.expense===900));
  assert.ok(together.every(point=>point.summary.expense===40));
  assert.equal(calls.filter(call=>call.scope==='mine').length,5);
  assert.equal(calls.filter(call=>call.scope==='couple').length,5);
  await history.load({month:'2026-10',account:'nicolas',shared:false,scope:'mine',summary:summary(900)});
  assert.equal(calls.length,10);
});
