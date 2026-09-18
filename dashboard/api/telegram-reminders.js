import { calendarDate, CATEGORIES, localDate, readBody, rpc, send, supabase } from '../lib/server.js';
import { validateReminderCreate } from '../lib/reminders.js';
import { authenticateNotificationRequest } from '../lib/notifications.js';

export function parseTelegramCommand(text) {
  const match = String(text || '').trim().match(/^\/(lembrete|lembretes|pendencias|pagar|validar|cancelar)(?:@[a-z\d_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const command = match[1].toLowerCase(), args = (match[2] || '').trim();
  if (['lembretes', 'pendencias'].includes(command)) return { command };
  if (command === 'lembrete') {
    const date = args.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(.+)$/s);
    if (!date) throw new Error('Use /lembrete DD/MM/AAAA descrição | valor | categoria.');
    const due_date = `${date[3]}-${date[2]}-${date[1]}`;
    if (!calendarDate(due_date)) throw new Error('Informe uma data válida.');
    const [description, amount, category] = date[4].split('|').map(v => v.trim());
    return { command, values: { kind: 'bill', due_date, description, ...details(amount, category) } };
  }
  const action = args.match(/^([a-f\d]{8})(?:\s+(.+))?$/i);
  if (!action) throw new Error(`Use /${command} CODIGO${command === 'validar' ? ' valor | categoria' : ''}. Consulte os códigos em /pendencias ou /lembretes.`);
  const [amount, category] = (action[2] || '').split('|').map(v => v.trim());
  return { command, code: action[1].toLowerCase(), values: details(amount, category) };
}
function details(amount, category) {
  const values = {};
  if (amount) {
    const raw = String(amount).replace(/^R\$\s*/i, '').trim();
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    if (!/^\d+(\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0 || Number(normalized) > 1e8) throw new Error('Informe um valor válido.');
    values.amount = Number(normalized);
  }
  if (category) {
    const normalized = CATEGORIES.find(c => c.localeCompare(category, 'pt-BR', { sensitivity: 'base' }) === 0);
    if (!normalized) throw new Error(`Categoria inválida. Use: ${CATEGORIES.join(', ')}.`);
    values.category = normalized;
  }
  return values;
}
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'Método não permitido.' });
    if (!await authenticateNotificationRequest(req)) return send(res, 401, { error: 'Não autorizado.' });
    const body = readBody(req);
    if (!/^\d{1,18}$/.test(String(body.chat_id || '')) || !/^\d{1,20}$/.test(String(body.update_id || ''))) return send(res, 400, { error: 'Mensagem privada inválida.' });
    const users = await supabase(`finance_users?${new URLSearchParams({ select: 'id', telegram_chat_id: `eq.${body.chat_id}`, onboarding_state: 'eq.active', limit: '1' })}`);
    if (!users?.[0]) return send(res, 200, { handled: true, text: 'Conclua seu cadastro com /start antes de configurar lembretes.' });
    const owner = users[0].id;
    let parsed;
    try { parsed = parseTelegramCommand(body.text); } catch (error) { return send(res, 200, { handled: true, text: error.message }); }
    if (!parsed && !['review', 'bill'].includes(body.action)) return send(res, 200, { handled: false });
    if (parsed && ['lembretes', 'pendencias'].includes(parsed.command)) {
      const kind = parsed.command === 'pendencias' ? 'review' : 'bill';
      const rows = await supabase(`finance_reminders?${new URLSearchParams({ select: 'short_code,description,due_date', finance_user_id: `eq.${owner}`, kind: `eq.${kind}`, status: 'eq.pending', order: 'created_at.desc', limit: '15' })}`);
      return send(res, 200, { handled: true, text: rows.length ? rows.map(r => `${r.short_code} · ${r.description}${r.due_date ? ` · ${r.due_date.split('-').reverse().join('/')}` : ''}`).join('\n') + (rows.length === 15 ? '\n\nAté 15 itens; veja os demais no painel.' : '') + '\n\n/pagar CODIGO · /validar CODIGO valor | categoria · /cancelar CODIGO' : 'Você não tem itens pendentes nesta lista.' });
    }
    if (parsed?.code) {
      const rows = await supabase(`finance_reminders?${new URLSearchParams({ select: 'id,kind', finance_user_id: `eq.${owner}`, short_code: `eq.${parsed.code}`, limit: '1' })}`);
      if (!rows?.[0]) return send(res, 200, { handled: true, text: 'Código não encontrado na sua conta.' });
      if ((parsed.command === 'pagar' && rows[0].kind !== 'bill') || (parsed.command === 'validar' && rows[0].kind !== 'review')) return send(res, 200, { handled: true, text: 'Use /pagar para contas ou /validar para pendências.' });
      const reminder = await rpc('finance_reminder_action', { p_user_id: owner, p_id: rows[0].id, p_action: parsed.command === 'cancelar' ? 'cancel' : 'complete', p_values: parsed.command === 'cancelar' ? {} : { ...parsed.values, ...(rows[0].kind === 'bill' ? { transaction_date: localDate() } : {}) }, p_account_id: null });
      return send(res, 200, { handled: true, text: reminder ? parsed.command === 'cancelar' ? 'Lembrete cancelado.' : 'Confirmado. Seu lançamento está atualizado no dashboard.' : 'Esse item não está disponível.' });
    }
    const values = parsed?.values || { kind: body.action, description: String(body.description || body.text || '').slice(0, 180), amount: body.amount ?? null, category: body.category || null, due_date: body.due_date || null, transaction_date: body.transaction_date || localDate() };
    if (!parsed && values.kind === 'review') {
      if (typeof values.amount !== 'number' || !Number.isFinite(values.amount) || values.amount <= 0 || values.amount > 1e8) values.amount = null;
      if (!CATEGORIES.includes(values.category)) values.category = null;
      if (!calendarDate(values.transaction_date) || values.transaction_date > localDate()) values.transaction_date = localDate();
    }
    if (!values.description || values.description.length > 180) return send(res, 200, { handled: true, text: 'Informe uma descrição de até 180 caracteres.' });
    const validated = validateReminderCreate({ ...values, external_key: `telegram:${body.chat_id}:${body.update_id}`, notify_telegram: true, notify_push: true }, { source: 'telegram' });
    const reminder = await rpc('finance_reminder_create', { p_user_id: owner, p_values: validated });
    return send(res, 200, { handled: true, text: values.kind === 'bill' ? `Lembrete criado (${reminder.short_code}). Você pode acompanhá-lo no dashboard e confirmar com /pagar ${reminder.short_code}.` : `Salvei uma pendência para você revisar (${reminder.short_code}). ${String(body.question || '').slice(0, 500)}\nRevise no dashboard ou use /validar ${reminder.short_code} valor | categoria.` });
  } catch (error) {
    // SQL validation is authoritative; never echo database errors or descriptions to logs.
    return send(res, 200, { handled: true, text: 'Não consegui concluir. Confira a data, o valor e a categoria e tente novamente. Seus dados permanecem seguros.' });
  }
}
