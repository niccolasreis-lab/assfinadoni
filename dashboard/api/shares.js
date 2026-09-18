import { readBody, requireAccount, rpc, sameOrigin, send, uuid } from '../lib/server.js';

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
    if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    if (req.method === 'GET') {
      const rawId = Array.isArray(req.query?.transaction_id) ? null : req.query?.transaction_id;
      const transactionId = rawId ? uuid(rawId) : null;
      const state = await rpc('finance_dashboard_share_state', { p_account_id: account.id, p_transaction_id: transactionId });
      return send(res, 200, state || { candidates: [], share: null });
    }
    const body = readBody(req);
    const transactionId = uuid(body.transaction_id || body.id);
    if (req.method === 'POST') {
      const recipientId = body.recipient_account_id ? uuid(body.recipient_account_id) : null;
      const share = await rpc('finance_dashboard_share_transaction', { p_account_id: account.id, p_transaction_id: transactionId,
        p_recipient_account_id: recipientId });
      if (!share) return send(res, 404, { error: 'Lançamento ou destinatário não encontrado.' });
      return send(res, 201, { share });
    }
    const removed = await rpc('finance_dashboard_unshare_transaction', { p_account_id: account.id, p_transaction_id: transactionId });
    if (!removed) return send(res, 404, { error: 'Compartilhamento não encontrado.' });
    return send(res, 200, { shared: false, transaction_id: transactionId });
  } catch (error) {
    const validation = /inválid|Envie JSON|Dados inválidos/.test(error.message);
    return send(res, validation ? 400 : 500, { error: validation ? error.message : 'Não consegui concluir a operação. Tente novamente.' });
  }
}
