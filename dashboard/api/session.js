import { authenticated, clearSession, passwordMatches, readBody, sameOrigin, send, setSession } from '../lib/server.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return send(res, 200, { authenticated: authenticated(req) });
    if (!sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    if (req.method === 'POST') {
      const { password } = readBody(req);
      if (!passwordMatches(password)) return send(res, 401, { error: 'Senha incorreta.' });
      setSession(res);
      return send(res, 200, { authenticated: true });
    }
    if (req.method === 'DELETE') { clearSession(res); return send(res, 200, { authenticated: false }); }
    return send(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    return send(res, error instanceof SyntaxError ? 400 : 500, { error: error.message });
  }
}
