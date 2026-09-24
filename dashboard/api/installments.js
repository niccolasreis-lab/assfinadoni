import { readBody, requireAccount, rpc, sameOrigin, send, uuid } from '../lib/server.js';

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method === 'GET') {
      let planId = null;
      if (req.query?.plan_id) planId = uuid(req.query.plan_id);
      return send(res, 200, { installments: await rpc('finance_installment_list', { p_user_id: account.finance_user_id, p_plan_id: planId }) });
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const plan = await rpc('finance_installment_plan_create', { p_user_id: account.finance_user_id, p_values: readBody(req), p_account_id: account.id });
    return send(res, 201, plan);
  } catch (error) { return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' }); }
}
