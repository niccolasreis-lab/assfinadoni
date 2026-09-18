# Dashboard Financeiro do Ni

Dashboard simples para Vercel, ligado às tabelas `finance_users` e `finance_transactions` do mesmo Supabase usado pelo bot. Mostra receitas, despesas, saldo, divisão por categoria e permite criar, editar, filtrar, excluir e restaurar lançamentos.

## Segurança e escopo

Esta versão usa contas individuais vinculadas a chats distintos do Telegram. A sessão assinada identifica a conta e é revalidada a cada requisição. Os RPCs autorizam acesso próprio ou compartilhado, incluindo edição, exclusão e restauração. A chave `service role` fica somente no servidor; nunca use variáveis `NEXT_PUBLIC_*`. Excluir move o lançamento para a lixeira por 30 dias.

## Configurar na Vercel

1. Crie um projeto Vercel apontando o **Root Directory** para `dashboard`.
2. Configure estas variáveis de ambiente em Production (e em Preview, se for usá-lo):

   - `SUPABASE_URL`: URL HTTPS do projeto Supabase usado no n8n.
   - `SUPABASE_SERVICE_ROLE_KEY`: chave `service_role` desse projeto, como variável sensível.
   - `SESSION_SECRET`: segredo aleatório de pelo menos 32 caracteres, diferente da senha.

3. Aplique as migrações em `supabase/migrations` e faça o deploy. Não há dependências npm externas.

Cada conta possui uma carteira própria em `finance_users`. Usuários somente web podem ter `telegram_chat_id = null`; o vínculo futuro deve atualizar a mesma carteira por UUID, preservando os lançamentos, nunca criar um chat fictício. A migração multiusuário e o provisionamento vêm **antes** da nova API/interface. Depois disso, remova `TELEGRAM_CHAT_ID` e `DASHBOARD_PASSWORD`.

## Provisionar as duas contas

Use `node scripts/provision-accounts.js` uma vez, com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IONARA_TELEGRAM_CHAT_ID` e `NICOLAS_TELEGRAM_CHAT_ID` no ambiente privado. Informe a senha pela entrada padrão; não passe senha em argumentos ou comandos que a gravem no histórico. O script valida ambos os vínculos antes de inserir, gera salts/hash scrypt individuais e recusa contas existentes ou conflitantes. Não imprima segredos nem salve arquivos de credenciais no projeto.

Para uma conta sem Telegram, forneça `IONARA_FINANCE_USER_ID` ou `NICOLAS_FINANCE_USER_ID` no lugar do chat, referindo-se à carteira web já criada. Usernames: `ionararosendo` e `nicolasreis`. Não há cadastro público. Cinco falhas em 15 minutos bloqueiam temporariamente a conta; a senha curta e igual nas duas contas continua sendo um risco, mesmo com hash e bloqueio.

Compartilhamento é individual e opcional. O destinatário pode editar, excluir, restaurar e cancelar acesso. Totais próprios são padrão; incluir compartilhados é uma escolha explícita. Lixeira e limpeza continuam excluindo os itens dos resumos do bot, sem alterar o proprietário nem a deduplicação do Telegram.

Para gerar `SESSION_SECRET` localmente, use `openssl rand -base64 48`. Não salve a saída no repositório.

## Desenvolvimento e testes

Use `npm test` (ou `node --test`) dentro desta pasta. Para testar a UI com funções Vercel localmente, configure as variáveis e execute `vercel dev`. Nunca use dados reais em um Preview público sem proteção por senha forte.

## Limites conhecidos

O botão “Instalar app” oferece instalação PWA (ou instruções para Safari/iPhone). A tela offline não contém dados: somente a página pública offline e os ícones são cacheados. Login, consultas e alterações exigem internet. O guia “Como usar” aparece no primeiro acesso de cada conta neste dispositivo e pode ser reaberto.

- Não há cadastro público nem recuperação de senha pela interface. Provisionamento e redefinição são administrativos.
- O dashboard não faz leitura de PDFs, imagens ou áudios; isso ocorre pelo bot.
- A lixeira guarda lançamentos por 30 dias; depois disso, a limpeza agendada os remove e mantém apenas a chave técnica de deduplicação do update do Telegram.
