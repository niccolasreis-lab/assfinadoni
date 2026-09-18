import { publicAccount, requireAccount, sameOrigin, send, supabase } from '../lib/server.js';
import { ProfileValidationError, publicProfile, readProfilePatch } from '../lib/profile.js';

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (!['GET', 'PATCH'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
    if (req.method === 'PATCH' && !sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    // The authenticated session is the only source of the account identifier.
    const params = new URLSearchParams({ select: 'display_name,avatar_data_url', id: `eq.${account.id}` });
    const path = `dashboard_accounts?${params}`;
    let rows;
    if (req.method === 'PATCH') {
      const patch = readProfilePatch(req);
      rows = await supabase(path, { method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=representation' });
      if (rows === null) rows = await supabase(path);
    } else rows = await supabase(path);
    if (!Array.isArray(rows) || rows.length !== 1) return send(res, 404, { error: 'Perfil não encontrado.' });
    const profile = publicProfile(rows[0], account);
    return send(res, 200, { profile, account: { ...publicAccount(account), display_name: profile.display_name } });
  } catch (error) {
    const invalid = error instanceof ProfileValidationError;
    return send(res, invalid ? 400 : 500, { error: invalid ? error.message : 'Não consegui carregar ou salvar seu perfil. Tente novamente.' });
  }
}
