import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/profile.js';
import { setSession } from '../lib/server.js';
import { readProfilePatch, validAvatar } from '../lib/profile.js';

process.env.SESSION_SECRET = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres';
process.env.SUPABASE_URL = 'https://projeto-teste.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'chave-falsa-de-teste';
const accounts = [
  { id: '11111111-1111-4111-8111-111111111111', username: 'nicolasreis', display_name: 'Nicolas', session_version: 1, active: true, finance_user_id: '33333333-3333-4333-8333-333333333333', finance_users: { name: 'Nicolas', telegram_chat_id: 123 } },
  { id: '22222222-2222-4222-8222-222222222222', username: 'ionararosendo', display_name: 'Iônara', session_version: 1, active: true, finance_users: { name: 'Iônara' } },
];
const jpeg = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]).toString('base64')}`;
function headers(index = 0) {
  let cookie;
  setSession({ setHeader(_name, value) { cookie = value.split(';')[0]; } }, accounts[index]);
  return { cookie, origin: 'https://painel.exemplo.com', host: 'painel.exemplo.com', 'content-type': 'application/json' };
}
function response() { return { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } }; }
async function mocked(run, options = {}) {
  const original = globalThis.fetch;
  const calls = [];
  const profiles = new Map(accounts.map(account => [account.id, { display_name: account.display_name, avatar_data_url: null }]));
  globalThis.fetch = async (url, init) => {
    const call = { url: new URL(url), method: init.method, body: init.body ? JSON.parse(init.body) : null, headers: init.headers };
    calls.push(call);
    const id = call.url.searchParams.get('id')?.replace(/^eq\./, '');
    const auth = call.url.searchParams.get('select').includes('session_version');
    if (auth) return { ok: true, status: 200, json: async () => accounts.filter(account => account.id === id) };
    if (options.fail) return { ok: false, status: 500, json: async () => ({ error: 'secret internal error', avatar: jpeg }) };
    if (call.method === 'PATCH') profiles.set(id, { ...profiles.get(id), ...call.body });
    const result = options.missing ? [] : [{ ...profiles.get(id), password_hash: 'secret-hash', finance_user_id: 'private-id', avatar_data_url: options.invalidAvatar ? '<svg>bad</svg>' : profiles.get(id)?.avatar_data_url }];
    return { ok: true, status: options.noRepresentation && call.method === 'PATCH' ? 204 : 200, json: async () => result };
  };
  try { await run(calls, profiles); } finally { globalThis.fetch = original; }
}

test('perfil exige sessão, limita métodos e recusa origem cruzada antes de escrever', async () => {
  await mocked(async calls => {
    for (const [request, code] of [
      [{ method: 'GET', headers: {} }, 401],
      [{ method: 'POST', headers: headers(), body: {} }, 405],
      [{ method: 'PATCH', headers: { ...headers(), origin: 'https://outra.exemplo.com' }, body: { display_name: 'Outro' } }, 403],
      [{ method: 'PATCH', headers: { ...headers(), origin: undefined }, body: { display_name: 'Outro' } }, 403],
    ]) { const res = response(); await handler(request, res); assert.equal(res.statusCode, code); assert.equal(res.headers['Cache-Control'], 'no-store'); }
    assert.ok(calls.every(call => call.method === 'GET' && call.url.searchParams.get('select').includes('session_version')));
  });
});

test('GET ignora identificadores externos, isola as contas e retorna somente campos públicos', async () => {
  await mocked(async calls => {
    for (const index of [0, 1]) {
      const res = response();
      await handler({ method: 'GET', headers: headers(index), query: { id: accounts[1-index].id, account_id: accounts[1-index].id } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.profile, { display_name: accounts[index].display_name, avatar_data_url: null });
      assert.equal(res.body.account.id, accounts[index].id);
      assert.deepEqual(Object.keys(res.body.account).sort(), ['display_name', 'id', 'name', 'telegram_linked', 'username']);
      assert.equal(calls.at(-1).url.searchParams.get('id'), `eq.${accounts[index].id}`);
      assert.equal(calls.at(-1).url.searchParams.get('select'), 'display_name,avatar_data_url');
      assert.doesNotMatch(JSON.stringify(res.body), /secret-hash|private-id|session_version/);
    }
  });
});

test('PATCH salva nome aparado e foto na conta da sessão, com timestamp, sem alterar identidade financeira', async () => {
  await mocked(async (calls, profiles) => {
    const res = response();
    await handler({ method: 'PATCH', headers: headers(), query: { account_id: accounts[1].id }, body: JSON.stringify({ display_name: '  Meu nome  ', avatar_data_url: jpeg }) }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.profile, { display_name: 'Meu nome', avatar_data_url: jpeg });
    assert.equal(res.body.account.display_name, 'Meu nome');
    assert.equal(res.body.account.username, 'nicolasreis');
    const write = calls.find(call => call.method === 'PATCH');
    assert.equal(write.url.pathname, '/rest/v1/dashboard_accounts');
    assert.equal(write.url.searchParams.get('id'), `eq.${accounts[0].id}`);
    assert.deepEqual(Object.keys(write.body).sort(), ['avatar_data_url', 'display_name', 'updated_at']);
    assert.ok(Number.isFinite(Date.parse(write.body.updated_at)));
    assert.equal(write.headers.Prefer, 'return=representation');
    assert.equal(profiles.get(accounts[1].id).display_name, 'Iônara');
    const clear = response();
    await handler({ method: 'PATCH', headers: headers(), body: { avatar_data_url: null } }, clear);
    assert.deepEqual(clear.body.profile, { display_name: 'Meu nome', avatar_data_url: null });
  });
});

test('PATCH rejeita dados inválidos, IDs e campos desconhecidos sem escrever', async () => {
  await mocked(async calls => {
    const invalid = [undefined, null, [], {}, '{', { display_name: null }, { display_name: ' ' }, { display_name: 'x' }, { display_name: 'x'.repeat(61) }, { avatar_data_url: '' }, { avatar_data_url: 'https://photo.example/image.jpg' }, { display_name: 'Nome', id: accounts[1].id }, { display_name: 'Nome', account_id: accounts[1].id }, { username: 'novo' }, { avatar_data_url: jpeg.replace('jpeg', 'png') }, { avatar_data_url: 'data:image/jpeg;base64,aGVsbG8=' }, { avatar_data_url: jpeg.slice(0, -4) }, { avatar_data_url: 'data:image/jpeg;base64,' + 'A'.repeat(140000) }, ' '.repeat(150001), { display_name: 'a'.repeat(150001) }];
    for (const body of invalid) { const res = response(); await handler({ method: 'PATCH', headers: headers(), body }, res); assert.equal(res.statusCode, 400, `payload inválido de tipo ${typeof body}`); }
    const res = response(); await handler({ method: 'PATCH', headers: { ...headers(), 'content-type': 'text/plain' }, body: { display_name: 'Nome' } }, res); assert.equal(res.statusCode, 400);
    assert.ok(calls.every(call => call.method === 'GET'));
  });
});

test('parser local aceita JPEG além de 4096 e mantém limites e marcadores JPEG', () => {
  const bytes = Buffer.concat([Buffer.from([255,216,255]), Buffer.alloc(5000), Buffer.from([255,217])]);
  const photo = 'data:image/jpeg;base64,' + bytes.toString('base64');
  assert.equal(readProfilePatch({ headers: headers(), body: { avatar_data_url: photo } }).avatar_data_url, photo);
  assert.equal(validAvatar('data:image/jpeg;base64,' + Buffer.from('not a jpeg').toString('base64')), false);
  assert.equal(validAvatar(photo.replace(/=$/, '')), false);
  assert.equal(validAvatar(photo + '\n'), false);
  assert.equal(readProfilePatch({ headers: headers(), body: Buffer.from('{"display_name":"Nome"}') }).display_name, 'Nome');
});

test('perfil lê resultado após PATCH sem representação e trata ausente ou erro sem expor dados', async () => {
  await mocked(async calls => {
    const res = response(); await handler({ method: 'PATCH', headers: headers(), body: { display_name: 'Novo nome' } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.profile.display_name, 'Novo nome'); assert.equal(calls.at(-1).method, 'GET');
  }, { noRepresentation: true });
  for (const [options, code] of [[{ fail: true }, 500], [{ missing: true }, 404]]) {
    await mocked(async () => { const res = response(); await handler({ method: 'GET', headers: headers() }, res); assert.equal(res.statusCode, code); assert.doesNotMatch(JSON.stringify(res.body), /secret|base64|supabase|private-id/); }, options);
  }
  await mocked(async () => { const res = response(); await handler({ method: 'GET', headers: headers() }, res); assert.equal(res.body.profile.avatar_data_url, null); }, { invalidAvatar: true });
});
