import { categoryMarkup, comparison, createHistoryLoader, historyMarkup, validSummary } from './charts.js';
import { installDialogMotion, reveal } from './motion.js';
import { createProfileController } from './profile-ui.js';
import { createRemindersController } from './reminders-ui.js';
let reminders;
import { telegramBotUrl } from './config.js';
const $ = id => document.getElementById(id);
const paths = {
  chevron: '<path d="m6 9 6 6 6-6"/>',
  camera: '<path d="M8 5 9 3h6l1 2h4v15H4V5Z"/><circle cx="12" cy="12" r="4"/>',
  cloud: '<path d="M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5 5 0 0 1 0 11"/><path d="m9 15 3-3 3 3m-3-3v9"/>',
  logout: '<path d="M9 4H4v16h5m5-12 4 4-4 4m-6-4h10"/>',
  wallet: '<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8h18M17 12h4v5h-4a2.5 2.5 0 0 1 0-5Z"/>',
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  transactions: '<path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4"/>',
  up: '<path d="M6 17 18 5M6 5h12v12"/>', down: '<path d="m6 7 12 12M6 19h12V7"/>',
  categories: '<path d="m3 12 9-9h8v8l-9 10Z"/><circle cx="16" cy="7" r="1"/>',
  reports: '<path d="M4 3v18h17M8 15V9m5 6V5m5 10v-4"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 4v16M4 12h16"/>', arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  send: '<path d="m21 3-6 18-4-8-8-4 18-6Zm0 0L11 13"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};
export const icon = name => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.wallet}</svg>`;
const sections = [['overview','Visão geral','overview'],['central','Central financeira','wallet'],['transactions','Transações','transactions'],['income','Receitas','up'],['expense','Despesas','down'],['categories','Categorias','categories'],['reports','Relatórios','reports'],['settings','Configurações','settings']];
let profile;
let api, section = 'overview', historyContext = '', lastState, renderedPoints;
const history = createHistoryLoader(async (month, shared) => {
  const result = await api.request(`/api/transactions?month=${month}&page=1&scope=mine&include_shared_summary=${shared}`);
  return result.summary;
});
function drawIcons() { document.querySelectorAll('[data-icon]').forEach(node => { node.innerHTML = icon(node.dataset.icon); }); }
function navButton(id, text, symbol, action) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'nav-item'; button.dataset.section = id;
  button.innerHTML = icon(symbol); const label = document.createElement('span'); label.textContent = text; button.append(label);
  button.addEventListener('click', action || (() => navigate(id))); return button;
}
function updatePanels() {
  $('dashboard-view').dataset.section = section;
  const overview = section === 'overview', listing = ['transactions','income','expense'].includes(section);
  $('history-panel').hidden = !overview && section !== 'reports';
  $('transactions-panel').hidden = !overview && !listing;
  $('category-panel').hidden = !overview && !['categories','reports'].includes(section);
  $('filter-type').parentElement.hidden = ['income','expense'].includes(section);
  $('settings-panel').hidden = section !== 'settings';
  $('central-panel').hidden = section !== 'central';
  document.querySelector('.cards').hidden = section === 'settings' || section === 'central';
  document.querySelector('.summary-heading').hidden = section === 'settings' || section === 'central';
  $('quick-actions').hidden = !overview && section !== 'settings';
  $('transactions-title').textContent = overview ? 'Últimos lançamentos' : sections.find(s => s[0] === section)?.[1] || 'Transações';
  $('view-all').hidden = !overview;
  document.querySelectorAll('[data-section]').forEach(node => {
    if (node.tagName !== 'BUTTON') return;
    const active = node.dataset.section === section || node.dataset.section === 'more' && !['overview','transactions'].includes(section);
    if (active) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
  });
}
async function navigate(next, load = true) {
  if (!sections.some(s => s[0] === next)) next = 'overview';
  section = next; await $('more-dialog').close(); updatePanels(); reveal(document.querySelector('.content'));
  if (load && ['overview','transactions','income','expense'].includes(section)) api.navigate(section);
  if (load && section === 'central') loadCentral();
  $('workspace-heading').focus({ preventScroll:true });
}
async function loadHistory(state, force = false) {
  lastState = state;
  const key = `${state.account?.username || ''}:${state.month}:${state.includeSharedSummary}`;
  if (!force && key === historyContext) return;
  historyContext = key;
  $('history-chart').innerHTML = '<div class="skeleton" aria-label="Carregando histórico"></div>';
  $('history-table').replaceChildren(); $('retry-history').hidden = true;
  $('history-status').textContent = 'Carregando histórico...';
  $('balance-insight').textContent = 'Comparando com o mês anterior...';
  const points = await history.load({ month:state.month, shared:state.includeSharedSummary, account:state.account?.username || '', summary:state.summary });
  if (!points) return;
  renderedPoints = points;
  const markup = historyMarkup(points, $('history-chart').clientWidth);
  $('history-chart').innerHTML = markup.svg; $('history-table').innerHTML = markup.table;
  const missing = points.filter(p => !p.summary).length;
  $('history-status').textContent = missing ? 'Parte do histórico está indisponível. Os meses sem dados não foram tratados como zero.' : '';
  $('retry-history').hidden = !missing;
  $('balance-insight').textContent = comparison(state.summary, points[4].summary);
}
async function loadCentral() {
  $('central-status').textContent = 'Carregando...';
  try {
    const [accounts, cards, installments] = await Promise.all([
      api.request('/api/v1/accounts'), api.request('/api/v1/cards'), api.request('/api/v1/installments'),
    ]);
    const accountRows = Array.isArray(accounts.accounts) ? accounts.accounts : [];
    const cardRows = Array.isArray(cards.cards) ? cards.cards : [];
    const installmentRows = Array.isArray(installments.installments) ? installments.installments : [];
    $('central-accounts-count').textContent = `${accountRows.length} ${accountRows.length === 1 ? 'fonte' : 'fontes'}`;
    $('central-cards-count').textContent = `${cardRows.length} ${cardRows.length === 1 ? 'cartão' : 'cartões'}`;
    $('central-installments-count').textContent = `${installmentRows.length} ${installmentRows.length === 1 ? 'parcela' : 'parcelas'}`;
    $('central-accounts').replaceChildren(...accountRows.slice(0, 4).map((row) => { const item = document.createElement('span'); item.textContent = row.name; return item; }));
    $('central-cards').replaceChildren(...cardRows.slice(0, 4).map((row) => { const item = document.createElement('span'); item.textContent = row.nickname || row.name; return item; }));
    $('central-status').textContent = '';
  } catch (error) { $('central-status').textContent = error.message || 'Central indisponível.'; }
}
function resetHistory() { history.reset(); historyContext = ''; lastState = null; renderedPoints = null; }
window.FinanceUI = {
  init(callbacks) {
    api = callbacks; drawIcons(); installDialogMotion(); profile=createProfileController(api.request); reminders=createRemindersController({request:api.request,onChanged:api.reload});
    new ResizeObserver(() => {
      if (renderedPoints && $('history-chart').clientWidth) $('history-chart').innerHTML=historyMarkup(renderedPoints,$('history-chart').clientWidth).svg;
    }).observe($('history-chart'));
    sections.forEach(([id,text,symbol]) => { $('desktop-nav').append(navButton(id,text,symbol)); $('more-nav').append(navButton(id,text,symbol)); });
    $('mobile-nav').append(navButton('overview','Visão geral','overview'),navButton('transactions','Transações','transactions'));
    const add = navButton('add','Adicionar','plus', () => api.add('despesa')); add.classList.add('add-action');
    $('mobile-nav').append(add,navButton('more','Mais','more', () => $('more-dialog').showModal()));
    $('close-more').addEventListener('click', () => $('more-dialog').close());
    const all = document.createElement('button'); all.id='view-all'; all.type='button'; all.className='text-button'; all.textContent='Ver todos'; all.addEventListener('click', () => navigate('transactions'));
    $('transactions-panel').querySelector('.panel-heading').append(all);
    $('toggle-password').addEventListener('click', () => {
      const visible = $('password').type === 'password'; $('password').type = visible ? 'text' : 'password';
      $('toggle-password').setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha'); $('toggle-password').setAttribute('aria-pressed',String(visible));
    });
    $('quick-income').addEventListener('click', () => api.add('receita'));
    $('quick-expense').addEventListener('click', () => api.add('despesa'));
    $('retry-history').addEventListener('click', () => { if(lastState) loadHistory(lastState,true); else api.reload(); });
    if (/^https:\/\/t\.me\/[a-zA-Z][a-zA-Z0-9_]{4,}$/.test(telegramBotUrl)) {
      $('open-telegram').href=telegramBotUrl; $('open-telegram').hidden=false; $('telegram-link-status').hidden=true;
    }
    document.querySelectorAll('.sidebar-brand').forEach(link => link.addEventListener('click', event => { event.preventDefault(); navigate('overview'); }));
    updatePanels();
  },
  render(state) {
    const name = state.account?.display_name || state.account?.name || state.account?.username || '';
    profile.sync(state.account);
    $('category-chart').innerHTML=categoryMarkup(state.summary); $('category-list').hidden=false;
    if(section === 'overview') $('transaction-count').textContent = `${Math.min(5,state.transactions.length)} recentes`;
    $('transaction-rows').querySelectorAll('tr').forEach(row => {
      const cell=row.firstElementChild;
      const badge=document.createElement('span'); badge.className='transaction-icon'; badge.innerHTML=icon(row.dataset.type === 'receita' ? 'up' : 'down');
      cell.prepend(badge);
    });
  },
  identity(account) { profile?.sync(account); reminders?.sync(account); },
  beforeLogout() { return reminders?.beforeLogout(); },
  authChanged(authenticated) { if(!authenticated) { profile?.reset(); reminders?.reset(); } reveal($(authenticated ? 'dashboard-view' : 'login-view')); },
  loaded(state) { loadHistory({ month:state.month, includeSharedSummary:state.includeSharedSummary, summary:state.summary, account:state.account }); if (section === 'central') loadCentral(); },
  invalidate() { resetHistory(); },
  loading() {
    // Hide the previous context immediately, including while the main request is pending.
    history.cancel(); historyContext=''; lastState=null; renderedPoints=null;
    $('category-chart').innerHTML='<div class="skeleton" aria-label="Carregando categorias"></div>'; $('category-list').hidden=true;
    $('retry-history').hidden=true;
    $('history-chart').innerHTML='<div class="skeleton" aria-label="Carregando histórico"></div>';
    $('history-table').replaceChildren(); $('history-status').textContent='Carregando histórico...';
    $('balance-insight').textContent='Comparando com o mês anterior...';
  },
  failed() { resetHistory(); $('history-chart').replaceChildren(); $('history-table').replaceChildren(); $('history-status').textContent='Não foi possível carregar os dados deste período.'; $('balance-insight').textContent='Comparação indisponível.'; $('retry-history').hidden=false; },
  reset() {
    resetHistory(); profile?.reset(); reminders?.reset(); section='overview'; updatePanels();
    $('history-chart').replaceChildren(); $('history-table').replaceChildren(); $('history-status').textContent=''; $('balance-insight').textContent='';
    $('password').type='password'; $('toggle-password').setAttribute('aria-pressed','false'); $('toggle-password').setAttribute('aria-label','Mostrar senha');
    document.querySelectorAll('dialog').forEach(dialog=>dialog.closeImmediately());
  },
  confirm(copy) {
    const dialog=$('confirm-dialog');
    if(dialog.open) return Promise.resolve(false);
    $('confirm-copy').textContent=copy; dialog.returnValue='cancel'; dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once:true }));
  },
};
