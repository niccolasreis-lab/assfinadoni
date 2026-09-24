import { requireAccount, rpc, send } from '../lib/server.js';

function csv(rows) {
  const columns = ['transaction_date', 'transaction_type', 'amount', 'category', 'description'];
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.join(','), ...rows.map((row) => columns.map((key) => quote(row[key])).join(','))].join('\n');
}

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method !== 'GET') return send(res, 405, { error: 'Método não permitido.' });
    const rows = await rpc('finance_transactions_query', { p_user_id: account.finance_user_id, p_date_from: req.query?.date_from || null, p_date_to: req.query?.date_to || null, p_limit: 500 });
    if (String(req.query?.format || 'json').toLowerCase() === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="assfinadoni-relatorio.csv"');
      return res.status(200).send(`\ufeff${csv(rows)}`);
    }
    const summary = await rpc('finance_balance_summary', { p_user_id: account.finance_user_id, p_date_from: req.query?.date_from || null, p_date_to: req.query?.date_to || null });
    return send(res, 200, { summary, transactions: rows });
  } catch (error) { return send(res, error.status || 400, { error: error.message || 'Pedido inválido.' }); }
}
