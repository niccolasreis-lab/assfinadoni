import { createHmac, randomBytes, scrypt as cryptoScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

export const CATEGORIES = ['Alimentação', 'Transporte', 'Moradia', 'Saúde', 'Educação', 'Lazer', 'Assinaturas', 'Outros'];
export function validCategoryName(value) { const name = typeof value === 'string' ? value.trim() : ''; return name.length >= 2 && name.length <= 60 && !/[\p{Cc}\p{Cf}]/u.test(name); }
const COOKIE = 'finance_session';
const MAX_AGE = 60 * 60 * 24 * 7;
const scrypt = promisify(cryptoScrypt);
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const DUMMY_PASSWORD_HASH = 'scrypt$16384$8$1$28a6e8a0e641aa622d786051c6c30bbf$542e62a959108f320c986abb634d3408770442aaec5213592d90e0c91f77219d8b447c777811536798e77a2a90a06850393f68a1faece72e239161099b5a1883';

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

export function normalizeUsername(value) {
  const username = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,40}$/.test(username)) throw new Error('Credenciais inválidas.');
  return username;
}

export async function hashPassword(password) {
  const value = String(password || '');
  if (!value) throw new Error('Senha obrigatória.');
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(value, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, encoded = DUMMY_PASSWORD_HASH) {
  try {
    const [algorithm, rawN, rawR, rawP, salt, expected] = String(encoded).split('$');
    if (algorithm !== 'scrypt' || !/^\d+$/.test(rawN) || !/^\d+$/.test(rawR) || !/^\d+$/.test(rawP)
      || !/^[0-9a-f]{32}$/i.test(salt) || !/^[0-9a-f]{128}$/i.test(expected)) return false;
    const options = { N: Number(rawN), r: Number(rawR), p: Number(rawP), maxmem: 32 * 1024 * 1024 };
    if (options.N !== SCRYPT_OPTIONS.N || options.r !== SCRYPT_OPTIONS.r || options.p !== SCRYPT_OPTIONS.p) return false;
    const actual = await scrypt(String(password || ''), salt, SCRYPT_KEY_LENGTH, options);
    return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
  } catch { return false; }
}

export function setSession(res, account) {
  if (!account?.id || !Number.isInteger(Number(account.session_version))) throw new Error('Conta inválida para sessão.');
  const payload = Buffer.from(JSON.stringify({ aid: account.id, v: Number(account.session_version), exp: Date.now() + MAX_AGE * 1000,
    nonce: randomBytes(8).toString('hex') })).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`);
}

export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

export function readSession(req) {
  const raw = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [payload, signature] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !signature || !equal(sign(payload), signature)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!uuidOrNull(session.aid) || !Number.isInteger(session.v) || !Number.isFinite(session.exp) || session.exp <= Date.now()) return null;
    return session;
  } catch { return null; }
}

export async function authenticated(req) {
  const session = readSession(req);
  if (!session) return null;
  const params = new URLSearchParams({ select: 'id,username,display_name,finance_user_id,session_version,active,finance_users(name,telegram_chat_id)', id: `eq.${session.aid}`, active: 'eq.true', limit: '1' });
  const rows = await supabase(`dashboard_accounts?${params}`);
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].active !== true || Number(rows[0].session_version) !== session.v) return null;
  const row = rows[0];
  return { id: row.id, username: row.username, display_name: row.display_name, finance_user_id: row.finance_user_id,
    session_version: Number(row.session_version), telegram_linked: row.finance_users?.telegram_chat_id != null, name: row.finance_users?.name || row.display_name || row.username };
}

export async function requireAccount(req) { return authenticated(req); }

export function publicAccount(account) {
  return { id: account.id, username: account.username, name: account.name || account.display_name || account.username, telegram_linked: Boolean(account.telegram_linked) };
}

export function localDate() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && value <= localDate();
}

export function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function validatedTransaction(input) {
  const transaction_type = String(input.transaction_type || '');
  const amount = Number(input.amount);
  const category = String(input.category || '');
  const description = String(input.description || '').trim();
  const transaction_date = String(input.transaction_date || '');
  if (!['receita', 'despesa'].includes(transaction_type)) throw new Error('Selecione receita ou despesa.');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001) throw new Error('Informe um valor positivo com até duas casas decimais.');
  if (!validCategoryName(category)) throw new Error('Selecione uma categoria válida.');
  if (!description || description.length > 180) throw new Error('Descreva o lançamento em até 180 caracteres.');
  if (!validDate(transaction_date)) throw new Error('Informe uma data válida que não seja futura.');
  const payment_method = String(input.payment_method || 'nao_informado');
  const cash_amount = Number(input.cash_amount || 0);
  const installments = Number(input.installments || 0);
  if (!['nao_informado', 'dinheiro', 'cartao', 'misto'].includes(payment_method)) throw new Error('Forma de pagamento inválida.');
  if (!Number.isFinite(cash_amount) || cash_amount < 0 || cash_amount > amount) throw new Error('Valor em dinheiro inválido.');
  if (!Number.isInteger(installments) || installments < 0 || installments > 120) throw new Error('Número de parcelas inválido.');
  if (payment_method === 'misto' && (cash_amount <= 0 || cash_amount >= amount || installments < 2)) throw new Error('Informe o valor em dinheiro e pelo menos 2 parcelas.');
  if (payment_method === 'cartao' && installments < 1) throw new Error('Informe o número de parcelas.');
  return { transaction_type, amount: amount.toFixed(2), category, description, transaction_date, payment_details: { method: payment_method, cash_amount: cash_amount.toFixed(2), installments } };
}

function config() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || !key) throw new Error('Configuração do Supabase incompleta.');
  return { url, key };
}

export async function supabase(path, options = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: options.method || 'GET',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: options.prefer || 'return=representation' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });
  const value = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error('Falha ao consultar o banco de dados.');
    error.status = response.status;
    error.code = value?.code;
    throw error;
  }
  return value;
}

export async function rpc(name, body) { return supabase(`rpc/${name}`, { method: 'POST', body }); }

export function monthBounds(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mês inválido.');
  const [year, number] = month.split('-').map(Number);
  const next = number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, '0')}-01`;
  return [`${month}-01`, next];
}

function uuidOrNull(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')) ? String(value) : null;
}

export function uuid(value) {
  const parsed = uuidOrNull(value);
  if (!parsed) throw new Error('Lançamento inválido.');
  return parsed;
}
