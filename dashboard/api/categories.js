import { readBody, requireAccount, sameOrigin, send, supabase } from '../lib/server.js';

function cleanName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60 || /[\p{Cc}\p{Cf}]/u.test(name)) throw new Error('Use um nome de categoria entre 2 e 60 caracteres.');
  return name;
}

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    if (req.method === 'GET') {
      const rows = await supabase(`finance_categories?finance_user_id=eq.${account.finance_user_id}&select=id,name,created_at&order=name.asc`);
      return send(res, 200, { categories: Array.isArray(rows) ? rows : [] });
    }
    const body = readBody(req);
    const name = cleanName(body.name);
    const created = await supabase('finance_categories', {
      method: 'POST',
      body: { finance_user_id: account.finance_user_id, name },
      prefer: 'return=representation,resolution=ignore-duplicates',
    });
    const row = Array.isArray(created) ? created[0] : created;
    if (!row) return send(res, 409, { error: 'Essa categoria já existe.' });
    return send(res, 201, { category: row });
  } catch (error) {
    const invalid = /Use um nome|Envie JSON|Dados inválidos/.test(error.message);
    return send(res, invalid ? 400 : error.status === 409 ? 409 : 500, { error: invalid ? error.message : error.status === 409 ? 'Essa categoria já existe.' : 'Não consegui carregar as categorias.' });
  }
}

