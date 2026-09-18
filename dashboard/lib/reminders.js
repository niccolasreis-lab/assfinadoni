import { CATEGORIES, calendarDate, localDate, uuid } from './server.js';

export class ReminderValidationError extends Error {}
const fail = text => { throw new ReminderValidationError(text); };
const fields = ['description','amount','category','due_date','transaction_date','reminder_offsets','reminder_hour','notify_telegram','notify_push'];
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Dados de lembrete inválidos.'); return value; }
export function readReminderBody(req, limit = 12000) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) fail('Envie JSON.');
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!raw || Buffer.byteLength(raw) > limit) fail('Dados de lembrete inválidos.');
    return object(JSON.parse(raw));
  } catch (error) { if (error instanceof ReminderValidationError) throw error; fail('Dados de lembrete inválidos.'); }
}
function validateFields(body) {
  const out = {};
  for (const key of fields) {
    if (!Object.hasOwn(body, key)) continue;
    const value = body[key];
    if (key === 'description') {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 180) fail('Descrição inválida. Use de 1 a 180 caracteres.');
      out[key] = value.trim();
    } else if (key === 'amount') {
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100000000 || Math.abs(Math.round(value * 100) - value * 100) > 0.000001)) fail('Valor inválido. Informe reais com até duas casas decimais.');
      out[key] = value;
    } else if (key === 'category') {
      if (value !== null && !CATEGORIES.includes(value)) fail('Categoria inválida.'); out[key] = value;
    } else if (key.endsWith('_date')) {
      if (value !== null && (typeof value !== 'string' || !calendarDate(value))) fail('Data inválida.'); out[key] = value;
    } else if (key === 'reminder_offsets') {
      if (!Array.isArray(value) || value.length > 3 || value.some(n => ![0,1,3].includes(n)) || new Set(value).size !== value.length) fail('Antecedência inválida. Use 3, 1 e/ou 0 dias.');
      out[key] = [...value].sort((a,b) => b-a);
    } else if (key === 'reminder_hour') {
      if (!Number.isInteger(value) || value < 0 || value > 23) fail('Horário inválido.'); out[key] = value;
    } else { if (typeof value !== 'boolean') fail('Preferência de notificação inválida.'); out[key] = value; }
  }
  return out;
}
export function validateReminderCreate(value, { source = 'web' } = {}) {
  const body = object(value);
  const allowed = [...fields,'kind','external_key'];
  if (Object.keys(body).some(key => !allowed.includes(key))) fail('Campo de lembrete inválido.');
  if (!['bill','review'].includes(body.kind)) fail('Tipo de lembrete inválido.');
  const out = validateFields(body);
  if (!out.description) fail('Informe a descrição.');
  if (body.kind === 'bill' && !out.due_date) fail('Informe o vencimento da conta.');
  if (body.external_key !== undefined && (typeof body.external_key !== 'string' || !body.external_key.trim() || body.external_key.length > 120)) fail('Chave de solicitação inválida.');
  return { ...out, kind: body.kind, source, ...(body.external_key !== undefined ? { external_key: body.external_key } : {}) };
}
export function validateReminderAction(value) {
  const body = object(value);
  if (Object.keys(body).some(key => ![...fields,'id','action'].includes(key))) fail('Campo de lembrete inválido.');
  let id; try { id = uuid(body.id); } catch { fail('Identificador inválido.'); }
  if (!['complete','cancel','update'].includes(body.action)) fail('Ação inválida.');
  const values = validateFields(body);
  if (body.action === 'cancel' && Object.keys(values).length) fail('Cancelar não aceita alterações.');
  if (body.action === 'update' && !Object.keys(values).length) fail('Informe uma alteração.');
  if (body.action === 'complete' && values.transaction_date && values.transaction_date > localDate()) fail('A data da despesa não pode estar no futuro.');
  return { id, action: body.action, values };
}
export function publicReminder(row) {
  if (!row) return null;
  const out = {};
  for (const key of ['id','short_code','kind',...fields,'status','source','completed_transaction_id','created_at','updated_at']) out[key] = row[key] ?? null;
  return out;
}
