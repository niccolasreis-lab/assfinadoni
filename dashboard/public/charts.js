// Pure presentation helpers: only authoritative monthly summaries feed charts.
export const currency = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function monthsEndingAt(month) {
  const [year, number] = month.split('-').map(Number);
  return Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(year, number - 6 + i, 1)).toISOString().slice(0, 7));
}
export function validSummary(summary) {
  return summary && ['income', 'expense', 'balance'].every(key => (typeof summary[key] === 'number' || typeof summary[key] === 'string' && summary[key].trim() !== '') && Number.isFinite(Number(summary[key])));
}
export function comparison(current, previous) {
  if (!validSummary(current) || !validSummary(previous)) return 'Comparação indisponível. Tente carregar o histórico novamente.';
  const delta = Number(current.balance) - Number(previous.balance);
  if (!delta) return 'Saldo igual ao mês anterior.';
  return `${currency(Math.abs(delta))} ${delta > 0 ? 'a mais' : 'a menos'} no saldo em relação ao mês anterior.`;
}
export function historyMarkup(points, width = 800) {
  width = Math.max(280, Math.min(1000, width));
  const peak = Math.max(1, ...points.flatMap(p => p.summary ? [Number(p.summary.income), Number(p.summary.expense)] : []));
  const x = i => 65 + i * (width - 85) / 5;
  const y = value => 178 - Number(value) / peak * 140;
  const label = month => new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`)).replace('.', '');
  let svg = `<svg class="history-svg" viewBox="0 0 ${width} 218" role="img" aria-label="Evolução de receitas e despesas. Valores completos na tabela abaixo.">`;
  for (let i = 0; i < 3; i++) {
    const value = peak * i / 2;
    const text = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    svg += `<path class="chart-grid" d="M65 ${y(value)}H${width - 20}"/><text class="chart-label" x="0" y="${y(value)+4}">R$ ${text}</text>`;
  }
  points.forEach((p, i) => { svg += `<text class="chart-label" text-anchor="middle" x="${x(i)}" y="208">${label(p.month)}</text>`; });
  for (const series of ['income', 'expense']) {
    let path = '', connected = false;
    points.forEach((p, i) => {
      if (!p.summary) { connected = false; return; }
      path += `${connected ? 'L' : 'M'}${x(i)} ${y(p.summary[series])} `; connected = true;
    });
    svg += `<path class="chart-series series-${series}" d="${path}"/>`;
    points.forEach((p, i) => { if (p.summary) svg += `<circle class="chart-dot series-${series}" cx="${x(i)}" cy="${y(p.summary[series])}" r="4"><title>${escapeHTML(p.month)} · ${series === 'income' ? 'Receitas' : 'Despesas'}: ${escapeHTML(currency(p.summary[series]))}</title></circle>`; });
  }
  svg += '</svg>';
  const table = '<table><caption class="sr-only">Valores mensais</caption><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo</th></tr></thead><tbody>' + points.map(p => `<tr><th scope="row">${escapeHTML(p.month.split('-').reverse().join('/'))}</th>${['income','expense','balance'].map(k => `<td>${p.summary ? escapeHTML(currency(p.summary[k])) : 'Indisponível'}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
  return { svg, table };
}
export function categoryMarkup(summary) {
  if (!validSummary(summary)) return '<p class="muted">Resumo indisponível</p>';
  const entries = Object.entries(summary.byCategory || {}).map(([key,value]) => [key, Number(value)]).filter(([,value]) => Number.isFinite(value) && value > 0).sort((a,b) => b[1]-a[1]);
  const total = entries.reduce((sum,[,value]) => sum+value,0);
  if (!total) return '<p class="muted">Sem despesas no período.</p>';
  const colors = ['#a78bfa','#60a5fa','#fbbf24','#2dd4bf'];
  let offset = 0;
  let svg = '<svg viewBox="0 0 160 160" role="img" aria-label="Distribuição de despesas; valores por categoria na lista abaixo.">';
  for (const [index,[name,value]] of entries.entries()) {
    const length = value/total*100;
    svg += `<circle cx="80" cy="80" r="66" fill="none" stroke="${colors[index%4]}" stroke-width="15" pathLength="100" stroke-dasharray="${length} ${100-length}" stroke-dashoffset="${-offset}"><title>${escapeHTML(name)}: ${escapeHTML(currency(value))}</title></circle>`;
    offset += length;
  }
  return svg + `</svg><div class="donut-label"><span>Total de despesas</span><strong>${escapeHTML(currency(total))}</strong></div>`;
}
// In-memory only. Generation guards also invalidate pending requests on logout/mutation.
export function createHistoryLoader(fetchSummary) {
  let generation = 0;
  const cache = new Map();
  return {
    cancel() { generation++; },
    reset() { generation++; cache.clear(); },
    async load({ month, shared, account, summary }) {
      const ticket = ++generation;
      const points = await Promise.all(monthsEndingAt(month).map(async m => {
        if (m === month) return { month:m, summary:validSummary(summary) ? summary : null };
        const key = `${account}:${shared}:${m}`;
        try {
          let value = cache.get(key);
          if (!value) value = await fetchSummary(m, shared);
          if (!validSummary(value)) throw new Error('Resumo indisponível');
          if (ticket === generation) cache.set(key, value);
          return { month:m, summary:value };
        } catch { return { month:m, summary:null }; }
      }));
      return ticket === generation ? points : null;
    },
  };
}
