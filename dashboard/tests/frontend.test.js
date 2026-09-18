import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('boas-vindas e guia respeitam nome e vínculo Telegram de cada conta', async () => {
  for (const account of [
    { username: 'ionararosendo', name: 'Iônara', telegram_linked: false },
    { username: 'nicolasreis', name: 'Nicolas', telegram_linked: true },
  ]) {
    const ui = mount(() => Promise.resolve(json({ authenticated: true, account, transactions: [], summary: { income: 0, expense: 0, balance: 0, byCategory: {} } })));
    await until(() => ui.element('welcome-title').textContent.includes(account.name));
    assert.equal(ui.element('tutorial-guide').hidden, false);
    assert.match(ui.element('telegram-status').textContent, account.telegram_linked ? /conectado/ : /pendente/);
    ui.element('finish-tutorial').dispatch('click');
    assert.equal(ui.element('tutorial-guide').hidden, true);
    ui.element('open-tutorial').dispatch('click');
    assert.equal(ui.element('tutorial-guide').hidden, false);
  }
});

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = { toggle() {} };
    this.value = '';
    this.textContent = '';
    this.style = {};
    this.hidden = false;
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  dispatch(name) { return this.listeners.get(name)?.({ preventDefault() {} }); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  set ariaLabel(value) { this.setAttribute('aria-label', value); }
  get ariaLabel() { return this.getAttribute('aria-label'); }
  reset() {}
  showModal() {}
  close() {}
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function json(data) { return { ok: true, json: async () => data }; }

function mount(fetch) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement(tagName) { return new Element(tagName); },
  };
  runInNewContext(source, { document, fetch, Intl, Date, Number, Object, Map, Error, window: { confirm: () => false } });
  return { element: (id) => document.getElementById(id) };
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('A interface não atingiu o estado esperado');
}

test('a última seleção de mês vence quando há uma consulta em andamento', async () => {
  const calls = [];
  const ui = mount((path) => {
    if (path === '/api/session') return Promise.resolve(json({ authenticated: true }));
    const pending = deferred();
    calls.push({ path, pending });
    return pending.promise;
  });
  await until(() => calls.length === 1);
  calls[0].pending.resolve(json({ user: { name: 'Ni' }, transactions: [] }));
  await until(() => ui.element('page-message').hidden);

  ui.element('month').value = '2026-08';
  ui.element('month').dispatch('change');
  await until(() => calls.length === 2);
  ui.element('month').value = '2026-09';
  ui.element('month').dispatch('change');
  calls[1].pending.resolve(json({ user: { name: 'Ni' }, transactions: [{ id: 'old', transaction_type: 'despesa', amount: 10, category: 'Outros', description: 'Antigo', transaction_date: '2026-08-01' }] }));
  await until(() => calls.slice(2).some((call) => call.path.includes('month=2026-09')));
  const latest = calls.slice(2).find((call) => call.path.includes('month=2026-09'));
  latest.pending.resolve(json({ user: { name: 'Ni' }, transactions: [{ id: 'new', transaction_type: 'despesa', amount: 20, category: 'Outros', description: 'Atual', transaction_date: '2026-09-01' }] }));
  await until(() => ui.element('transaction-rows').children[0]?.children[0]?.textContent === 'Atual');
  assert.equal(ui.element('month').value, '2026-09');
  assert.equal(ui.element('transaction-count').textContent, '1 registro');
});

test('ações de cada lançamento possuem nomes acessíveis específicos', async () => {
  const ui = mount((path) => Promise.resolve(json(path === '/api/session'
    ? { authenticated: true }
    : { user: { name: 'Ni' }, transactions: [{ id: '1', transaction_type: 'despesa', amount: 12, category: 'Alimentação', description: 'Almoço', transaction_date: '2026-09-01' }] })));
  await until(() => ui.element('transaction-rows').children.length === 1);
  const actions = ui.element('transaction-rows').children[0].children[4].children;
  assert.match(actions[0].getAttribute('aria-label') ?? '', /editar.*almoço/i);
  assert.match(actions[1].getAttribute('aria-label') ?? '', /excluir.*almoço/i);
});

test('login envia usuário normalizado e senha e mostra identidade da conta', async () => {
  const calls = [];
  const ui = mount(async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/api/session') return json(options.method === 'POST' ? { authenticated: true, account: { name: 'Iônara', username: 'ionararosendo' } } : { authenticated: false });
    return json({ account: { name: 'Iônara', username: 'ionararosendo' }, transactions: [], summary: { income: 0, expense: 0, balance: 0, byCategory: {} } });
  });
  await until(() => ui.element('login-view').hidden === false);
  ui.element('username').value = '  IONARAROSENDO ';
  ui.element('password').value = 'senha-ficticia-testes';
  await ui.element('login-form').dispatch('submit');
  const call = calls.find((item) => item.options.method === 'POST');
  assert.deepEqual(JSON.parse(call.options.body), { username: 'ionararosendo', password: 'senha-ficticia-testes' });
  assert.equal(ui.element('user-username').textContent, '@ionararosendo');
  assert.equal(ui.element('password').value, '');
});

test('scope e inclusão nos totais são controles independentes, com filtros por scope', async () => {
  const calls = [];
  const ui = mount(async (path) => {
    calls.push(path);
    if (path === '/api/session') return json({ authenticated: true, account: { username: 'nicolasreis', name: 'Nicolas' } });
    return json({ transactions: [], summary: { income: 100, expense: path.includes('include_shared_summary=true') ? 40 : 20, balance: 80, byCategory: {} } });
  });
  await until(() => calls.length === 2);
  ui.element('filter-search').value = 'Mercado';
  ui.element('scope-shared').dispatch('click');
  await until(() => calls.some((path) => path.includes('scope=shared')));
  assert.equal(ui.element('filter-search').value, '');
  ui.element('include-shared-summary').checked = true;
  ui.element('include-shared-summary').dispatch('change');
  await until(() => calls.some((path) => path.includes('include_shared_summary=true')));
  assert.match(calls.at(-1), /scope=shared/);
  ui.element('scope-mine').dispatch('click');
  await until(() => calls.at(-1).includes('q=Mercado'));
  assert.equal(ui.element('filter-search').value, 'Mercado');
});

test('destinatário vê proprietário e ações completas, mas edição/exclusão exigem confirmação', async () => {
  const mutations = [];
  const ui = mount(async (path, options = {}) => {
    if (options.method) mutations.push({ path, options });
    if (path === '/api/session') return json({ authenticated: true, account: { username: 'nicolasreis', name: 'Nicolas' } });
    return json({ transactions: [{ id: 'shared', transaction_type: 'despesa', amount: 12, category: 'Alimentação', description: 'Almoço', transaction_date: '2026-09-01', owner_name: 'Iônara', owner_username: 'ionararosendo', is_owner: false, is_shared: true }] });
  });
  await until(() => ui.element('transaction-rows').children.length === 1);
  const row = ui.element('transaction-rows').children[0];
  const actions = row.children[4].children;
  assert.deepEqual(actions.map((action) => action.textContent), ['Editar', 'Excluir', 'Parar de compartilhar']);
  assert.match(row.children[0].children[0].children.map((element) => element.textContent).join(' '), /Iônara|ionararosendo/);
  actions[0].dispatch('click');
  actions[1].dispatch('click');
  actions[2].dispatch('click');
  assert.equal(mutations.length, 0);
});
