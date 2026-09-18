import { ECDH, timingSafeEqual } from 'node:crypto';
import { supabase } from './server.js';
import { ReminderValidationError } from './reminders.js';

export async function getNotificationConfig() {
  const rows = await supabase('finance_notification_config?singleton=eq.true&select=private_key,public_key,dispatch_secret,vapid_subject');
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}
export async function authenticateNotificationRequest(req) {
  const provided = req.headers?.['x-notification-secret'];
  if (typeof provided !== 'string' || provided.length < 32 || provided.length > 256) return null;
  const config = await getNotificationConfig();
  if (typeof config?.dispatch_secret !== 'string') return null;
  const a = Buffer.from(provided), b = Buffer.from(config.dispatch_secret);
  return a.length === b.length && timingSafeEqual(a,b) ? config : null;
}
const fail = () => { throw new ReminderValidationError('Assinatura de notificação inválida.'); };
export function validatePushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return fail();
  let url; try { url = new URL(value); } catch { return fail(); }
  const allowed = ['fcm.googleapis.com','updates.push.services.mozilla.com','updates-autopush.stage.mozaws.net','web.push.apple.com'];
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !(allowed.includes(host) || host.endsWith('.push.apple.com')) || url.pathname === '/') return fail();
  return url.href;
}
function base64Key(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value,'base64url');
  return bytes.length === length && bytes.toString('base64url') === value.replace(/=+$/,'');
}
export function validatePushSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription) || Object.keys(subscription).some(key=>!['endpoint','keys','expirationTime'].includes(key))) return fail();
  const endpoint = validatePushEndpoint(subscription.endpoint);
  const keys = subscription.keys;
  if (!keys || typeof keys !== 'object' || Object.keys(keys).some(key=>!['p256dh','auth'].includes(key)) || !base64Key(keys.p256dh,65) || Buffer.from(keys.p256dh,'base64url')[0] !== 4 || !base64Key(keys.auth,16)) return fail();
  try { ECDH.convertKey(Buffer.from(keys.p256dh,'base64url'),'prime256v1'); } catch { return fail(); }
  return {endpoint,keys:{p256dh:keys.p256dh,auth:keys.auth}};
}
