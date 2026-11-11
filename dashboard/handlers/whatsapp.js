import { requireAccount, send, supabase } from '../lib/server.js';

const GROUP = '120363433444431792@g.us';
const HEALTH = 'https://hermes-autopilot.n3hukr.easypanel.host/health';
const uuid = value => /^[0-9a-f-]{36}$/i.test(String(value || ''));
const rows = value => Array.isArray(value) ? value : [];
const query = values => new URLSearchParams(values).toString();

// Read-only. Wallets and contact bindings always come from the authenticated account.
// Never return attachment data, phone numbers, provider errors or infrastructure details.
export default async function handler(req, res) {
  try {
    const account = await requireAccount(req);
    if (!account) return send(res, 401, { error: 'Faça login para continuar.' });
    if (req.method !== 'GET') return send(res, 405, { error: 'Confirme ou corrija propostas no grupo do WhatsApp.' });
    const memberships = rows(await supabase(`finance_dashboard_couple_memberships?${query({ select: 'finance_user_id', account_id: `eq.${account.id}` })}`));
    const wallets = [...new Set(memberships.map(row => row.finance_user_id).filter(uuid))];
    if (!wallets.length) return send(res, 403, { error: 'Sua conta ainda não tem acesso à carteira do casal.' });
    const participants = rows(await supabase(`finance_wallet_participants?${query({
      select: 'finance_user_id,whatsapp_jid', account_id: `eq.${account.id}`, active: 'eq.true', finance_user_id: `in.(${wallets.join(',')})`,
    })}`)).filter(row => wallets.includes(row.finance_user_id) && /^\d{8,15}@s\.whatsapp\.net$/.test(row.whatsapp_jid || ''));
    const checkedAt = new Date().toISOString();
    const pending = (await Promise.all(participants.map(person => supabase(`finance_pending_queue?${query({
      select: 'source_message_id,status,transactions,expires_at,lease_until,created_at',
      user_id: `eq.${person.finance_user_id}`, sender_id: `eq.${person.whatsapp_jid}`, chat_id: `eq.${GROUP}`,
      status: 'in.(pending,processing)', expires_at: `gt.${checkedAt}`, order: 'created_at.asc', limit: '100',
    })}`)))).flatMap(rows).filter(row => String(row.source_message_id || '').startsWith('hm_'));
    const proposals = pending.flatMap(row => rows(row.transactions).map(transaction => ({
      description: String(transaction.description || 'Confira a descrição no grupo').slice(0, 180),
      amount: Number.isFinite(Number(transaction.amount)) && Number(transaction.amount) > 0 ? Number(transaction.amount) : null,
      status: row.status === 'processing' && Date.parse(row.lease_until) > Date.now() ? 'processing' : 'pending',
      expires_at: row.expires_at,
    })));
    let available = false;
    try {
      const health = await fetch(HEALTH, { signal: AbortSignal.timeout(3500), cache: 'no-store' });
      const data = health.ok ? await health.json() : null;
      available = data?.status === 'ok' && data?.financial_execution === 'supabase_confirmed';
    } catch { /* A service failure does not turn a valid queue into an empty queue. */ }
    return send(res, 200, {
      linked: participants.length > 0,
      pending_count: proposals.filter(row => row.status === 'pending').length,
      processing_count: proposals.filter(row => row.status === 'processing').length,
      proposals, service: available ? 'available' : 'unavailable', checked_at: checkedAt,
    });
  } catch {
    return send(res, 503, { error: 'Não consegui consultar suas pendências do WhatsApp. Tente novamente.' });
  }
}
