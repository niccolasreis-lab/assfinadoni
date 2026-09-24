import { requireAccount, rpc, send } from '../lib/server.js';
import { requireFeature } from '../lib/flags.js';

export default async function handler(req, res) {
  try {
    requireFeature('ENABLE_INVESTMENTS');
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method !== 'GET') return send(res, 405, { error: 'Método não permitido.' });
    return send(res, 200, { net_worth: await rpc('finance_net_worth', { p_user_id: account.finance_user_id }) });
  } catch (error) { return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' }); }
}

