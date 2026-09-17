import { randomBytes } from 'node:crypto';
import { authenticated, calendarDate, CATEGORIES, currentUser, localDate, monthBounds, readBody, sameOrigin, send, supabase, uuid, validatedTransaction } from '../lib/server.js';

const fields = 'id,transaction_type,amount,category,description,transaction_date,created_at,deleted_at';
const pageSize = 50;
const restoreWindowMs = 30 * 24 * 60 * 60 * 1000;

function queryValue(value, name) {
  if (Array.isArray(value) || (value !== undefined && typeof value !== 'string')) throw new Error(`${name} inválido.`);
  return value;
}

function listOptions(query, month, userId) {
  const view = queryValue(query.view, 'Visão') || 'active';
  if (!['active', 'trash'].includes(view)) throw new Error('Visão inválida.');
  const rawPage = queryValue(query.page, 'Página') || '1';
  if (!/^[1-9]\d{0,3}$/.test(rawPage)) throw new Error('Página inválida.');
  const page = Number(rawPage);
  const params = new URLSearchParams({ select: fields, user_id: `eq.${userId}` });
  if (view === 'trash') {
    params.set('deleted_at', `gte.${new Date(Date.now() - restoreWindowMs).toISOString()}`);
    params.set('order', 'deleted_at.desc,id.desc');
  } else {
    params.set('deleted_at', 'is.null');
    const q = (queryValue(query.q, 'Busca') || '').trim();
    if (q.length > 120) throw new Error('Busca inválida.');
    if (q) {
      const escaped = q.replace(/[\\"%_*]/g, '\\$&');
      params.set('description', `ilike.%${escaped}%`);
    }
    const category = queryValue(query.category, 'Categoria') || '';
    if (category) {
      if (!CATEGORIES.includes(category)) throw new Error('Categoria inválida.');
      params.set('category', `eq.${category}`);
    }
    const type = queryValue(query.type, 'Tipo') || '';
    if (type) {
      if (!['receita', 'despesa'].includes(type)) throw new Error('Tipo inválido.');
      params.set('transaction_type', `eq.${type}`);
    }
    const from = queryValue(query.date_from, 'Data inicial') || '';
    const to = queryValue(query.date_to, 'Data final') || '';
    if ((from && !calendarDate(from)) || (to && !calendarDate(to)) || (from && to && from > to)) throw new Error('Intervalo de datas inválido.');
    if (from || to) {
      if (from) params.append('transaction_date', `gte.${from}`);
      if (to) params.append('transaction_date', `lte.${to}`);
    } else {
      const [start, next] = monthBounds(month);
      params.append('transaction_date', `gte.${start}`);
      params.append('transaction_date', `lt.${next}`);
    }
    params.set('order', 'transaction_date.desc,created_at.desc,id.desc');
  }
  params.set('limit', String(pageSize + 1));
  params.set('offset', String((page - 1) * pageSize));
  return { view, page, params };
}

async function monthlySummary(month, userId) {
  const [start, next] = monthBounds(month);
  const params = new URLSearchParams({ select: 'transaction_type,amount,category', user_id: `eq.${userId}`, deleted_at: 'is.null', order: 'id.asc' });
  params.append('transaction_date', `gte.${start}`);
  params.append('transaction_date', `lt.${next}`);
  let income = 0;
  let expense = 0;
  const byCategory = {};
  for (let offset = 0; offset < 100000; offset += 1000) {
    params.set('limit', '1000');
    params.set('offset', String(offset));
    const rows = await supabase(`finance_transactions?${params}`);
    if (!Array.isArray(rows)) throw new Error('Resposta inesperada do banco de dados.');
    for (const row of rows) {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) throw new Error('Valor inválido recebido do banco de dados.');
      if (row.transaction_type === 'receita') income += amount;
      else if (row.transaction_type === 'despesa') {
        expense += amount;
        byCategory[row.category] = (byCategory[row.category] || 0) + amount;
      }
    }
    if (rows.length < 1000) return { income, expense, balance: income - expense, byCategory };
  }
  throw new Error('Muitos lançamentos neste mês.');
}

export default async function handler(req, res) {
  try {
    if (!authenticated(req)) return send(res, 401, { error: 'Faça login para continuar.' });
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
    if (req.method !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Origem não autorizada.' });
    const user = await currentUser();
    if (req.method === 'GET') {
      const month = String(req.query?.month || localDate().slice(0, 7));
      monthBounds(month);
      const { view, page, params } = listOptions(req.query || {}, month, user.id);
      const rows = await supabase(`finance_transactions?${params}`);
      if (!Array.isArray(rows)) throw new Error('Resposta inesperada do banco de dados.');
      const summary = await monthlySummary(month, user.id);
      return send(res, 200, { month, user: { name: user.name }, transactions: rows.slice(0, pageSize),
        pagination: { page, pageSize, hasMore: rows.length > pageSize }, summary });
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
      if (body.action === 'restore') {
        const cutoff = new Date(Date.now() - restoreWindowMs).toISOString();
        const restored = await supabase(`${filter}&deleted_at=gte.${encodeURIComponent(cutoff)}`, { method: 'PATCH', body: { deleted_at: null } });
        if (!restored?.length) return send(res, 404, { error: 'Lançamento não encontrado ou prazo de restauração encerrado.' });
        return send(res, 200, { transaction: restored[0] });
      }
      const updated = await supabase(`${filter}&deleted_at=is.null`, { method: 'PATCH', body: validatedTransaction(body) });
      if (!updated?.length) return send(res, 404, { error: 'Lançamento não encontrado.' });
      return send(res, 200, { transaction: updated[0] });
    }
    const deleted = await supabase(`${filter}&deleted_at=is.null`, { method: 'PATCH', body: { deleted_at: new Date().toISOString() } });
    if (!deleted?.length) return send(res, 404, { error: 'Lançamento não encontrado.' });
    return send(res, 200, { deleted: true, transaction: deleted[0] });
  } catch (error) {
    const status = error.status === 403 ? 403 : /inválid|Informe|Selecione|Descreva|Mês|Visão|Página|Busca|Categoria|Tipo|Intervalo|Envie JSON|Dados inválidos/.test(error.message) ? 400 : 500;
    return send(res, status, { error: status === 500 ? 'Não consegui concluir a operação. Tente novamente.' : error.message });
  }
}
