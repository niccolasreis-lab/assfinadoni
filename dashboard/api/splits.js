import { readBody, requireAccount, rpc, sameOrigin, send, uuid } from '../lib/server.js';

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method !== 'PATCH') return send(res, 405, { error: 'Método não permitido.' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const input = readBody(req);
    const transactionId = uuid(input.transaction_id);
    if (!Array.isArray(input.splits)) return send(res, 400, { error: 'Informe as formas de pagamento.' });
    const splits = await rpc('finance_transaction_splits_replace', {
      p_user_id: account.finance_user_id,
      p_transaction_id: transactionId,
      p_splits: input.splits,
      p_account_id: account.id,
    });
    if (!splits) return send(res, 404, { error: 'Lançamento não encontrado.' });
    return send(res, 200, { splits });
  } catch (error) { return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' }); }
}

