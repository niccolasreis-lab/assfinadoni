import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

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
