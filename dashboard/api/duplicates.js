import { requireAccount, rpc, sameOrigin, send, uuid } from '../lib/server.js';

const statuses = new Set(['open', 'confirmed', 'ignored', 'merged']);
const actions = new Set(['confirm', 'ignore', 'merge']);

function integer(value, fallback = 50) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) throw new Error('Limite inválido.');
  return parsed;
}

function body(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Error('Envie JSON.');
  const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Dados inválidos.');
  return parsed;
}

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method === 'GET') {
      const status = req.query?.status == null ? 'open' : String(req.query.status);
      if (!statuses.has(status)) return send(res, 400, { error: 'Status inválido.' });
      const rows = await rpc('finance_duplicate_candidates', {
        p_user_id: account.finance_user_id,
        p_status: status,
        p_limit: integer(req.query?.limit),
      });
      return send(res, 200, { duplicates: Array.isArray(rows) ? rows : [] });
    }
    if (req.method !== 'PATCH') return send(res, 405, { error: 'Método não permitido.' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const input = body(req);
    const id = uuid(input.id);
    const action = String(input.action || '');
    if (!actions.has(action)) return send(res, 400, { error: 'Ação inválida.' });
    const duplicate = await rpc('finance_duplicate_resolve', {
      p_user_id: account.finance_user_id,
      p_account_id: account.id,
      p_duplicate_id: id,
      p_action: action,
    });
    if (!duplicate) return send(res, 404, { error: 'Duplicidade não encontrada.' });
    return send(res, 200, { duplicate });
  } catch (error) {
    return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' });
  }
}

