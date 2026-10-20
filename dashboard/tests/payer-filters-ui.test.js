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

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function mount() {
  const elements = new Map(), calls = [];
  const row = { id: 'expense', transaction_type: 'despesa', amount: 100, category: 'Alimentação', description: 'Mercado', transaction_date: '2026-10-20', read_only: true };
  const rows = [
    {...row, payer: {kind: 'participant', participant_ids: [A], labels: ['Ni']}},
    {...row, id: 'joint', payer: {kind: 'joint', participant_ids: [A,B], labels: ['Ni','Ionara']}},
    {...row, id: 'historic'},
    {...row, id: 'income', transaction_type: 'receita'},
    {...row, id: 'unsafe', payer: {kind: 'participant', participant_ids: [B], labels: ['<img src=x onerror=alert(1)>']}},
  ];
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
    createElement() { return new Element(); },
  };
  const fetch = async (path, options = {}) => {
    calls.push({path, options});
    if (path === '/api/session') return {ok:true,json:async()=>({authenticated:true})};
    return {ok:true,json:async()=>({summary:{income:1000,expense:500,balance:500,byCategory:{Alimentação:500}},transactions:rows,payer_participants:[{id:A,display_name:'Ni',active:true},{id:B,display_name:'<img src=x>',active:false}],pagination:{hasMore:true}})};
  };
  runInNewContext(source,{document,fetch,Intl,Date,Number,Object,Map,Error,window:{confirm:()=>true}});
  const element = id => document.getElementById(id);
  const settled = () => until(()=>element('transaction-rows').children.length===5 && !element('dashboard-view').getAttribute('aria-busy'));
  async function action(id,event='click') { element(id).dispatch(event); await settled(); }
  return {element,calls,action,settled,latest:()=>new URL(calls.filter(c=>/^\/api\/(couple|transactions)\?/.test(c.path)).at(-1).path,'https://test.local')};
}

test('pagador filtra no servidor antes da página e não altera resumo mensal', async()=>{
  const ui=mount();await ui.settled();await ui.action('scope-couple');
  assert.equal(ui.element('payer-filter-control').hidden,false);
  assert.ok(ui.element('filter-payer').children.some(option=>option.value==='participant:'+A&&option.textContent==='Ni'));
  await ui.action('next-page');assert.equal(ui.latest().searchParams.get('page'),'2');
  ui.element('filter-payer').value='participant:'+A;await ui.action('filter-payer','change');
  assert.equal(ui.latest().pathname,'/api/couple');assert.equal(ui.latest().searchParams.get('payer_kind'),'participant');assert.equal(ui.latest().searchParams.get('payer_id'),A);assert.equal(ui.latest().searchParams.get('page'),'1');
  assert.equal(ui.element('expense-total').textContent,'R$ 500,00');assert.match(ui.element('list-context').textContent,/cartões continuam mostrando o mês/);
  for(const kind of ['unknown','joint','participant','all']) { ui.element('filter-payer').value=kind;await ui.action('filter-payer','change');assert.equal(ui.latest().searchParams.get('payer_kind'),kind);assert.equal(ui.latest().searchParams.has('payer_id'),false); }
});

test('pagador só viaja para Casal e datas continuam independentes por escopo',async()=>{
  const ui=mount();await ui.settled();
  ui.element('filter-from').value='2026-08-01';await ui.action('filter-from','change');
  const personalFrom=ui.element('filter-from').value;
  await ui.action('scope-couple');ui.element('filter-from').value='2026-09-01';await ui.action('filter-from','change');
  ui.element('filter-payer').value='participant:'+A;await ui.action('filter-payer','change');
  for(const scope of ['mine','shared','all']) { await ui.action('scope-'+scope);assert.equal(ui.latest().searchParams.has('payer_kind'),false);assert.equal(ui.latest().searchParams.has('payer_id'),false);assert.equal(ui.element('payer-filter-control').hidden,true); }
  await ui.action('scope-mine');assert.equal(ui.element('filter-from').value,personalFrom);
  await ui.action('scope-couple');assert.equal(ui.element('filter-from').value,'2026-09-01');assert.equal(ui.latest().searchParams.get('payer_id'),A);
  await ui.action('clear-filters');assert.equal(ui.latest().searchParams.get('payer_kind'),'all');assert.equal(ui.latest().searchParams.has('payer_id'),false);assert.equal(ui.latest().searchParams.get('page'),'1');
});

test('labels distinguem histórico, receitas e conjunto sem executar texto recebido',async()=>{
  const ui=mount();await ui.settled();await ui.action('scope-couple');
  const badges=ui.element('transaction-rows').children.map(tr=>tr.children[0].children[0].children.at(-1));
  assert.equal(badges[0].textContent,'Pagador: Ni');assert.match(badges[1].textContent,/Pagamento conjunto: Ni \+ Ionara · sem divisão presumida/);
  assert.equal(badges[2].textContent,'Pagador não identificado');assert.equal(badges[3].textContent,'Pagador: não se aplica a receitas');
  assert.equal(badges[4].textContent,'Pagador: <img src=x onerror=alert(1)>');assert.equal(badges[4].children.length,0);assert.equal(badges[4].innerHTML,undefined);
  const unsafe=ui.element('filter-payer').children.find(option=>option.value==='participant:'+B);assert.equal(unsafe.textContent,'<img src=x> (inativo)');assert.equal(unsafe.innerHTML,undefined);
  await ui.action('scope-mine');assert.equal(ui.element('transaction-rows').children[0].children[0].children[0].children.some(b=>b.className==='badge payer-badge'),false);
});
