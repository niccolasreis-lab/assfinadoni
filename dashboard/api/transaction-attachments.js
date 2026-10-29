import { readBody, requireAccount, sameOrigin, send, supabase, uuid } from '../lib/server.js';

async function accessibleTransaction(account, transactionId) {
  const rows = await supabase(`finance_transactions?id=eq.${transactionId}&select=id,user_id&limit=1`);
  const transaction = Array.isArray(rows) ? rows[0] : null;
  if (!transaction) return null;
  if (transaction.user_id === account.finance_user_id) return transaction;
  const shares = await supabase(`finance_transaction_shares?transaction_id=eq.${transactionId}&shared_with_account_id=eq.${account.id}&select=transaction_id&limit=1`);
  if (Array.isArray(shares) && shares.length > 0) return transaction;
  const memberships = await supabase(`finance_dashboard_couple_memberships?account_id=eq.${account.id}&finance_user_id=eq.${transaction.user_id}&select=account_id&limit=1`);
  return Array.isArray(memberships) && memberships.length > 0 ? transaction : null;
}

function validateAttachment(body) {
  const transaction_id = uuid(body.transaction_id);
  const content_type = String(body.content_type || '');
  const filename = String(body.filename || '').trim().slice(0, 180);
  const data_url = String(body.data_url || '');
  if (!/^(?:image\/(jpeg|png|webp)|application\/pdf)$/.test(content_type)) throw new Error('Envie um comprovante PDF, JPG, PNG ou WebP.');
  if (!filename || filename.length > 180) throw new Error('Nome de arquivo inválido.');
  const match = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data_url);
  if (!match || match[1] !== content_type || data_url.length > 1400000) throw new Error('O comprovante deve ter até 1 MB e um tipo válido.');
  if (content_type === 'application/pdf' && !Buffer.from(match[2], 'base64').subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('PDF inválido.');
  return { transaction_id, content_type, filename, data_url };
}

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const body = req.method === 'POST' ? readBody(req, 1404096) : null;
    const id = uuid(req.query?.transaction_id || body?.transaction_id || '');
    const transaction = await accessibleTransaction(account, id);
    if (!transaction) return send(res, 404, { error: 'Lançamento não encontrado.' });
    if (req.method === 'GET') {
      const rows = await supabase(`finance_transaction_attachments?transaction_id=eq.${id}&select=id,transaction_id,filename,content_type,data_url,created_at&order=created_at.desc`);
      return send(res, 200, { attachments: Array.isArray(rows) ? rows : [] });
    }
    const values = validateAttachment(body);
    const created = await supabase('finance_transaction_attachments', {
      method: 'POST',
      body: { ...values, finance_user_id: transaction.user_id },
      prefer: 'return=representation',
    });
    return send(res, 201, { attachment: Array.isArray(created) ? created[0] : created });
  } catch (error) {
    const invalid = /Envie um comprovante|Nome de arquivo|O comprovante|inválid|Dados inválidos|Envie JSON/.test(error.message);
    return send(res, invalid ? 400 : 500, { error: invalid ? error.message : 'Não consegui acessar o comprovante.' });
  }
}

