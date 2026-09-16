import { randomBytes } from 'node:crypto';
import { authenticated, currentUser, localDate, monthBounds, readBody, sameOrigin, send, supabase, uuid, validatedTransaction } from '../lib/server.js';

const fields = 'id,transaction_type,amount,category,description,transaction_date,created_at';

export default async function handler(req, res) {
  try {
    if (!authenticated(req)) return send(res, 401, { error: 'Faça login para continuar.' });
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
    if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const user = await currentUser();
    if (req.method === 'GET') {
      const month = String(req.query?.month || localDate().slice(0, 7));
      const [start, next] = monthBounds(month);
      const rows = [];
      for (let offset = 0; offset < 5000; offset += 1000) {
        const page = await supabase(`finance_transactions?select=${fields}&user_id=eq.${encodeURIComponent(user.id)}&transaction_date=gte.${start}&transaction_date=lt.${next}&order=transaction_date.desc,created_at.desc&limit=1000&offset=${offset}`);
        if (!Array.isArray(page)) throw new Error('Resposta inesperada do banco de dados.');
        rows.push(...page);
        if (page.length < 1000) return send(res, 200, { month, user: { name: user.name }, transactions: rows });
      }
      return send(res, 413, { error: 'Muitos lançamentos neste mês. Contate o administrador.' });
    }
    const body = readBody(req);
    if (req.method === 'POST') {
      const values = validatedTransaction(body);
      for (let attempt = 0; attempt < 3; attempt++) {
        const messageId = -(1000000000000 + randomBytes(6).readUIntBE(0, 6));
        try {
          const created = await supabase('finance_transactions', { method: 'POST', body: { ...values, user_id: user.id, telegram_message_id: messageId } });
          return send(res, 201, { transaction: created[0] });
        } catch (error) { if (error.code !== '23505' || attempt === 2) throw error; }
      }
    }
    const id = uuid(body.id);
    const filter = `finance_transactions?id=eq.${id}&user_id=eq.${encodeURIComponent(user.id)}&select=${fields}`;
    if (req.method === 'PATCH') {
      const updated = await supabase(filter, { method: 'PATCH', body: validatedTransaction(body) });
      if (!updated?.length) return send(res, 404, { error: 'Lançamento não encontrado.' });
      return send(res, 200, { transaction: updated[0] });
    }
    const deleted = await supabase(filter, { method: 'DELETE' });
    if (!deleted?.length) return send(res, 404, { error: 'Lançamento não encontrado.' });
    return send(res, 200, { deleted: true });
  } catch (error) {
    const status = error.status === 403 ? 403 : /inválid|Informe|Selecione|Descreva|Mês|Envie JSON|Dados inválidos/.test(error.message) ? 400 : 500;
    return send(res, status, { error: status === 500 ? 'Não consegui concluir a operação. Tente novamente.' : error.message });
  }
}
