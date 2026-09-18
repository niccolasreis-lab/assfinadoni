const MAX_BODY_BYTES = 150000;
const MAX_AVATAR_LENGTH = 140000;

export class ProfileValidationError extends Error {}

export function validAvatar(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > MAX_AVATAR_LENGTH || !value.startsWith('data:image/jpeg;base64,')) return false;
  const base64 = value.slice('data:image/jpeg;base64,'.length);
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return false;
  const bytes = Buffer.from(base64, 'base64');
  return bytes.length >= 5 && bytes.toString('base64') === base64 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
}

export function readProfilePatch(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw new ProfileValidationError('Envie JSON.');
  let body;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw new Error();
    body = JSON.parse(raw);
  } catch { throw new ProfileValidationError('Dados de perfil inválidos ou muito grandes.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProfileValidationError('Dados de perfil inválidos.');
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !['display_name', 'avatar_data_url'].includes(key))) throw new ProfileValidationError('Campos de perfil inválidos.');
  const patch = {};
  if (Object.hasOwn(body, 'display_name')) {
    if (typeof body.display_name !== 'string') throw new ProfileValidationError('Nome de exibição inválido. Use de 2 a 60 caracteres.');
    const name = body.display_name.trim();
    if (name.length < 2 || name.length > 60) throw new ProfileValidationError('Nome de exibição inválido. Use de 2 a 60 caracteres.');
    patch.display_name = name;
  }
  if (Object.hasOwn(body, 'avatar_data_url')) {
    if (!validAvatar(body.avatar_data_url)) throw new ProfileValidationError('Foto inválida. Envie uma imagem JPEG de até 140000 caracteres.');
    patch.avatar_data_url = body.avatar_data_url;
  }
  return patch;
}

export function publicProfile(row, account) {
  const name = typeof row.display_name === 'string' ? row.display_name.trim() : '';
  return {
    display_name: name || account.display_name || account.name || account.username,
    avatar_data_url: validAvatar(row.avatar_data_url) ? row.avatar_data_url : null,
  };
}
