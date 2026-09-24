import { readBody, requireAccount, rpc, sameOrigin, send } from '../lib/server.js';
import { requireFeature } from '../lib/flags.js';

export default async function handler(req, res) {
  try {
    requireFeature('ENABLE_INVESTMENTS');
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method === 'GET') return send(res, 200, { investments: await rpc('finance_investment_list', { p_user_id: account.finance_user_id }) });
    if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    return send(res, 201, { investment: await rpc('finance_investment_create', { p_user_id: account.finance_user_id, p_values: readBody(req) }) });
  } catch (error) { return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' }); }
}
