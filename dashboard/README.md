# Dashboard Financeiro do Ni

Dashboard simples para Vercel, ligado às tabelas `finance_users` e `finance_transactions` do mesmo Supabase usado pelo bot. Mostra receitas, despesas, saldo, divisão por categoria e permite criar, editar e excluir lançamentos.

## Segurança e escopo

Esta versão é **para um único chat do Telegram**. Uma senha protege a sessão; o servidor fixa `TELEGRAM_CHAT_ID` e filtra toda leitura, edição e exclusão pelo `user_id` correspondente. A chave `service role` fica somente nas variáveis do servidor. Não use a chave em arquivos públicos nem em variáveis `NEXT_PUBLIC_*`. Excluir é definitivo e exige confirmação na interface.

## Configurar na Vercel

1. Crie um projeto Vercel apontando o **Root Directory** para `dashboard`.
2. Configure estas variáveis de ambiente em Production (e em Preview, se for usá-lo):

   - `SUPABASE_URL`: URL HTTPS do projeto Supabase usado no n8n.
   - `SUPABASE_SERVICE_ROLE_KEY`: chave `service_role` desse projeto, como variável sensível.
   - `TELEGRAM_CHAT_ID`: ID numérico do chat privado que é dono dos lançamentos.
   - `DASHBOARD_PASSWORD`: senha forte de pelo menos 12 caracteres.
   - `SESSION_SECRET`: segredo aleatório de pelo menos 32 caracteres, diferente da senha.

3. Faça o deploy. Não há dependências npm externas nem migração adicional para este dashboard.

O usuário precisa ter concluído o onboarding no Telegram antes de acessar o dashboard, pois o app localiza a linha existente em `finance_users`.

Para gerar `SESSION_SECRET` localmente, use `openssl rand -base64 48`. Não salve a saída no repositório.

## Desenvolvimento e testes

Use `npm test` (ou `node --test`) dentro desta pasta. Para testar a UI com funções Vercel localmente, configure as variáveis e execute `vercel dev`. Nunca use dados reais em um Preview público sem proteção por senha forte.

## Limites conhecidos

- Não há cadastro multiusuário. Para expandir, será preciso autenticação individual e associação segura entre contas web e chats Telegram.
- O dashboard não faz leitura de PDFs, imagens ou áudios; isso ocorre pelo bot.
- Não há restauração de lançamentos excluídos. Faça backup do Supabase conforme sua política de retenção.
