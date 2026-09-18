import { calendarDate, CATEGORIES, localDate, monthBounds, publicAccount, readBody, requireAccount, rpc, sameOrigin, send, uuid, validatedTransaction } from '../lib/server.js';

const pageSize = 50;

function queryValue(value, name) {
  if (Array.isArray(value) || (value !== undefined && typeof value !== 'string')) throw new Error(`${name} inválido.`);
  return value;
}

function listOptions(query) {
  const view = queryValue(query.view, 'Visão') || 'active';
  if (!['active', 'trash'].includes(view)) throw new Error('Visão inválida.');
  const scope = queryValue(query.scope, 'Escopo') || 'mine';
  if (!['mine', 'shared', 'all'].includes(scope)) throw new Error('Escopo inválido.');
  const rawPage = queryValue(query.page, 'Página') || '1';
  if (!/^[1-9]\d{0,3}$/.test(rawPage)) throw new Error('Página inválida.');
  const q = (queryValue(query.q, 'Busca') || '').trim();
  if (q.length > 120) throw new Error('Busca inválida.');
  const category = queryValue(query.category, 'Categoria') || '';
  if (category && !CATEGORIES.includes(category)) throw new Error('Categoria inválida.');
  const type = queryValue(query.type, 'Tipo') || '';
  if (type && !['receita', 'despesa'].includes(type)) throw new Error('Tipo inválido.');
  const from = queryValue(query.date_from, 'Data inicial') || '';
  const to = queryValue(query.date_to, 'Data final') || '';
  if ((from && !calendarDate(from)) || (to && !calendarDate(to)) || (from && to && from > to)) throw new Error('Intervalo de datas inválido.');
  const includeShared = (queryValue(query.include_shared_summary, 'Resumo compartilhado') || 'false') === 'true';
  if (!['true', 'false', undefined].includes(query.include_shared_summary)) throw new Error('Resumo compartilhado inválido.');
  return { view, scope, page: Number(rawPage), q, category, type, from, to, includeShared };
}

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
    if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    if (req.method === 'GET') {
      const month = String(req.query?.month || localDate().slice(0, 7));
      const [monthStart, monthEnd] = monthBounds(month);
      const options = listOptions(req.query || {});
      let from = options.from || null;
      let to = options.to || null;
      if (options.view === 'active' && !from && !to) {
        from = monthStart;
        const end = new Date(`${monthEnd}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() - 1);
        to = end.toISOString().slice(0, 10);
      }
      const result = await rpc('finance_dashboard_list_transactions', {
        p_account_id: account.id, p_scope: options.scope, p_view: options.view, p_search: options.q || null,
        p_category: options.category || null, p_type: options.type || null, p_date_from: from, p_date_to: to,
        p_page: options.page, p_page_size: pageSize,
      });
      const summary = await rpc('finance_dashboard_monthly_summary', {
        p_account_id: account.id, p_month_start: monthStart, p_month_end: monthEnd, p_include_shared: options.includeShared,
      });
      const transactions = Array.isArray(result?.transactions) ? result.transactions : [];
      return send(res, 200, { month, user: { name: account.name, username: account.username }, account: publicAccount(account),
        scope: options.scope, include_shared_summary: options.includeShared, transactions,
        pagination: { page: options.page, pageSize, hasMore: Boolean(result?.has_more) },
        summary: summary || { income: 0, expense: 0, balance: 0, byCategory: {} } });
    }
    const body = readBody(req);
    if (req.method === 'POST') {
      const values = validatedTransaction(body);
      const created = await rpc('finance_dashboard_create_transaction', { p_account_id: account.id, p_transaction_type: values.transaction_type,
        p_amount: values.amount, p_category: values.category, p_description: values.description, p_transaction_date: values.transaction_date });
      if (!created) throw new Error('Não foi possível criar o lançamento.');
      return send(res, 201, { transaction: created });
    }
    const id = uuid(body.id);
    if (req.method === 'PATCH') {
      if (body.action === 'restore') {
        const restored = await rpc('finance_dashboard_restore_transaction', { p_account_id: account.id, p_transaction_id: id });
        if (!restored) return send(res, 404, { error: 'Lançamento não encontrado ou prazo de restauração encerrado.' });
        return send(res, 200, { transaction: restored });
      }
      const values = validatedTransaction(body);
      const updated = await rpc('finance_dashboard_update_transaction', { p_account_id: account.id, p_transaction_id: id,
        p_transaction_type: values.transaction_type, p_amount: values.amount, p_category: values.category,
        p_description: values.description, p_transaction_date: values.transaction_date });
      if (!updated) return send(res, 404, { error: 'Lançamento não encontrado.' });
      return send(res, 200, { transaction: updated });
    }
    const deleted = await rpc('finance_dashboard_delete_transaction', { p_account_id: account.id, p_transaction_id: id });
    if (!deleted) return send(res, 404, { error: 'Lançamento não encontrado.' });
    return send(res, 200, { deleted: true, transaction: deleted });
  } catch (error) {
    const validation = /inválid|Informe|Selecione|Descreva|Mês|Visão|Escopo|Página|Busca|Categoria|Tipo|Intervalo|Resumo|Envie JSON|Dados inválidos/.test(error.message);
    return send(res, error.status === 403 ? 403 : validation ? 400 : 500,
      { error: validation ? error.message : 'Não consegui concluir a operação. Tente novamente.' });
  }
}
