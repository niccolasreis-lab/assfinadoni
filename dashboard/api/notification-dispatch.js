import webpush from 'web-push';
import { rpc, send, supabase, uuid } from '../lib/server.js';
import { authenticateNotificationRequest, validatePushSubscription } from '../lib/notifications.js';
import { readReminderBody, ReminderValidationError } from '../lib/reminders.js';

function telegramDelivery(value) {
  return {id:value.id,lease_token:value.lease_token,chat_id:value.chat_id,text:`Você tem ${value.kind === 'bill' ? 'uma conta para acompanhar' : 'uma despesa para revisar'} no Assistente de Finanças. Abra o painel ou use /pendencias. Código: ${value.short_code}.`};
}
function deliveryIdentity(body) {
  try { return {p_id:uuid(body.id),p_lease_token:uuid(body.lease_token)}; } catch { throw new ReminderValidationError('Entrega inválida.'); }
}
async function sendPush(delivery,config) {
  const identity = {p_id:delivery.id,p_lease_token:delivery.lease_token};
  const current = await rpc('finance_notification_check',identity);
  if (!current || current.channel !== 'push') return;
  let success = false;
  try {
    const subscription = validatePushSubscription({endpoint:current.endpoint,keys:current.keys});
    await webpush.sendNotification(subscription,JSON.stringify({tag:`finance-${delivery.reminder_id}`,url:'/?reminders=1'}),{
      vapidDetails:{subject:config.vapid_subject,publicKey:config.public_key,privateKey:config.private_key},
      TTL:3600,timeout:7000,urgency:'normal',
    });
    success = true;
  } catch(error) {
    if ([404,410].includes(error.statusCode)) {
      const params = new URLSearchParams({id:`eq.${current.subscription_id}`});
      await supabase(`finance_push_subscriptions?${params}`,{method:'DELETE',prefer:'return=minimal'});
      return;
    }
  }
  await rpc('finance_notification_ack',{...identity,p_success:success});
}

export default async function handler(req,res) {
  try {
    const config = await authenticateNotificationRequest(req);
    if (!config) return send(res,401,{error:'Não autorizado.'});
    if (!['POST','PATCH'].includes(req.method)) return send(res,405,{error:'Método não permitido.'});
    const body = readReminderBody(req);
    if (req.method === 'PATCH') {
      if (Object.keys(body).some(key=>!['id','lease_token','success'].includes(key)) || typeof body.success !== 'boolean') throw new ReminderValidationError('Confirmação inválida.');
      const identity = deliveryIdentity(body);
      const current = await rpc('finance_notification_check',identity);
      if (!current || current.channel !== 'telegram') return send(res,200,{acknowledged:false});
      const acknowledged = await rpc('finance_notification_ack',{...identity,p_success:body.success});
      return send(res,200,{acknowledged:Boolean(acknowledged)});
    }
    if (body.action === 'check') {
      if (Object.keys(body).some(key=>!['id','lease_token','action'].includes(key))) throw new ReminderValidationError('Consulta inválida.');
      const delivery = await rpc('finance_notification_check',deliveryIdentity(body));
      return send(res,200,{delivery:delivery?.channel === 'telegram' ? telegramDelivery(delivery) : null});
    }
    if (Object.keys(body).length) throw new ReminderValidationError('Parâmetro inválido.');
    const claimed = await rpc('finance_notification_claim',{p_limit:10});
    const deliveries = [];
    // Bound concurrency and runtime; the database lease isolates concurrent dispatchers.
    for (let index=0; index<(claimed || []).length; index+=5) {
      await Promise.all(claimed.slice(index,index+5).map(async delivery => {
        if (delivery.channel === 'push') return sendPush(delivery,config);
        const current = await rpc('finance_notification_check',{p_id:delivery.id,p_lease_token:delivery.lease_token});
        if (current?.channel === 'telegram') deliveries.push(telegramDelivery(current));
      }));
    }
    return send(res,200,{deliveries});
  } catch(error) {
    const invalid = error instanceof ReminderValidationError;
    return send(res,invalid ? 400 : 500,{error:invalid ? error.message : 'Falha ao processar notificações.'});
  }
}
