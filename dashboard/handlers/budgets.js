import { readBody, requireAccount, rpc, sameOrigin, send, uuid } from '../lib/server.js';
import { requireFeature } from '../lib/flags.js';

export default async function handler(req, res) {
  try {
    requireFeature('ENABLE_BUDGETS');
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method === 'GET') return send(res, 200, { budgets: await rpc('finance_budget_summary', { p_user_id: account.finance_user_id, p_budget_id: req.query?.id ? uuid(req.query.id) : null, p_date_from: req.query?.date_from || null, p_date_to: req.query?.date_to || null }) });
    if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    return send(res, 201, { budget: await rpc('finance_budget_create', { p_user_id: account.finance_user_id, p_values: readBody(req) }) });
  } catch (error) { return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' }); }
}
