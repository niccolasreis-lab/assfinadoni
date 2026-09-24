import { requireAccount, rpc, send } from '../lib/server.js';

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method !== 'GET') return send(res, 405, { error: 'Método não permitido.' });
    return send(res, 200, { subscriptions: await rpc('finance_subscription_list', { p_user_id: account.finance_user_id }) });
  } catch (error) { return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' }); }
}

