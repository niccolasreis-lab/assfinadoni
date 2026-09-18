const categories = ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Outros'];
const $ = (id) => document.getElementById(id);
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const state = { transactions: [], summary: null, month: '', view: 'active', page: 1, hasMore: false, datesCustomized: false, loadId: 0, deleting: new Set() };
state.scope = 'mine'; state.includeSharedSummary = false; state.account = null;
state.scopeFilters = {};
function saveScopeFilters() {
  state.scopeFilters[state.scope] = { q: $('filter-search').value, category: $('filter-category').value, type: $('filter-type').value, from: $('filter-from').value, to: $('filter-to').value, customized: state.datesCustomized, page: state.page };
}
function restoreScopeFilters(scope) {
  const saved = state.scopeFilters[scope];
  $('filter-search').value = saved?.q || ''; $('filter-category').value = saved?.category || ''; $('filter-type').value = saved?.type || '';
  state.datesCustomized = Boolean(saved?.customized); state.page = saved?.page || 1;
  if (saved?.customized) { $('filter-from').value = saved.from; $('filter-to').value = saved.to; } else syncMonthDates();
}
function remember(key, value) { try { sessionStorage.setItem(key, value); } catch {} }
function remembered(key, fallback) { try { return sessionStorage.getItem(key) || fallback; } catch { return fallback; } }
function isOwn(row) { return row.is_owner !== false; }
function isShared(row) { return Boolean(row.is_shared || row.shared || row.share_id); }
function ownerName(row) { return row.owner_name || row.owner?.name || row.owner_username || 'outra pessoa'; }
function setIdentity(account) {
  if (!account) return;
  state.account = account;
  $('user-name').textContent = account.display_name || account.name || account.username || 'Minha conta';
  $('user-username').textContent = account.username ? `@${account.username}` : '';
  const username = account.username || '';
  const person = account.name || account.display_name || '';
  $('welcome-title').textContent = person ? `Olá, ${person}. Seu mês, sem complicação.` : 'Seu mês, sem complicação.';
  $('welcome-copy').textContent = 'Organize seus lançamentos e compartilhe só o que escolher.';
  $('telegram-status').textContent = account.telegram_linked === true
    ? 'Seu Telegram está conectado. Você pode lançar por aqui ou conversar com o assistente.'
    : account.telegram_linked === false ? 'Seu vínculo com o Telegram está pendente. Você já pode lançar e organizar tudo por aqui.' : '';
  if (username && state.tutorialAccount !== username) {
    state.tutorialAccount = username;
    let seen = false;
    try { seen = localStorage.getItem(`finance_tutorial_v1_${username}`) === 'seen'; } catch {}
    setTutorialOpen(!seen);
  }
}

function setTutorialOpen(open, focus = false) {
  $('tutorial-guide').hidden = !open;
  $('open-tutorial').setAttribute('aria-expanded', open);
  if (open && focus) $('tutorial-title').focus?.();
}

function finishTutorial(focus = true) {
  const username = state.account?.username;
  if (username) { try { localStorage.setItem(`finance_tutorial_v1_${username}`, 'seen'); } catch {} }
  setTutorialOpen(false);
  if (focus) $('open-tutorial').focus?.();
}

function monthBounds(month) {
  const [year, number] = month.split('-').map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
}

function syncMonthDates() {
  const { from, to } = monthBounds($('month').value);
  $('filter-from').value = from;
  $('filter-to').value = to;
}

function hasActiveFilters() {
  const bounds = monthBounds($('month').value);
  return Boolean($('filter-search').value.trim() || $('filter-category').value || $('filter-type').value || $('filter-from').value !== bounds.from || $('filter-to').value !== bounds.to);
}

function formatDate(value) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function trashExpiry(value) {
  const deleted = new Date(value);
  if (Number.isNaN(deleted.getTime())) return 'Excluído recentemente';
  return `Recuperável até ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(deleted.getTime() + 30 * 86400000))}`;
}

function saoPauloToday() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function message(id, text, error = false) {
  const element = $(id);
  element.textContent = text;
  element.classList.toggle('error', error);
  element.hidden = !text;
}

async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: options.body ? { 'Content-Type': 'application/json' } : {}, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
  return data;
}

function showDashboard(authenticated) {
  $('login-brand').removeAttribute('data-pulsing');
  if (!authenticated && !document.hidden && !$('username').value && !$('password').value) $('login-brand').setAttribute('data-pulsing', 'true');
  $('initial-status').hidden = true;
  $('login-view').hidden = authenticated;
  $('dashboard-view').hidden = !authenticated;
  if (!authenticated) $('username').focus?.();
}

