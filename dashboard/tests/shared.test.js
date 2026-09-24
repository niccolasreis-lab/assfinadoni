import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { authenticated, hashPassword, localDate, monthBounds, normalizeUsername, readSession, sameOrigin, setSession, validDate, validatedTransaction, verifyPassword } from '../lib/server.js';

test('valida lançamento em BRL e rejeita dados inválidos', () => {
  const good = { transaction_type: 'despesa', amount: 19.99, category: 'Alimentação', description: 'Almoço', transaction_date: '2026-09-15' };
  assert.equal(validatedTransaction(good).amount, '19.99');
  assert.throws(() => validatedTransaction({ ...good, amount: -1 }));
  assert.throws(() => validatedTransaction({ ...good, amount: 1.234 }));
  assert.throws(() => validatedTransaction({ ...good, category: 'x' }));
  assert.throws(() => validatedTransaction({ ...good, transaction_date: '2099-01-01' }));
  assert.equal(validDate('2026-02-30'), false);
});

test('intervalo mensal cruza o ano', () => {
  assert.deepEqual(monthBounds('2026-12'), ['2026-12-01', '2027-01-01']);
  assert.throws(() => monthBounds('2026-13'));
  assert.match(localDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test('senha usa scrypt e username é normalizado sem revelar a senha', async () => {
  const encoded = await hashPassword('senha-ficticia-testes');
  assert.match(encoded, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(encoded.includes('senha-ficticia-testes'), false);
  assert.equal(await verifyPassword('senha-ficticia-testes', encoded), true);
  assert.equal(await verifyPassword('senha-errada', encoded), false);
  assert.equal(await verifyPassword('senha-ficticia-testes', 'hash-inválido'), false);
  assert.equal(normalizeUsername('  NicolasReis  '), 'nicolasreis');
  assert.throws(() => normalizeUsername('nome com espaço'), /Credenciais inválidas/);
});

test('sessão identifica a conta, resiste a adulteração e é revalidada no banco', async () => {
  process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  process.env.SUPABASE_URL = 'https://projeto-teste.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa-de-teste';
  const account = { id: '11111111-1111-4111-8111-111111111111', username: 'nicolasreis', session_version: 3 };
  let cookie = '';
  setSession({ setHeader(_name, value) { cookie = value; } }, account);
  assert.equal(readSession({ headers: { cookie } }).aid, account.id);
  assert.equal(readSession({ headers: { cookie: cookie.split(';')[0].replace(/\.[^.]+$/, '.wrong') } }), null);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [{ ...account, display_name: 'Nicolas', finance_user_id: '22222222-2222-4222-8222-222222222222', active: true, finance_users: { name: 'Nicolas' } }] });
  try {
    const authenticatedAccount = await authenticated({ headers: { cookie } });
    assert.equal(authenticatedAccount.username, 'nicolasreis');
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [{ ...account, session_version: 4, active: true }] });
    assert.equal(await authenticated({ headers: { cookie } }), null);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(sameOrigin({ headers: { origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com' } }), true);
  assert.equal(sameOrigin({ headers: { origin: 'https://malicioso.exemplo.com', host: 'painel.exemplo.com' } }), false);
});

test('sessão recusa expiração ausente, não numérica ou vencida mesmo com assinatura válida', () => {
  process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
  for (const exp of [undefined, 'NaN', null, Date.now() - 1]) {
    const payload = Buffer.from(JSON.stringify({ aid: '11111111-1111-4111-8111-111111111111', v: 1, exp })).toString('base64url');
    const signature = createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('base64url');
    assert.equal(readSession({ headers: { cookie: `finance_session=${payload}.${signature}` } }), null);
  }
});
