import { readBody, requireAccount, sameOrigin, send, supabase, uuid } from '../lib/server.js';

async function canAccess(account, transactionId) {
  const rows = await supabase(`finance_transactions?id=eq.${transactionId}&select=id,user_id&limit=1`);
  const transaction = Array.isArray(rows) ? rows[0] : null;
  if (!transaction) return false;
  if (transaction.user_id === account.finance_user_id) return true;
  const shares = await supabase(`finance_transaction_shares?transaction_id=eq.${transactionId}&shared_with_account_id=eq.${account.id}&select=transaction_id&limit=1`);
  return Array.isArray(shares) && shares.length > 0;
}

function validateAttachment(body) {
  const transaction_id = uuid(body.transaction_id);
  const content_type = String(body.content_type || '');
  const filename = String(body.filename || '').trim().slice(0, 180);
  const data_url = String(body.data_url || '');
  if (!/^(image/jpeg|image/png|image/webp)$/.test(content_type)) throw new Error('Envie uma imagem JPG, PNG ou WebP.');
  if (!filename || filename.length > 180) throw new Error('Nome de arquivo inválido.');
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(data_url) || data_url.length > 1400000) throw new Error('A imagem deve ter até 1 MB.');
  return { transaction_id, content_type, filename, data_url };
}

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const id = uuid(req.query?.transaction_id || (req.method === 'POST' ? req.body?.transaction_id : ''));
    if (!(await canAccess(account, id))) return send(res, 404, { error: 'Lançamento não encontrado.' });
    if (req.method === 'GET') {
      const rows = await supabase(`finance_transaction_attachments?transaction_id=eq.${id}&select=id,transaction_id,filename,content_type,data_url,created_at&order=created_at.desc`);
      return send(res, 200, { attachments: Array.isArray(rows) ? rows : [] });
    }
    const body = readBody(req);
    const values = validateAttachment(body);
    const created = await supabase('finance_transaction_attachments', {
      method: 'POST',
      body: { ...values, finance_user_id: account.finance_user_id },
      prefer: 'return=representation',
    });
    return send(res, 201, { attachment: Array.isArray(created) ? created[0] : created });
  } catch (error) {
    const invalid = /Envie uma imagem|Nome de arquivo|A imagem|inválid|Dados inválidos|Envie JSON/.test(error.message);
    return send(res, invalid ? 400 : 500, { error: invalid ? error.message : 'Não consegui salvar a imagem.' });
  }
}
