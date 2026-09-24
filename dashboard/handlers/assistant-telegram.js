import { randomUUID } from 'node:crypto';
import { send, supabase } from '../lib/server.js';
import { AssistantError, bridgeAuthenticated, enqueue, readAssistantBody, validateAssistantInput } from '../lib/assistant.js';

// Called only by the authenticated n8n ingress, after Telegram private-chat checks.
export default async function handler(req,res) {
  try {
    if (req.method!=='POST') return send(res,405,{error:'Método não permitido.'});
    if (!bridgeAuthenticated(req)) return send(res,401,{error:'Não autorizado.'});
    if (process.env.ASSISTANT_ENABLED!=='true') return send(res,503,{error:'Assistente indisponível.'});
    const body=readAssistantBody(req);
    if (!/^\d{1,18}$/.test(String(body.chat_id)) || !/^[\w:-]{1,100}$/.test(String(body.update_id))) throw new AssistantError('Mensagem inválida.');
    const users=await supabase(`finance_users?${new URLSearchParams({select:'id',telegram_chat_id:`eq.${body.chat_id}`,onboarding_state:'eq.active',limit:'1'})}`);
    if (!users[0]) return send(res,403,{error:'Conclua seu cadastro com /start.'});
    let action;
    const match=String(body.text||'').match(/^\/(confirmar|cancelar_ai)\s+([0-9a-f-]{36})$/i);
    if (match) action={action:match[1].toLowerCase()==='confirmar'?'confirm':'cancel',confirmation_id:match[2]};
    const input=validateAssistantInput({request_id:randomUUID(),text:body.text||(body.telegram_file_id?'Anexo enviado.':''),file:body.file,...action});
    if (body.telegram_file_id) {
      if (input.payload.file || !['audio','pdf','photo'].includes(body.media_kind) || !/^[A-Za-z0-9_-]{1,250}$/.test(body.telegram_file_id)) throw new AssistantError('Anexo inválido.');
      input.payload.telegram_file_id=body.telegram_file_id; input.payload.media_kind=body.media_kind;
    }
    const job=await enqueue({finance_user_id:users[0].id},input,'telegram',String(body.update_id));
    return send(res,202,{...job,text:'Recebi seu pedido. Vou conferir e responder aqui.'});
  } catch(error) { return send(res,error instanceof AssistantError?400:503,{error:error instanceof AssistantError?error.message:'Não consegui receber seu pedido. Tente novamente.'}); }
}
