import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8').replace("import { icon } from './ui.js';", "const icon = () => '';\n");

class Element {
  constructor() {
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = { add() {}, remove() {}, toggle() {} };
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
  getAttribute(name) { return this.attributes.get(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  reset() {}
  showModal() {}
  close() {}
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('A interface não atingiu o estado esperado');
}

function mount() {
  const elements = new Map();
  const calls = [];
  const monthly = { income: 3000, expense: 100, balance: 2900, byCategory: { Alimentação: 100 } };
  const row = { id: '1', transaction_type: 'despesa', amount: 100, category: 'Alimentação', description: 'Mercado', transaction_date: '2026-08-31', deleted_at: '2026-09-01T12:00:00Z' };
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement() { return new Element(); },
  };
  const fetch = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === '/api/session') return { ok: true, json: async () => ({ authenticated: true }) };
    if (path === '/api/transactions' && options.method === 'PATCH') return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ user: { name: 'Ni' }, summary: monthly, transactions: path.includes('view=trash') ? [row] : [row], pagination: { page: 1, pageSize: 50, hasMore: false } }) };
  };
  runInNewContext(source, { document, fetch, Intl, Date, Number, Object, Map, Error, window: { confirm: () => true } });
  return { element: (id) => document.getElementById(id), calls };
}

test('filtro de datas atravessa meses sem alterar os cartões do resumo mensal', async () => {
  const ui = mount();
  await until(() => ui.element('transaction-rows').children.length === 1);
  ui.element('filter-from').value = '2026-08-01';
  ui.element('filter-from').dispatch('change');
  await until(() => ui.element('list-context').textContent.includes('cartões continuam mostrando o mês'));
  assert.equal(ui.element('income-total').textContent, 'R$ 3.000,00');
  assert.equal(ui.element('expense-total').textContent, 'R$ 100,00');
  assert.match(ui.element('list-context').textContent, /cartões continuam mostrando o mês/);
});

test('lixeira oferece restauração e envia ação explícita à API', async () => {
  const ui = mount();
  await until(() => ui.element('transaction-rows').children.length === 1);
  ui.element('trash-view').dispatch('click');
  await until(() => ui.element('transaction-rows').children[0]?.children[4]?.children[0]?.textContent === 'Restaurar');
  const action = ui.element('transaction-rows').children[0].children[4].children[0];
  assert.equal(action.textContent, 'Restaurar');
  assert.match(action.getAttribute('aria-label'), /Restaurar Mercado/);
  action.dispatch('click');
  await until(() => ui.calls.some(({ path, options }) => path === '/api/transactions' && options.method === 'PATCH'));
  const patch = ui.calls.find(({ path, options }) => path === '/api/transactions' && options.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.options.body), { id: '1', action: 'restore' });
});