function render() {
  const rows = state.transactions;
  const fallbackIncome = rows.filter((row) => row.transaction_type === 'receita').reduce((sum, row) => sum + Number(row.amount), 0);
  const fallbackExpense = rows.filter((row) => row.transaction_type === 'despesa').reduce((sum, row) => sum + Number(row.amount), 0);
  const income = Number(state.summary?.income ?? fallbackIncome);
  const expense = Number(state.summary?.expense ?? fallbackExpense);
  $('income-total').textContent = money(income);
  $('expense-total').textContent = money(expense);
  $('balance-total').textContent = money(state.summary?.balance ?? income - expense);
  $('transaction-count').textContent = `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}${state.hasMore ? ' nesta página' : ''}`;
  $('empty-state').hidden = rows.length > 0;
  $('empty-state').textContent = state.view === 'trash'
    ? 'A lixeira está vazia. Lançamentos excluídos ficam aqui por até 30 dias.'
    : hasActiveFilters() ? 'Nenhum lançamento corresponde aos filtros. Ajuste a busca ou limpe os filtros.'
      : state.scope === 'shared' ? 'Nenhum lançamento foi compartilhado com você neste mês.' : 'Nenhum lançamento neste mês. Que tal adicionar o primeiro?';
  $('filter-form').hidden = state.view === 'trash';
  $('list-context').textContent = state.view === 'trash'
    ? 'Lançamentos excluídos podem ser restaurados por até 30 dias. Eles não entram nos totais.'
    : state.datesCustomized ? 'A lista usa o período escolhido. Os cartões continuam mostrando o mês selecionado.' : 'A lista mostra o mês selecionado.';
  $('active-view').setAttribute('aria-pressed', state.view === 'active');
  $('trash-view').setAttribute('aria-pressed', state.view === 'trash');
  for (const scope of ['mine', 'shared', 'all']) $('scope-' + scope).setAttribute('aria-pressed', state.scope === scope);
  $('include-shared-summary').checked = state.includeSharedSummary;
  $('pagination').hidden = state.page === 1 && !state.hasMore;
  $('page-number').textContent = `Página ${state.page}`;
  $('previous-page').disabled = state.page <= 1;
  $('next-page').disabled = !state.hasMore;
  const body = $('transaction-rows');
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    const description = document.createElement('td');
    description.textContent = row.description;
    const metadata = document.createElement('div'); metadata.className = 'row-metadata';
    const owner = document.createElement('span'); owner.className = 'badge owner-badge';
    owner.textContent = isOwn(row) ? 'Meu lançamento' : `De ${ownerName(row)}`;
    metadata.append(owner);
    if (isShared(row)) { const badge = document.createElement('span'); badge.className = 'badge shared-badge'; badge.textContent = 'Compartilhado'; metadata.append(badge); }
    description.append(metadata);
    if (state.view === 'trash' && row.deleted_at) {
      const note = document.createElement('small'); note.className = 'deleted-note';
      note.textContent = `Excluído em ${new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(row.deleted_at))}. ${trashExpiry(row.deleted_at)}.`;
      description.append(note);
    }
    const category = document.createElement('td');
    category.textContent = row.category;
    const date = document.createElement('td');
    date.textContent = formatDate(row.transaction_date);
    const amount = document.createElement('td');
    amount.className = `right amount ${row.transaction_type === 'receita' ? 'income' : 'expense'}`;
    amount.textContent = `${row.transaction_type === 'receita' ? '+' : '−'} ${money(row.amount)}`;
    const actions = document.createElement('td');
    actions.className = 'right row-actions';
    if (state.view === 'trash') {
      const restore = document.createElement('button');
      restore.type = 'button'; restore.className = 'text-button'; restore.textContent = 'Restaurar'; restore.setAttribute('aria-label', `Restaurar ${row.description}, ${money(row.amount)}`); restore.disabled = state.deleting.has(row.id); restore.addEventListener('click', () => restoreTransaction(row));
      actions.append(restore);
    } else {
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Editar'; edit.setAttribute('aria-label', `Editar ${row.description}, ${money(row.amount)}`); edit.disabled = state.deleting.has(row.id); edit.addEventListener('click', () => openForm(row));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = 'Excluir'; remove.setAttribute('aria-label', `Excluir ${row.description}, ${money(row.amount)}`); remove.disabled = state.deleting.has(row.id); remove.addEventListener('click', () => deleteTransaction(row));
      const share = document.createElement('button'); share.type = 'button'; share.className = 'text-button share-action';
      share.textContent = isShared(row) ? 'Parar de compartilhar' : 'Compartilhar';
      share.setAttribute('aria-label', `${share.textContent} ${row.description}, ${money(row.amount)}`);
      share.disabled = state.deleting.has(row.id);
      share.addEventListener('click', () => isShared(row) ? unshareTransaction(row) : openShareDialog(row));
      actions.append(edit, remove, share);
    }
    tr.append(description, category, date, amount, actions);
    body.append(tr);
  }
  const byCategory = new Map();
  if (state.summary?.byCategory && typeof state.summary.byCategory === 'object') {
    for (const [name, value] of Object.entries(state.summary.byCategory)) byCategory.set(name, Number(value));
  } else for (const row of rows.filter((item) => item.transaction_type === 'despesa')) byCategory.set(row.category, (byCategory.get(row.category) || 0) + Number(row.amount));
  const list = $('category-list');
  list.replaceChildren();
  if (!byCategory.size) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Sem despesas neste mês.'; list.append(p); }
  for (const [name, value] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    const item = document.createElement('div'); item.className = 'category-item';
    const top = document.createElement('div'); top.className = 'category-top';
    const label = document.createElement('span'); label.textContent = name;
    const total = document.createElement('strong'); total.textContent = money(value);
    const bar = document.createElement('div'); bar.className = 'bar';
    const fill = document.createElement('div'); fill.className = 'bar-fill'; fill.style.width = `${expense ? Math.round(value / expense * 100) : 0}%`;
    top.append(label, total); bar.append(fill); item.append(top, bar); list.append(item);
  }
}

