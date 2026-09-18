import { requireAccount, rpc, sameOrigin, send, supabase } from '../lib/server.js';
import { publicReminder, readReminderBody, ReminderValidationError, validateReminderAction, validateReminderCreate } from '../lib/reminders.js';

export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res,401,{error:'Faça login para continuar.'});
    if (!['GET','POST','PATCH'].includes(req.method)) return send(res,405,{error:'Método não permitido.'});
    if (req.method !== 'GET' && !sameOrigin(req)) return send(res,403,{error:'Origem não autorizada.'});
    if (req.query && Object.keys(req.query).length) throw new ReminderValidationError('Parâmetro de lembrete inválido.');
    if (req.method === 'GET') {
      const rows = [];
      let cursor;
      while (true) {
        const params = new URLSearchParams({ select:'*',finance_user_id:`eq.${account.finance_user_id}`,status:'eq.pending',order:'id.asc',limit:'500' });
        if (cursor) params.set('id',`gt.${cursor}`);
        const page = await supabase(`finance_reminders?${params}`);
        if (!Array.isArray(page)) throw new Error('Invalid reminder response');
        rows.push(...page);
        if (page.length < 500) break;
        const next = page.at(-1)?.id;
        if (!next || next === cursor) throw new Error('Invalid reminder cursor');
        cursor = next;
      }
      rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
      return send(res,200,{reminders:rows.map(publicReminder),telegram_linked:Boolean(account.telegram_linked)});
    }
    const body = readReminderBody(req);
    let reminder;
    if (req.method === 'POST') reminder = await rpc('finance_reminder_create',{p_user_id:account.finance_user_id,p_values:validateReminderCreate(body)});
    else {
      const {id,action,values} = validateReminderAction(body);
      reminder = await rpc('finance_reminder_action',{p_user_id:account.finance_user_id,p_id:id,p_action:action,p_values:values,p_account_id:account.id});
    }
    if (!reminder) return send(res,404,{error:'Lembrete não encontrado.'});
    return send(res,req.method === 'POST' ? 201 : 200,{reminder:publicReminder(reminder)});
  } catch (error) {
    const invalid = error instanceof ReminderValidationError || ['22023','23514','22P02','22007','22008'].includes(error.code);
    const conflict = error.code === '55000';
    return send(res,invalid ? 400 : conflict ? 409 : 500,{error:error instanceof ReminderValidationError ? error.message : invalid ? 'Complete valor, categoria e data válidos. Confira os campos do lembrete.' : conflict ? 'Este lembrete já foi encerrado.' : 'Não consegui concluir a operação. Tente novamente.'});
  }
}
