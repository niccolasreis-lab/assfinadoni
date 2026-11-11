const $ = id => document.getElementById(id);
const currency = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const labels = { couple: 'Carteira do casal', mine: 'Minhas finanças', shared: 'Compartilhadas comigo', all: 'Todas as carteiras' };

export function shiftMonth(month, difference) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !Number.isInteger(difference)) return null;
  const [year, number] = month.split('-').map(Number);
  const next = year * 12 + number - 1 + difference;
  if (next < 1900 * 12 || next > 2100 * 12 + 11) return null;
  return `${Math.floor(next / 12)}-${String(next % 12 + 1).padStart(2, '0')}`;
}

// The timer only refreshes visible, authenticated, idle screens. It never sends messages.
export function createRefreshController({ refresh, canRefresh, now = Date.now, interval = 60000 }) {
  let active = false, busy = false, updated = 0, attempted = 0;
  return {
    activate(value) { active = value; if (!value) { busy = false; updated = 0; attempted = 0; } },
    loading() { busy = true; attempted = now(); },
    loaded() { busy = false; updated = now(); },
    failed() { busy = false; },
    async run(force = false) {
      if (!active || busy || !canRefresh() || !force && now() - attempted < interval) return false;
      busy = true; attempted = now();
      try { await refresh(); } finally { busy = false; }
      return true;
    },
    get updated() { return updated; },
  };
}

export function createWorkspaceController(api) {
  let current = null, ticket = 0, timer = null;
  const refresh = createRefreshController({
    refresh: () => api.reload(),
    canRefresh: () => !document.hidden && navigator.onLine !== false && !document.querySelector('dialog[open]') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName),
  });
  function status(text, kind = '') { $('sync-status').textContent = text; $('sync-status').dataset.state = kind; }
  function renderWallet(state) {
    current = state;
    $('wallet-name').textContent = labels[state.scope] || labels.mine;
    $('wallet-description').textContent = { couple: 'Os mesmos lançamentos do seu grupo no WhatsApp.', mine: 'Seu espaço pessoal, separado da carteira do casal.', shared: 'Lançamentos que outras pessoas compartilharam com você.', all: 'Seus registros pessoais e os compartilhados com você.' }[state.scope];
    for (const scope of ['couple', 'mine']) $(`wallet-${scope}`).setAttribute('aria-pressed', String(state.scope === scope));
    $('whatsapp-panel').hidden = state.scope !== 'couple' || state.section !== 'overview';
  }
  async function loadWhatsApp(state) {
    const generation = ++ticket;
    if (state.scope !== 'couple' || state.section !== 'overview' || !state.account) return;
    $('whatsapp-status').textContent = 'Conferindo suas pendências…';
    $('whatsapp-proposals').replaceChildren(); $('whatsapp-retry').hidden = true;
    try {
      const data = await api.request('/api/whatsapp');
      if (generation !== ticket) return;
      $('whatsapp-service').textContent = data.service === 'available' ? 'Bot disponível' : 'Bot sem resposta agora';
      $('whatsapp-service').dataset.state = data.service;
      const total = data.pending_count + data.processing_count;
      $('whatsapp-status').textContent = !data.linked ? 'Seu WhatsApp ainda precisa ser vinculado a esta carteira.' : total
        ? `${data.pending_count} ${data.pending_count === 1 ? 'item aguardando sua confirmação' : 'itens aguardando sua confirmação'}${data.processing_count ? ` · ${data.processing_count} em processamento` : ''}.`
        : 'Tudo em dia. Nenhuma proposta sua aguardando confirmação.';
      for (const row of data.proposals.slice(0, 6)) {
        const item = document.createElement('li');
        const label = document.createElement('span'); label.textContent = row.description;
        const value = document.createElement('strong'); value.textContent = row.amount == null ? 'Confira no grupo' : currency(row.amount);
        const badge = document.createElement('small'); badge.textContent = row.status === 'processing' ? 'Processando' : 'Confirme no grupo';
        item.append(label, value, badge); $('whatsapp-proposals').append(item);
      }
      if (data.proposals.length > 6) {
        const item = document.createElement('li'); item.textContent = `Mais ${data.proposals.length - 6} itens no grupo.`; $('whatsapp-proposals').append(item);
      }
    } catch (error) {
      if (generation !== ticket) return;
      $('whatsapp-service').textContent = 'Consulta indisponível'; $('whatsapp-service').dataset.state = 'unavailable';
      $('whatsapp-status').textContent = error.message; $('whatsapp-retry').hidden = false;
    }
  }
  $('refresh-dashboard').addEventListener('click', () => refresh.run(true));
  for (const [id, delta] of [['previous-month', -1], ['next-month', 1]]) $(id).addEventListener('click', () => {
    const next = shiftMonth($('month').value, delta); if (next) api.month(next);
  });
  for (const scope of ['couple', 'mine']) $(`wallet-${scope}`).addEventListener('click', () => api.scope(scope));
  $('whatsapp-retry').addEventListener('click', () => current && loadWhatsApp(current));
  $('whatsapp-help').addEventListener('click', () => $('whatsapp-guide').showModal());
  $('close-whatsapp-guide').addEventListener('click', () => $('whatsapp-guide').close());
  $('guide-add-expense').addEventListener('click', () => { $('whatsapp-guide').close(); api.add('despesa'); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh.run(); });
  window.addEventListener('focus', () => refresh.run());
  window.addEventListener('offline', () => status('Sem internet. Seus dados serão atualizados ao reconectar.', 'error'));
  window.addEventListener('online', () => refresh.run(true));
  return {
    auth(value) {
      refresh.activate(value); ticket++;
      if (timer) clearInterval(timer);
      timer = value ? setInterval(() => refresh.run(), 15000) : null;
      if (!value) { current = null; $('whatsapp-proposals').replaceChildren(); status('Aguardando atualização'); }
    },
    render: renderWallet,
    loading(state) { ticket++; if (state) renderWallet(state); $('whatsapp-proposals').replaceChildren(); $('whatsapp-status').textContent = 'Conferindo suas pendências…'; refresh.loading(); $('refresh-dashboard').disabled = true; status('Atualizando seus dados…', 'loading'); },
    loaded(state) {
      refresh.loaded(); $('refresh-dashboard').disabled = false;
      const time = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(refresh.updated);
      status(`Dados atualizados às ${time}`, 'ready'); renderWallet(state); loadWhatsApp(state);
    },
    failed() { ticket++; refresh.failed(); $('refresh-dashboard').disabled = false; $('whatsapp-status').textContent = 'Não foi possível atualizar suas pendências.'; $('whatsapp-service').textContent = 'Consulta indisponível'; $('whatsapp-service').dataset.state = 'unavailable'; $('whatsapp-retry').hidden = false; status('Não foi possível atualizar. Tente novamente.', 'error'); },
    navigate(section) { if (current) $('whatsapp-panel').hidden = current.scope !== 'couple' || section !== 'overview'; },
  };
}
