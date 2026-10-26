import { authenticated, clearSession, normalizeUsername, publicAccount, readBody, rpc, sameOrigin, send, setSession, supabase, verifyPassword } from '../lib/server.js';

const invalidCredentials = 'Usuário ou senha inválidos.';

function loginIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || String(req.socket?.remoteAddress || '')).slice(0, 80);
}

export default async function handler(req, res) {
  let stage = 'request';
  try {
    if (req.method === 'GET') {
      const account = await authenticated(req);
      return send(res, 200, account ? { authenticated: true, account: publicAccount(account) } : { authenticated: false });
    }
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    if (req.method === 'POST') {
      const body = readBody(req);
      let username;
      try { username = normalizeUsername(body.username); }
      catch { username = `invalid_${Buffer.from(String(body.username || '')).toString('hex').slice(0, 20)}`; }
      const params = new URLSearchParams({ select: 'id,username,display_name,password_hash,finance_user_id,session_version,active,locked_until,finance_users!dashboard_accounts_finance_user_id_fkey(name,telegram_chat_id)', username: `eq.${username}`, limit: '1' });
      stage = 'account_lookup';
      const rows = /^[a-z0-9_]{3,40}$/.test(username) ? await supabase(`dashboard_accounts?${params}`) : [];
      const account = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
      stage = 'password_verification';
      const passwordOk = await verifyPassword(body.password, account?.password_hash);
      const locked = account?.locked_until && new Date(account.locked_until).getTime() > Date.now();
      if (!account || !account.active || locked || !passwordOk) {
        stage = 'record_login_failure';
        await rpc('finance_dashboard_record_login_failure', { p_username: username, p_ip: loginIp(req) });
        return send(res, 401, { error: invalidCredentials });
      }
      stage = 'clear_login_failures';
      await rpc('finance_dashboard_clear_login_failures', { p_account_id: account.id });
      const sessionAccount = { ...account, telegram_linked: account.finance_users?.telegram_chat_id != null, name: account.finance_users?.name || account.display_name || account.username };
      stage = 'issue_session';
      setSession(res, sessionAccount);
      return send(res, 200, { authenticated: true, account: publicAccount(sessionAccount) });
    }
    if (req.method === 'DELETE') {
      clearSession(res);
      return send(res, 200, { authenticated: false });
    }
    return send(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    console.error('finance_session_error', {
      stage, code: error.code || null, status: error.status || null,
      config: {
        database_url_valid: /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(String(process.env.SUPABASE_URL || '')),
        database_key_present: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
        session_secret_valid: String(process.env.SESSION_SECRET || '').length >= 32,
      },
    });
    return send(res, error instanceof SyntaxError || /Dados inválidos|Envie JSON/.test(error.message) ? 400 : 500,
      { error: error instanceof SyntaxError ? 'Dados inválidos.' : /Dados inválidos|Envie JSON/.test(error.message) ? error.message : 'Não consegui concluir o login. Tente novamente.' });
  }
}
