import { readBody, requireAccount, rpc, sameOrigin, send, uuid } from '../lib/server.js';
import { requireFeature } from '../lib/flags.js';

export default async function handler(req, res) {
  try {
    requireFeature('ENABLE_SMART_ALERTS');
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method === 'GET') return send(res, 200, { alerts: await rpc('finance_alert_list', { p_user_id: account.finance_user_id, p_status: req.query?.status || 'open', p_limit: Number(req.query?.limit || 50) }) });
    if (req.method !== 'PATCH') return send(res, 405, { error: 'Método não permitido.' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const id = uuid(readBody(req).id);
    const alert = await rpc('finance_alert_dismiss', { p_user_id: account.finance_user_id, p_alert_id: id, p_account_id: account.id });
    return alert ? send(res, 200, { alert }) : send(res, 404, { error: 'Alerta não encontrado.' });
  } catch (error) { return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' }); }
}
