import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticated, localDate, monthBounds, passwordMatches, sameOrigin, setSession, validDate, validatedTransaction } from '../lib/server.js';

test('valida lançamento em BRL e rejeita dados inválidos', () => {
  const good = { transaction_type: 'despesa', amount: 19.99, category: 'Alimentação', description: 'Almoço', transaction_date: '2026-09-15' };
  assert.equal(validatedTransaction(good).amount, '19.99');
  assert.throws(() => validatedTransaction({ ...good, amount: -1 }));
  assert.throws(() => validatedTransaction({ ...good, amount: 1.234 }));
  assert.throws(() => validatedTransaction({ ...good, category: 'Qualquer' }));
  assert.throws(() => validatedTransaction({ ...good, transaction_date: '2099-01-01' }));
  assert.equal(validDate('2026-02-30'), false);
});

test('intervalo mensal cruza o ano', () => {
  assert.deepEqual(monthBounds('2026-12'), ['2026-12-01', '2027-01-01']);
  assert.throws(() => monthBounds('2026-13'));
  assert.match(localDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test('sessão assinada e restrita à mesma origem', () => {
  process.env.DASHBOARD_PASSWORD = 'uma-senha-longa-para-teste';
  process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  assert.equal(passwordMatches('uma-senha-longa-para-teste'), true);
  assert.equal(passwordMatches('senha-errada'), false);
  let cookie = '';
  setSession({ setHeader(_name, value) { cookie = value; } });
  assert.equal(authenticated({ headers: { cookie } }), true);
  assert.equal(authenticated({ headers: { cookie: cookie.split(';')[0].replace(/\.[^.]+$/, '.wrong') } }), false);
  assert.equal(sameOrigin({ headers: { origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com' } }), true);
  assert.equal(sameOrigin({ headers: { origin: 'https://malicioso.exemplo.com', host: 'painel.exemplo.com' } }), false);
});