async function loadTransactions() {
  saveScopeFilters();
  const loadId = ++state.loadId;
  const month = $('month').value;
  const params = [`month=${encodeURIComponent(month)}`, `page=${state.page}`, `scope=${state.scope}`, `include_shared_summary=${state.includeSharedSummary}`];
  if (state.view === 'trash') params.push('view=trash');
  else {
    const q = $('filter-search').value.trim();
    const category = $('filter-category').value;
    const type = $('filter-type').value;
    const from = $('filter-from').value;
    const to = $('filter-to').value;
    if (from && to && from > to) {
      message('page-message', 'A data inicial precisa ser anterior ou igual à data final.', true);
      return;
    }
    if (q) params.push(`q=${encodeURIComponent(q)}`);
    if (category) params.push(`category=${encodeURIComponent(category)}`);
    if (type) params.push(`type=${encodeURIComponent(type)}`);
    if (from) params.push(`date_from=${encodeURIComponent(from)}`);
    if (to) params.push(`date_to=${encodeURIComponent(to)}`);
  }
  $('dashboard-view').setAttribute('aria-busy', 'true');
  message('page-message', state.view === 'trash' ? 'Carregando lixeira...' : 'Carregando lançamentos...');
  try {
    const data = await request(`/api/transactions?${params.join('&')}`);
    if (loadId !== state.loadId || month !== $('month').value) return;
    state.month = month;
    state.transactions = data.transactions;
    if (data.summary) state.summary = data.summary;
    state.hasMore = Boolean(data.pagination?.hasMore);
    setIdentity(data.account || data.user);
    render();
    message('page-message', '');
  } catch (error) {
    if (loadId === state.loadId) message('page-message', `${error.message} Tente selecionar o mês novamente.`, true);
  } finally {
    if (loadId === state.loadId) $('dashboard-view').removeAttribute('aria-busy');
  }
}

function openForm(row = null) {
  $('transaction-form').reset();
  message('form-error', '');
  $('transaction-id').value = row?.id || '';
  $('dialog-title').textContent = row ? 'Editar lançamento' : 'Novo lançamento';
  $('save-transaction').textContent = row ? 'Salvar alterações' : 'Adicionar lançamento';
  $('transaction-type').value = row?.transaction_type || 'despesa';
  $('amount').value = row?.amount || '';
  $('category').value = row?.category || categories[0];
  $('description').value = row?.description || '';
  $('transaction-date').value = row?.transaction_date || saoPauloToday();
  $('transaction-date').max = saoPauloToday();
  $('transaction-dialog').showModal();
}

