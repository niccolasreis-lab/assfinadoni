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

A interface mantém o dashboard original e acrescenta uma ilha React/TypeScript no carregamento inicial. Componentes reutilizáveis ficam em `components/ui`, resolvidos por `@/components/ui` e pelo `components.json` do shadcn; essa convenção evita importações divergentes em novos componentes. Os estilos Tailwind ficam em `styles/react.css`, sem Preflight para não modificar formulários e tabelas existentes. O ShiningText usa apenas a prop `text`, sem provider/estado global ou imagens adicionais.

Use `pnpm install --frozen-lockfile`, `pnpm run build` e `pnpm test`. O build gera `dist` com os arquivos públicos e JS/CSS locais; as APIs Vercel permanecem em `api`. Para adicionar componentes, use o CLI shadcn com a configuração existente. O brilho usa Motion, para quando o carregamento termina e respeita movimento reduzido.

Use `npm test` (ou `node --test`) dentro desta pasta. Para testar a UI com funções Vercel localmente, configure as variáveis e execute `vercel dev`. Nunca use dados reais em um Preview público sem proteção por senha forte.

## Limites conhecidos

O botão “Instalar app” oferece instalação PWA (ou instruções para Safari/iPhone). A tela offline não contém dados: somente a página pública offline e os ícones são cacheados. Login, consultas e alterações exigem internet. O guia “Como usar” aparece no primeiro acesso de cada conta neste dispositivo e pode ser reaberto.

- Não há cadastro público nem recuperação de senha pela interface. Provisionamento e redefinição são administrativos.
- O dashboard não faz leitura de PDFs, imagens ou áudios; isso ocorre pelo bot.
- A lixeira guarda lançamentos por 30 dias; depois disso, a limpeza agendada os remove e mantém apenas a chave técnica de deduplicação do update do Telegram.

## Interface grafite/violeta

O redesign mantém HTML/CSS/JavaScript e a ilha React de carregamento. `public/ui.js` reúne navegação e componentes visuais; `public/charts.js` contém apresentação e consultas históricas com cache exclusivamente em memória. O histórico usa seis resumos mensais da API existente; respostas obsoletas e resultados anteriores a alterações/logout são descartados. O saldo apresentado é o saldo do mês, não um saldo bancário acumulado.

As seções Receitas e Despesas mantêm o tipo ao limpar filtros e trocar escopo. A visão geral mostra cinco lançamentos recentes, com acesso à lista completa. Configurações reúne vínculo Telegram, instalação, tutorial e saída. Metas e notificações permanecem fora desta versão.

### Link do assistente

Defina `telegramBotUrl` em `public/config.js` como `https://t.me/username_do_bot`. Esse arquivo é público: não inclua tokens, senhas ou chat IDs. Sem um endereço válido, a interface informa “Link do assistente não configurado”. Isso não altera a integração ou o vínculo existente no servidor.

### Validação visual reproduzível

`node --test` inclui testes dos gráficos, isolamento do histórico e concorrência. `pnpm run build` inclui typecheck. Não há script de lint configurado.

Com o conteúdo de `dist` servido localmente, execute `node scripts/verify-redesign.cjs` em um ambiente com Playwright disponível. Opcionalmente use `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, `QA_URL` e `QA_OUTPUT` para indicar o pacote, navegador, URL e diretório de capturas. O script intercepta as APIs somente no navegador de teste e usa dados sintéticos; os fixtures nunca são servidos pelo produto. Verifica 360, 768, 1024 e 1440 px, login, visibilidade de senha, navegação, confirmação, formulários, vazio, erro e saída. A validação local usa a CSP de `vercel.json`.

Inter é hospedada em `public/fonts`, com licença OFL incluída. Ícones são SVGs locais. Nenhuma dependência de execução foi acrescentada. A documentação visual está em `../DESIGN.md`.
