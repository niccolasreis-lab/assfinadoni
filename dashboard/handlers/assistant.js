import { requireAccount, sameOrigin, send, supabase, uuid } from '../lib/server.js';
import { AssistantError, enqueue, publicJob, readAssistantBody, validateAssistantInput } from '../lib/assistant.js';

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res,401,{error:'Faça login para continuar.'});
    if (req.method === 'GET') {
      const params = new URLSearchParams({ select:'id,status,result,created_at',user_id:`eq.${account.finance_user_id}`,expires_at:`gt.${new Date().toISOString()}`,order:'created_at.desc',limit:'16' });
      if (req.query?.id) { try { params.set('id',`eq.${uuid(req.query.id)}`); } catch { throw new AssistantError('Pedido inválido.'); } }
      const jobs = await supabase(`finance_assistant_jobs?${params}`);
      if (req.query?.id) return jobs[0] ? send(res,200,publicJob(jobs[0])) : send(res,404,{error:'Pedido não encontrado.'});
      return send(res,200,{jobs:jobs.reverse().map(publicJob)});
    }
    if (req.method !== 'POST') return send(res,405,{error:'Método não permitido.'});
    if (!sameOrigin(req)) return send(res,403,{error:'Origem não autorizada.'});
    if (process.env.ASSISTANT_ENABLED !== 'true') return send(res,503,{error:'O assistente está sendo configurado. Você pode usar os lançamentos manuais.'});
    return send(res,202,await enqueue(account,validateAssistantInput(readAssistantBody(req))));
  } catch (error) {
    return send(res,error instanceof AssistantError ? error.status : error.code==='54000' ? 429 : 503,
      {error:error instanceof AssistantError ? error.message : error.code==='54000' ? 'Aguarde seus pedidos em andamento antes de enviar outro.' : 'O assistente está indisponível. Tente novamente em instantes.'});
  }
}