async function saveTransaction(event) {
  event.preventDefault();
  const id = $('transaction-id').value;
  const row = state.transactions.find((item) => item.id === id);
  if (row && !isOwn(row) && !window.confirm(`Este lançamento pertence a ${ownerName(row)}. A alteração afetará as duas contas. Continuar?`)) return;
  const body = { transaction_type: $('transaction-type').value, amount: Number($('amount').value), category: $('category').value, description: $('description').value.trim(), transaction_date: $('transaction-date').value };
  if (id) body.id = id;
  const button = $('save-transaction'); button.disabled = true;
  button.textContent = id ? 'Salvando alterações...' : 'Adicionando...';
  try {
    await request('/api/transactions', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    $('transaction-dialog').close();
    const month = body.transaction_date.slice(0, 7);
    if ($('month').value !== month) {
      $('month').value = month;
      if (!state.datesCustomized) syncMonthDates();
    }
    if (!id) { state.view = 'active'; state.scope = 'mine'; remember('finance_scope', 'mine'); }
    state.page = 1;
    await loadTransactions();
    message('page-message', id ? 'Lançamento atualizado.' : 'Lançamento adicionado.');
  } catch (error) { message('form-error', error.message, true); }
  finally { button.disabled = false; button.textContent = id ? 'Salvar alterações' : 'Adicionar lançamento'; }
}

async function deleteTransaction(row) {
  if (state.deleting.has(row.id)) return;
  if (!window.confirm(`Mover “${row.description}” (${money(row.amount)}) para a lixeira?${isShared(row) ? ' Isso afetará as duas contas.' : ''} Você poderá restaurar por até 30 dias.`)) return;
  state.deleting.add(row.id);
  render();
  message('page-message', 'Movendo para a lixeira...');
  try {
    await request('/api/transactions', { method: 'DELETE', body: JSON.stringify({ id: row.id }) });
    await loadTransactions();
    if (state.page > 1 && state.transactions.length === 0) { state.page--; await loadTransactions(); }
    message('page-message', 'Lançamento movido para a lixeira. Você pode restaurá-lo por até 30 dias.');
  } catch (error) { message('page-message', error.message, true); }
  finally { state.deleting.delete(row.id); render(); }
}

async function restoreTransaction(row) {
  if (state.deleting.has(row.id)) return;
  state.deleting.add(row.id);
  render();
  message('page-message', 'Restaurando lançamento...');
  try {
    await request('/api/transactions', { method: 'PATCH', body: JSON.stringify({ id: row.id, action: 'restore' }) });
    await loadTransactions();
    if (state.page > 1 && state.transactions.length === 0) { state.page--; await loadTransactions(); }
    message('page-message', 'Lançamento restaurado. Ele voltou a entrar nos totais do mês correspondente.');
  } catch (error) { message('page-message', error.message, true); }
  finally { state.deleting.delete(row.id); render(); }
}

async function openShareDialog(row) {
  message('share-error', '');
  $('share-transaction-id').value = row.id;
  $('share-description').textContent = `${row.description} · ${money(row.amount)}`;
  $('share-dialog').showModal();
  try {
    const data = await request(`/api/shares?transaction_id=${encodeURIComponent(row.id)}`);
    const candidate = data.candidates?.[0];
    $('share-dialog-title').textContent = candidate ? `Compartilhar com ${candidate.display_name || candidate.name || candidate.username}` : 'Compartilhar lançamento';
  } catch (error) { message('share-error', error.message, true); }
}

async function shareTransaction(event) {
  event.preventDefault();
  const button = $('confirm-share'); button.disabled = true; button.textContent = 'Compartilhando...';
  try {
    await request('/api/shares', { method: 'POST', body: JSON.stringify({ transaction_id: $('share-transaction-id').value }) });
    $('share-dialog').close(); await loadTransactions();
    message('page-message', 'Lançamento compartilhado. A outra pessoa pode visualizar e gerenciar este registro.');
  } catch (error) { message('share-error', error.message, true); }
  finally { button.disabled = false; button.textContent = 'Compartilhar'; }
}

async function unshareTransaction(row) {
  if (state.deleting.has(row.id)) return;
  if (!window.confirm(isOwn(row) ? `Parar de compartilhar “${row.description}”? A outra pessoa perderá o acesso.` : `Parar de compartilhar “${row.description}”? Você perderá o acesso a este lançamento.`)) return;
  state.deleting.add(row.id); render();
  try {
    await request('/api/shares', { method: 'DELETE', body: JSON.stringify({ transaction_id: row.id }) });
    await loadTransactions(); message('page-message', 'Compartilhamento encerrado.');
  } catch (error) { message('page-message', error.message, true); }
  finally { state.deleting.delete(row.id); render(); }
}

async function init() {
  const scope = remembered('finance_scope', 'mine');
  state.scope = ['mine', 'shared', 'all'].includes(scope) ? scope : 'mine';
  state.includeSharedSummary = remembered('finance_include_shared', 'false') === 'true';
  $('month').value = saoPauloToday().slice(0, 7);
  syncMonthDates();
  for (const name of categories) {
    for (const target of ['category', 'filter-category']) {
      const option = document.createElement('option'); option.value = name; option.textContent = name; $(target).append(option);
    }
  }
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('login-error', '');
    try {
      const data = await request('/api/session', { method: 'POST', body: JSON.stringify({ username: $('username').value.trim().toLowerCase(), password: $('password').value }) });
      state.loadId++; state.transactions = []; state.summary = null; state.page = 1; state.hasMore = false;
      state.view = 'active'; state.scope = 'mine'; state.includeSharedSummary = false; state.scopeFilters = {}; state.datesCustomized = false;
      restoreScopeFilters('mine'); remember('finance_scope', 'mine'); remember('finance_include_shared', 'false');
      setIdentity(data.account || data.user); $('password').value = ''; render(); showDashboard(true); await loadTransactions();
    }
    catch (error) { message('login-error', error.message, true); }
  });
  const stopLoginPulse = () => $('login-brand').removeAttribute('data-pulsing');
  for (const id of ['username', 'password']) {
    $(id).addEventListener('focus', stopLoginPulse);
    $(id).addEventListener('input', stopLoginPulse);
  }
  $('login-brand').addEventListener('animationend', stopLoginPulse);
  document.addEventListener?.('visibilitychange', () => { if (document.hidden) stopLoginPulse(); });
  $('logout').addEventListener('click', async () => {
    const button = $('logout'); button.disabled = true;
    try {
      await request('/api/session', { method: 'DELETE' });
      state.loadId++;
      state.transactions = [];
      state.summary = null;
      state.account = null;
      state.hasMore = false; state.page = 1; render();
      $('user-name').textContent = ''; $('user-username').textContent = '';
      $('transaction-dialog').close(); $('share-dialog').close();
      showDashboard(false);
    } catch (error) { message('page-message', `${error.message} Sua sessão continua aberta.`, true); }
    finally { button.disabled = false; }
  });
  $('month').addEventListener('change', () => {
    if (!state.datesCustomized) syncMonthDates();
    state.view = 'active'; state.page = 1; loadTransactions();
  });
  $('active-view').addEventListener('click', () => { if (state.view !== 'active') { state.view = 'active'; state.page = 1; loadTransactions(); } });
  $('trash-view').addEventListener('click', () => { if (state.view !== 'trash') { state.view = 'trash'; state.page = 1; loadTransactions(); } });
  for (const scope of ['mine', 'shared', 'all']) $('scope-' + scope).addEventListener('click', () => { if (state.scope !== scope) { saveScopeFilters(); state.scope = scope; restoreScopeFilters(scope); remember('finance_scope', scope); loadTransactions(); } });
  $('include-shared-summary').addEventListener('change', () => { state.includeSharedSummary = Boolean($('include-shared-summary').checked); remember('finance_include_shared', String(state.includeSharedSummary)); loadTransactions(); });
  $('filter-form').addEventListener('submit', (event) => { event.preventDefault(); state.page = 1; loadTransactions(); });
  for (const id of ['filter-category', 'filter-type']) $(id).addEventListener('change', () => { state.page = 1; loadTransactions(); });
  for (const id of ['filter-from', 'filter-to']) $(id).addEventListener('change', () => { state.datesCustomized = true; state.page = 1; loadTransactions(); });
  $('clear-filters').addEventListener('click', () => {
    $('filter-search').value = ''; $('filter-category').value = ''; $('filter-type').value = '';
    state.datesCustomized = false; syncMonthDates(); state.page = 1; loadTransactions();
  });
  $('previous-page').addEventListener('click', () => { if (state.page > 1) { state.page--; loadTransactions(); } });
  $('next-page').addEventListener('click', () => { if (state.hasMore) { state.page++; loadTransactions(); } });
  $('new-transaction').addEventListener('click', () => openForm());
  $('open-tutorial').addEventListener('click', () => setTutorialOpen(true, true));
  $('close-tutorial').addEventListener('click', () => finishTutorial());
  $('finish-tutorial').addEventListener('click', () => finishTutorial());
  $('tutorial-new-transaction').addEventListener('click', () => { finishTutorial(false); openForm(); });
  $('transaction-form').addEventListener('submit', saveTransaction);
  $('close-dialog').addEventListener('click', () => $('transaction-dialog').close());
  $('cancel-dialog').addEventListener('click', () => $('transaction-dialog').close());
  $('share-form').addEventListener('submit', shareTransaction);
  $('close-share-dialog').addEventListener('click', () => $('share-dialog').close());
  $('cancel-share-dialog').addEventListener('click', () => $('share-dialog').close());
  try { const session = await request('/api/session'); setIdentity(session.account || session.user); showDashboard(session.authenticated); if (session.authenticated) await loadTransactions(); }
  catch { showDashboard(false); }
}

init();
