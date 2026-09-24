import { readBody, requireAccount, rpc, sameOrigin, send, uuid } from '../lib/server.js';
import { requireFeature } from '../lib/flags.js';

export default async function handler(req, res) {
  try {
    requireFeature('ENABLE_GOALS');
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method === 'GET') return send(res, 200, { goals: await rpc('finance_goal_list', { p_user_id: account.finance_user_id }) });
    if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const values = readBody(req);
    if (values.action === 'contribute') {
      return send(res, 201, { contribution: await rpc('finance_goal_contribute', { p_user_id: account.finance_user_id, p_goal_id: uuid(values.goal_id), p_values: values, p_account_id: account.id }) });
    }
    return send(res, 201, { goal: await rpc('finance_goal_create', { p_user_id: account.finance_user_id, p_values: values }) });
  } catch (error) { return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' }); }
}
