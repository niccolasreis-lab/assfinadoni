import { hashPassword, supabase } from '../lib/server.js';

// Run once with server credentials and explicit chat IDs. Password arrives through stdin,
// never via a command-line argument, a committed file, or console output.
const accounts = [
  { username: 'ionararosendo', display_name: 'Iônara', chat: process.env.IONARA_TELEGRAM_CHAT_ID, userId: process.env.IONARA_FINANCE_USER_ID },
  { username: 'nicolasreis', display_name: 'Nicolas', chat: process.env.NICOLAS_TELEGRAM_CHAT_ID, userId: process.env.NICOLAS_FINANCE_USER_ID },
];
async function main() {
  let password = '';
  for await (const chunk of process.stdin) password += chunk;
  password = password.replace(/\r?\n$/, '');
  if (!password || password.length > 256) throw new Error('Informe a senha pela entrada padrão.');
  if (accounts.some(a => !a.userId && !/^\d{1,20}$/.test(a.chat || ''))) throw new Error('Configure o UUID financeiro ou chat privado de cada conta.');
  const resolved = [];
  for (const account of accounts) {
    if (account.userId && !/^[0-9a-f-]{36}$/i.test(account.userId)) throw new Error('UUID financeiro inválido.');
    const filter = account.userId ? `id=eq.${encodeURIComponent(account.userId)}` : `telegram_chat_id=eq.${account.chat}`;
    const rows = await supabase(`finance_users?select=id&${filter}&limit=2`);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`Vínculo ausente ou ambíguo: ${account.username}.`);
    resolved.push({ ...account, finance_user_id: rows[0].id });
  }
  if (resolved[0].finance_user_id === resolved[1].finance_user_id) throw new Error('As contas precisam de usuários financeiros distintos.');
  const existing = await supabase('dashboard_accounts?select=id,username,finance_user_id');
  for (const account of resolved) {
    if (existing.some(e => (e.username === account.username && e.finance_user_id !== account.finance_user_id) || (e.finance_user_id === account.finance_user_id && e.username !== account.username))) throw new Error('Vínculo existente conflitante; nenhuma conta foi alterada.');
  }
  const records = [];
  for (const account of resolved) {
    const current = existing.find(e => e.username === account.username);
    records.push({ ...(current ? { id: current.id } : {}), username: account.username, display_name: account.display_name,
      finance_user_id: account.finance_user_id, password_hash: await hashPassword(password), active: true });
  }
  // Provisioning refuses to overwrite existing accounts/passwords.
  if (existing.some(e => resolved.some(a => a.username === e.username))) throw new Error('Contas já provisionadas; use um procedimento explícito de redefinição.');
  await supabase('dashboard_accounts', { method: 'POST', body: records, prefer: 'return=minimal' });
  console.log('As duas contas foram provisionadas com vínculos distintos.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
