import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CATEGORIES = ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Outros'];
const COOKIE = 'finance_session';
const MAX_AGE = 60 * 60 * 24 * 7;

export function send(res, status, data) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(data);
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const expected = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
    const parsed = new URL(origin);
    return (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && /^localhost(:\d+)?$/.test(expected))) && parsed.host.toLowerCase() === expected;
  } catch { return false; }
}

export function readBody(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Error('Envie JSON.');
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 4096) throw new Error('Dados inválidos.');
  return body;
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET não configurado.');
  return value;
}

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function equal(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function passwordMatches(value) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected || expected.length < 12) throw new Error('DASHBOARD_PASSWORD não configurada.');
  return equal(createHmac('sha256', secret()).update(String(value)).digest('hex'),
    createHmac('sha256', secret()).update(expected).digest('hex'));
}

export function setSession(res) {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + MAX_AGE * 1000, nonce: randomBytes(8).toString('hex') })).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

export function authenticated(req) {
  const raw = String(req.headers.cookie || '').split(';').map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE}=`));
  if (!raw) return false;
  const [payload, signature] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !signature || !equal(sign(payload), signature)) return false;
  try { return Number(JSON.parse(Buffer.from(payload, 'base64url').toString()).exp) > Date.now(); }
  catch { return false; }
}

export function localDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && value <= localDate();
}

export function validatedTransaction(input) {
  const transaction_type = String(input.transaction_type || '');
  const amount = Number(input.amount);
  const category = String(input.category || '');
  const description = String(input.description || '').trim();
  const transaction_date = String(input.transaction_date || '');
  if (!['receita', 'despesa'].includes(transaction_type)) throw new Error('Selecione receita ou despesa.');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) throw new Error('Informe um valor positivo com até duas casas decimais.');
  if (!CATEGORIES.includes(category)) throw new Error('Selecione uma categoria válida.');
  if (!description || description.length > 180) throw new Error('Descreva o lançamento em até 180 caracteres.');
  if (!validDate(transaction_date)) throw new Error('Informe uma data válida que não seja futura.');
  return { transaction_type, amount: amount.toFixed(2), category, description, transaction_date };
}

function config() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key || !/^-?\d{1,20}$/.test(chatId)) throw new Error('Configuração do Supabase ou Telegram incompleta.');
  return { url, key, chatId };
}

export async function supabase(path, options = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      Prefer: options.prefer || 'return=representation' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Falha ao consultar o banco de dados.');
    error.status = response.status;
    error.code = value?.code;
    throw error;
  }
  return value;
}

export async function currentUser() {
  const { chatId } = config();
  const rows = await supabase(`finance_users?select=id,name&telegram_chat_id=eq.${encodeURIComponent(chatId)}&limit=1`);
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Usuário do Telegram não encontrado no Supabase.');
  return rows[0];
}

export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mês inválido.');
  const [year, number] = month.split('-').map(Number);
  const next = number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, '0')}-01`;
  return [`${month}-01`, next];
}

export function uuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))) throw new Error('Lançamento inválido.');
  return value;
}
