import assert from 'node:assert/strict';
import test from 'node:test';
import { shiftMonth, createRefreshController } from '../public/workspace.js';

test('navegação mensal atravessa o ano e rejeita meses inválidos', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-02', -1), '2026-01');
  for (const value of ['', '2026-00', '2026-13', 'texto']) assert.equal(shiftMonth(value, 1), null);
  assert.equal(shiftMonth('1900-01', -1), null);
  assert.equal(shiftMonth('2100-12', 1), null);
});

test('atualização automática exige sessão, tela visível e intervalo; manual pode antecipar', async () => {
  let clock = 100000, visible = true, calls = 0;
  const refresh = createRefreshController({ refresh: async () => { calls++; }, canRefresh: () => visible, now: () => clock });
  assert.equal(await refresh.run(true), false);
  refresh.activate(true); refresh.loading(); refresh.loaded();
  clock += 59000; assert.equal(await refresh.run(), false);
  clock += 1000; visible = false; assert.equal(await refresh.run(), false);
  visible = true; assert.equal(await refresh.run(), true); assert.equal(calls, 1);
  assert.equal(await refresh.run(), false);
  assert.equal(await refresh.run(true), true); assert.equal(calls, 2);
  refresh.activate(false); assert.equal(refresh.updated, 0); assert.equal(await refresh.run(true), false);
});

test('consulta em andamento bloqueia repetição e falhas não provocam tentativas a cada tick', async () => {
  let clock = 100000, release, calls = 0;
  const refresh = createRefreshController({ refresh: () => { calls++; return new Promise(resolve => { release = resolve; }); }, canRefresh: () => true, now: () => clock });
  refresh.activate(true);
  const pending = refresh.run(true);
  assert.equal(await refresh.run(true), false); assert.equal(calls, 1);
  release(); await pending; refresh.failed();
  clock += 15000; assert.equal(await refresh.run(), false);
  clock += 45000; const retry = refresh.run(); assert.equal(calls, 2); release(); await retry;
});
