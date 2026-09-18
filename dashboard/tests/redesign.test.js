import assert from 'node:assert/strict';
import test from 'node:test';
import { monthsEndingAt, validSummary, comparison, historyMarkup, categoryMarkup, createHistoryLoader } from '../public/charts.js';

const summary = (balance = 80) => ({ income: 100, expense: 20, balance, byCategory: { Casa: 20 } });
const request = (overrides = {}) => ({ month: '2026-09', shared: false, account: 'nicolas', summary: summary(), ...overrides });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('histórico contém seis meses em ordem e atravessa o ano', () => {
  assert.deepEqual(monthsEndingAt('2026-02'), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(monthsEndingAt('2026-12'), ['2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
});

test('resumo exige todos os totais finitos, aceita zero e valores decimais serializados', () => {
  assert.ok(validSummary({ income: 0, expense: 0, balance: 0 }));
  assert.ok(validSummary({ income: '12.5', expense: '20', balance: '-7.5' }));
  for (const invalid of [null, undefined, {}, { income: 1, expense: 1 }]) assert.ok(!validSummary(invalid));
  for (const key of ['income', 'expense', 'balance']) {
    for (const value of [null, undefined, NaN, Infinity, -Infinity, 'inválido', '', ' ', true, false, [], {}]) {
      assert.ok(!validSummary({ ...summary(), [key]: value }), `${key} não deve aceitar ${JSON.stringify(value)}`);
    }
  }
});

test('comparação lida com base zero, saldos negativos, igualdade e indisponibilidade', () => {
  assert.match(comparison(summary(80), summary(0)), /80,00 a mais/);
  assert.match(comparison(summary(-20), summary(-100)), /80,00 a mais/);
  assert.match(comparison(summary(-100), summary(-20)), /80,00 a menos/);
  assert.match(comparison(summary(0), summary(0)), /igual/);
  for (const values of [[null, summary()], [summary(), null]]) assert.match(comparison(...values), /indisponível/);
  assert.doesNotMatch(comparison(summary(80), summary(0)), /NaN|Infinity|%/);
});

test('falhas parciais preservam meses válidos e não viram zeros nem conectam lacunas', async () => {
  const loader = createHistoryLoader(async month => {
    if (month === '2026-06') throw new Error('offline');
    if (month === '2026-07') return { income: 1 };
    return summary();
  });
  const points = await loader.load(request());
  assert.equal(points.length, 6);
  assert.deepEqual(points.filter(point => !point.summary).map(point => point.month), ['2026-06', '2026-07']);
  const { svg, table } = historyMarkup(points);
  assert.equal((table.match(/Indisponível/g) || []).length, 6);
  assert.doesNotMatch(svg, /NaN|Infinity/);
  const paths = [...svg.matchAll(/class="chart-series [^"]+" d="([^"]*)"/g)].map(match => match[1]);
  assert.equal(paths.length, 2);
  for (const path of paths) assert.deepEqual(path.match(/[ML]/g), ['M', 'L', 'M', 'L']);
  assert.match(table, /<caption/);
});

test('resumo atual inválido permanece indisponível e falhas anteriores podem ser tentadas novamente', async () => {
  let failed = true;
  let calls = 0;
  const loader = createHistoryLoader(async () => { calls++; if (failed) throw new Error('offline'); return summary(); });
  const first = await loader.load(request({ summary: null }));
  assert.ok(first.every(point => point.summary === null));
  failed = false;
  const second = await loader.load(request());
  assert.ok(second.every(point => validSummary(point.summary)));
  assert.equal(calls, 10);
});

test('troca rápida de mês entrega somente a consulta mais recente', async () => {
  const pending = [];
  const loader = createHistoryLoader(() => { const task = deferred(); pending.push(task); return task.promise; });
  const old = loader.load(request());
  const latest = loader.load(request({ month: '2026-10' }));
  pending.slice(5).forEach(task => task.resolve(summary(200)));
  const points = await latest;
  assert.equal(points.at(-1).month, '2026-10');
  assert.equal(points[0].summary.balance, 200);
  pending.slice(0, 5).forEach(task => task.resolve(summary(10)));
  assert.equal(await old, null);
});

test('reset durante consulta impede entrega e cache de dados antigos após logout ou alteração', async () => {
  const pending = [];
  let fresh = false;
  let calls = 0;
  const loader = createHistoryLoader(() => {
    calls++;
    if (fresh) return Promise.resolve(summary(900));
    const task = deferred(); pending.push(task); return task.promise;
  });
  const old = loader.load(request());
  loader.reset();
  pending.forEach(task => task.resolve(summary(10)));
  assert.equal(await old, null);
  fresh = true;
  const points = await loader.load(request());
  assert.equal(calls, 10);
  assert.ok(points.slice(0, -1).every(point => point.summary.balance === 900));
  await loader.load(request());
  assert.equal(calls, 10);
  loader.reset();
  await loader.load(request());
  assert.equal(calls, 15);
});

test('cache é isolado por conta e inclusão de compartilhados, sem consultar mês atual', async () => {
  const calls = [];
  const loader = createHistoryLoader(async (month, shared) => { calls.push({ month, shared }); return summary(shared ? 200 : 100); });
  const own = await loader.load(request());
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => call.month !== '2026-09' && call.shared === false));
  assert.equal(own.at(-1).summary.balance, 80);
  await loader.load(request());
  assert.equal(calls.length, 5);
  const shared = await loader.load(request({ shared: true }));
  assert.equal(calls.length, 10);
  assert.equal(shared[0].summary.balance, 200);
  await loader.load(request({ account: 'ionara' }));
  assert.equal(calls.length, 15);
  const ownAgain = await loader.load(request());
  assert.equal(calls.length, 15);
  assert.equal(ownAgain[0].summary.balance, 100);
});

test('gráficos vazios são finitos e nomes de categorias são escapados', () => {
  const zero = { income: 0, expense: 0, balance: 0, byCategory: {} };
  assert.doesNotMatch(historyMarkup(monthsEndingAt('2026-09').map(month => ({ month, summary: zero }))).svg, /NaN|Infinity/);
  assert.match(categoryMarkup(zero), /Sem despesas/);
  assert.match(categoryMarkup(null), /indisponível/);
  const markup = categoryMarkup({ ...summary(), byCategory: { '<script>alert(1)</script>': 20 } });
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /&lt;script&gt;/);
});
