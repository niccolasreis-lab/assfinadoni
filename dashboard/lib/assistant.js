import { createHash, timingSafeEqual } from 'node:crypto';
import { rpc, uuid } from './server.js';

export const MAX_FILE_BYTES = 3 * 1024 * 1024;
export class AssistantError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = message => { throw new AssistantError(message); };

export function readAssistantBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) fail('Envie JSON.');
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!raw || Buffer.byteLength(raw) > 4200000) fail('O arquivo deve ter no máximo 3 MB.');
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Pedido inválido.');
    return value;
  } catch (error) { if (error instanceof AssistantError) throw error; fail('Pedido inválido.'); }
}

export function sniffFile(bytes) {
  if (bytes.subarray(0,5).toString() === '%PDF-') return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf' };
  if (bytes.subarray(0,4).toString() === 'OggS') return { kind: 'audio', mime: 'audio/ogg', ext: 'ogg' };
  if (bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))) return { kind: 'audio', mime: 'audio/webm', ext: 'webm' };
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WAVE') return { kind: 'audio', mime: 'audio/wav', ext: 'wav' };
  if (bytes.subarray(4,8).toString() === 'ftyp') return { kind: 'audio', mime: 'audio/mp4', ext: 'm4a' };
  if (bytes.subarray(0,3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg', ext: 'mp3' };
  fail('Envie um PDF ou áudio OGG, WebM, MP3, M4A ou WAV.');
}

export function validateAssistantInput(body) {
  let requestId;
  try { requestId = uuid(body.request_id); } catch { fail('Identificador do pedido inválido.'); }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length > 4000) fail('Use até 4.000 caracteres.');
  const payload = { text };
  if (body.action !== undefined) {
    if (!['confirm','cancel'].includes(body.action)) fail('Ação inválida.');
    try { payload.confirmation_id = uuid(body.confirmation_id); } catch { fail('Confirmação inválida.'); }
    payload.action = body.action;
    if (body.file) fail('Confirmação não aceita arquivo.');
  }
  let hash = null;
  if (body.file) {
    const { base64, name } = body.file;
    if (typeof base64 !== 'string' || base64.length > 4 * Math.ceil(MAX_FILE_BYTES / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) fail('Arquivo inválido ou maior que 3 MB.');
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > MAX_FILE_BYTES || bytes.toString('base64') !== base64) fail('Arquivo inválido ou maior que 3 MB.');
    payload.file = { ...sniffFile(bytes), base64, name: String(name || 'Anexo').replace(/[\x00-\x1f]/g,'').slice(0,120) };
    hash = createHash('sha256').update(bytes).digest('hex');
  }
  if (!text && !payload.file && !payload.action) fail('Escreva uma mensagem ou envie um arquivo.');
  return { requestId, payload, hash };
}

export function bridgeAuthenticated(req) {
  const expected = process.env.ASSISTANT_BRIDGE_SECRET;
  const provided = String(req.headers['x-assistant-secret'] || '');
  if (!expected || expected.length < 32 || Buffer.byteLength(provided) !== Buffer.byteLength(expected)) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export function publicJob(job) {
  return { id: job.id, status: job.status, result: job.result || null, created_at: job.created_at };
}

export async function enqueue(account, input, channel = 'dashboard', key = input.requestId) {
  const job = await rpc('finance_assistant_enqueue', { p_user_id: account.finance_user_id, p_account_id: account.id || null,
    p_channel: channel, p_key: key, p_payload: input.payload, p_hash: input.hash });
  return publicJob(job);
}
