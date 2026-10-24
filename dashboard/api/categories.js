import { readBody, requireAccount, sameOrigin, send, supabase } from '../lib/server.js';

function cleanName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N}][\p{L}\p{N} &'’()./-]{1,59}$/u.test(name)) throw new Error('Use um nome de categoria entre 2 e 60 caracteres.');
  return name;
}

const walletId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
// Options retain the actual label because transaction filters use exact equality.
const nameKey = value => value.normalize('NFC');

async function visibleCategories(account) {
  const own = walletId(account.finance_user_id), accountId = walletId(account.id);
  if (!own || !accountId) throw new Error('Escopo de categorias indisponível.');
  const membershipParams = new URLSearchParams({ account_id: `eq.${accountId}`, select: 'account_id,finance_user_id', order: 'finance_user_id.asc' });
  const memberships = await supabase(`finance_dashboard_couple_memberships?${membershipParams}`);
  if (!Array.isArray(memberships)) throw new Error('Associações de categorias indisponíveis.');
  const shared = memberships.filter(row => walletId(row?.account_id) === accountId).map(row => walletId(row.finance_user_id)).filter(Boolean).sort();
  const wallets = [...new Set([own, ...shared])];
  const allowed = new Set(wallets), priority = new Map(wallets.map((id, index) => [id, index]));
  const params = new URLSearchParams({ finance_user_id: `in.(${wallets.join(',')})`, select: 'id,name,created_at,finance_user_id', order: 'name.asc,id.asc' });
  const rows = await supabase(`finance_categories?${params}`);
  if (!Array.isArray(rows)) throw new Error('Categorias indisponíveis.');
  const scoped = rows.filter(row => allowed.has(walletId(row?.finance_user_id)) && walletId(row?.id)).map(row => {
    try {
      if (typeof row.name !== 'string') return null;
      cleanName(row.name.normalize('NFC'));
      return { ...row, wallet: walletId(row.finance_user_id) };
    }
    catch { return null; }
  }).filter(Boolean).sort((a, b) => priority.get(a.wallet) - priority.get(b.wallet) || a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
  const canonical = new Map();
  for (const row of scoped) {
    const key = nameKey(row.name);
    if (!canonical.has(key)) canonical.set(key, { id: row.id, name: row.name, created_at: row.created_at });
  }
  return [...canonical.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }) || a.name.localeCompare(b.name));
}

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    if (req.method === 'GET') {
      return send(res, 200, { categories: await visibleCategories(account) });
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
