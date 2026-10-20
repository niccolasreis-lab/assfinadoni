import { calendarDate, localDate, publicAccount, requireAccount, rpc, send, validCategoryName } from '../lib/server.js';

// This view never accepts an owner/account ID from the browser and performs no writes.
export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method !== 'GET') return send(res, 405, { error: 'A visão Casal é somente para consulta. Use o WhatsApp para alterar esses lançamentos.' });
    const query = req.query || {};
    const value = (key, fallback = '') => {
      if (query[key] !== undefined && typeof query[key] !== 'string') throw new Error('Filtro inválido.');
      return query[key] ?? fallback;
    };
    const month = value('month', localDate().slice(0, 7));
    const page = value('page', '1'); const view = value('view', 'active');
    const q = value('q').trim(); const category = value('category'); const type = value('type');
    const from = value('date_from'); const to = value('date_to');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^[1-9]\d{0,3}$/.test(page)
      || !['active', 'trash'].includes(view) || q.length > 120 || category && !validCategoryName(category)
      || type && !['receita', 'despesa'].includes(type) || from && !calendarDate(from)
      || to && !calendarDate(to) || from && to && from > to) throw new Error('Filtro inválido.');
    const result = await rpc('finance_dashboard_couple_transactions', { p_account_id: account.id,
      p_values: { month, page: Number(page), view, q, category, type, date_from: from, date_to: to } });
    return send(res, 200, { ...result, month, account: publicAccount(account) });
  } catch (error) {
    if (error.code === '42501') return send(res, 403, { error: 'Sua conta ainda não tem acesso à carteira do casal.' });
    const validation = /inválid/.test(error.message);
    return send(res, validation ? 400 : 500, { error: validation ? error.message : 'Não consegui carregar a carteira do casal. Tente novamente.' });
  }
}
