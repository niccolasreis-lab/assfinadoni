import { requireAccount, rpc, sameOrigin, send } from '../lib/server.js';
import { getNotificationConfig, validatePushEndpoint, validatePushSubscription } from '../lib/notifications.js';
import { readReminderBody, ReminderValidationError } from '../lib/reminders.js';

export default async function handler(req,res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res,401,{error:'Faça login para continuar.'});
    if (!['GET','POST','DELETE'].includes(req.method)) return send(res,405,{error:'Método não permitido.'});
    if (req.method !== 'GET' && !sameOrigin(req)) return send(res,403,{error:'Origem não autorizada.'});
    if (req.query && Object.keys(req.query).length) throw new ReminderValidationError('Parâmetro inválido.');
    if (req.method === 'GET') { const config = await getNotificationConfig(); return send(res,200,{publicKey:config?.public_key || null,supported:true}); }
    const body = readReminderBody(req);
    const expected = req.method === 'POST' ? 'subscription' : 'endpoint';
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body,expected)) throw new ReminderValidationError('Assinatura inválida.');
    if (req.method === 'POST') {
      const sub = validatePushSubscription(body.subscription);
      const saved = await rpc('finance_push_subscribe',{p_account_id:account.id,p_endpoint:sub.endpoint,p_p256dh:sub.keys.p256dh,p_auth:sub.keys.auth});
      if (!saved) return send(res,409,{error:'Este dispositivo já está associado a outra conta. Saia dela antes de ativar aqui.'});
      return send(res,200,{subscribed:true});
    }
    await rpc('finance_push_unsubscribe',{p_account_id:account.id,p_endpoint:validatePushEndpoint(body.endpoint)});
    return send(res,200,{subscribed:false});
  } catch(error) { const invalid = error instanceof ReminderValidationError; return send(res,invalid ? 400 : 500,{error:invalid ? error.message : 'Não consegui configurar as notificações. Tente novamente.'}); }
}
