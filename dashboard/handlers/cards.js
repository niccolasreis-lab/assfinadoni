import { readBody, requireAccount, rpc, sameOrigin, send } from '../lib/server.js';

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method === 'GET') {
      const scope = req.query?.scope ?? 'mine';
      if (!['mine', 'couple', 'all'].includes(scope)) return send(res, 400, { error: 'Escopo inválido.' });
      return send(res, 200, { cards: await rpc('finance_dashboard_card_list', { p_account_id: account.id, p_scope: scope }) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const created = await rpc('finance_card_create', { p_user_id: account.finance_user_id, p_values: readBody(req) });
    return send(res, 201, { card: created });
  } catch (error) { return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' }); }
}
