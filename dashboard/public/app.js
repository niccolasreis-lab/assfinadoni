const categories = ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Outros'];
const $ = (id) => document.getElementById(id);
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const state = { transactions: [], month: '', loadId: 0, deleting: new Set() };

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
  $('initial-status').hidden = true;
  $('login-view').hidden = authenticated;
  $('dashboard-view').hidden = !authenticated;
}

function render() {
  const rows = state.transactions;
  const income = rows.filter((row) => row.transaction_type === 'receita').reduce((sum, row) => sum + Number(row.amount), 0);
  const expense = rows.filter((row) => row.transaction_type === 'despesa').reduce((sum, row) => sum + Number(row.amount), 0);
  $('income-total').textContent = money(income);
  $('expense-total').textContent = money(expense);
  $('balance-total').textContent = money(income - expense);
  $('transaction-count').textContent = `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`;
  $('empty-state').hidden = rows.length > 0;
  const body = $('transaction-rows');
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    const description = document.createElement('td');
    description.textContent = row.description;
    const category = document.createElement('td');
    category.textContent = row.category;
    const date = document.createElement('td');
    const [year, month, day] = row.transaction_date.split('-');
    date.textContent = `${day}/${month}/${year}`;
    const amount = document.createElement('td');
    amount.className = `right amount ${row.transaction_type === 'receita' ? 'income' : 'expense'}`;
    amount.textContent = `${row.transaction_type === 'receita' ? '+' : '−'} ${money(row.amount)}`;
    const actions = document.createElement('td');
    actions.className = 'right row-actions';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'text-button'; edit.textContent = 'Editar'; edit.setAttribute('aria-label', `Editar ${row.description}, ${money(row.amount)}`); edit.disabled = state.deleting.has(row.id); edit.addEventListener('click', () => openForm(row));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'text-button danger'; remove.textContent = 'Excluir'; remove.setAttribute('aria-label', `Excluir ${row.description}, ${money(row.amount)}`); remove.disabled = state.deleting.has(row.id); remove.addEventListener('click', () => deleteTransaction(row));
    actions.append(edit, remove);
    tr.append(description, category, date, amount, actions);
    body.append(tr);
  }
  const byCategory = new Map();
  for (const row of rows.filter((item) => item.transaction_type === 'despesa')) byCategory.set(row.category, (byCategory.get(row.category) || 0) + Number(row.amount));
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
  const loadId = ++state.loadId;
  const month = $('month').value;
  $('dashboard-view').setAttribute('aria-busy', 'true');
  message('page-message', 'Carregando lançamentos...');
  try {
    const data = await request(`/api/transactions?month=${encodeURIComponent(month)}`);
    if (loadId !== state.loadId || month !== $('month').value) return;
    state.month = month;
    state.transactions = data.transactions;
    $('user-name').textContent = data.user?.name || 'Minha conta';
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
  const body = { transaction_type: $('transaction-type').value, amount: Number($('amount').value), category: $('category').value, description: $('description').value.trim(), transaction_date: $('transaction-date').value };
  if (id) body.id = id;
  const button = $('save-transaction'); button.disabled = true;
  button.textContent = id ? 'Salvando alterações...' : 'Adicionando...';
  try {
    await request('/api/transactions', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    $('transaction-dialog').close();
    const month = body.transaction_date.slice(0, 7);
    if ($('month').value !== month) $('month').value = month;
    await loadTransactions();
    message('page-message', id ? 'Lançamento atualizado.' : 'Lançamento adicionado.');
  } catch (error) { message('form-error', error.message, true); }
  finally { button.disabled = false; button.textContent = id ? 'Salvar alterações' : 'Adicionar lançamento'; }
}

async function deleteTransaction(row) {
  if (state.deleting.has(row.id)) return;
  if (!window.confirm(`Excluir definitivamente “${row.description}” (${money(row.amount)})? Esta ação não pode ser desfeita.`)) return;
  state.deleting.add(row.id);
  render();
  message('page-message', 'Excluindo lançamento...');
  try {
    await request('/api/transactions', { method: 'DELETE', body: JSON.stringify({ id: row.id }) });
    await loadTransactions();
    message('page-message', 'Lançamento excluído.');
  } catch (error) { message('page-message', error.message, true); }
  finally { state.deleting.delete(row.id); render(); }
}

async function init() {
  $('month').value = saoPauloToday().slice(0, 7);
  for (const name of categories) { const option = document.createElement('option'); option.value = name; option.textContent = name; $('category').append(option); }
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault(); message('login-error', '');
    try { await request('/api/session', { method: 'POST', body: JSON.stringify({ password: $('password').value }) }); $('password').value = ''; showDashboard(true); await loadTransactions(); }
    catch (error) { message('login-error', error.message, true); }
  });
  $('logout').addEventListener('click', async () => {
    const button = $('logout'); button.disabled = true;
    try {
      await request('/api/session', { method: 'DELETE' });
      state.loadId++;
      state.transactions = [];
      showDashboard(false);
    } catch (error) { message('page-message', `${error.message} Sua sessão continua aberta.`, true); }
    finally { button.disabled = false; }
  });
  $('month').addEventListener('change', loadTransactions);
  $('new-transaction').addEventListener('click', () => openForm());
  $('transaction-form').addEventListener('submit', saveTransaction);
  $('close-dialog').addEventListener('click', () => $('transaction-dialog').close());
  $('cancel-dialog').addEventListener('click', () => $('transaction-dialog').close());
  try { const session = await request('/api/session'); showDashboard(session.authenticated); if (session.authenticated) await loadTransactions(); }
  catch { showDashboard(false); }
}

init();
