# Dashboard Financeiro do Ni

Dashboard simples para Vercel, ligado às tabelas `finance_users` e `finance_transactions` do mesmo Supabase usado pelo bot. Mostra receitas, despesas, saldo, divisão por categoria e permite criar, editar, filtrar, excluir e restaurar lançamentos.

## Limite de funções Vercel

O projeto permanece compatível com o plano Hobby: as onze funções legadas continuam em `api/` e as rotas financeiras novas são despachadas por `api/[...route].js`. Os caminhos públicos `/api/*` e `/api/v1/*` não mudam; os handlers internos ficam em `handlers/`.

## Segurança e escopo

Esta versão usa contas individuais vinculadas a chats distintos do Telegram. A sessão assinada identifica a conta e é revalidada a cada requisição. Os RPCs autorizam acesso próprio ou compartilhado, incluindo edição, exclusão e restauração. A chave `service role` fica somente no servidor; nunca use variáveis `NEXT_PUBLIC_*`. Excluir move o lançamento para a lixeira por 30 dias.

## Configurar na Vercel

1. Crie um projeto Vercel apontando o **Root Directory** para `dashboard`.
2. Configure estas variáveis de ambiente em Production (e em Preview, se for usá-lo):

   - `SUPABASE_URL`: URL HTTPS do projeto Supabase usado no n8n.
   - `SUPABASE_SERVICE_ROLE_KEY`: chave `service_role` desse projeto, como variável sensível.
   - `SESSION_SECRET`: segredo aleatório de pelo menos 32 caracteres, diferente da senha.

3. Aplique as migrações em `supabase/migrations` e faça o deploy. As dependências estão fixadas no lockfile.

Cada conta possui uma carteira própria em `finance_users`. Usuários somente web podem ter `telegram_chat_id = null`; o vínculo futuro deve atualizar a mesma carteira por UUID, preservando os lançamentos, nunca criar um chat fictício. A migração multiusuário e o provisionamento vêm **antes** da nova API/interface. Depois disso, remova `TELEGRAM_CHAT_ID` e `DASHBOARD_PASSWORD`.

## Provisionar as duas contas

Use `node scripts/provision-accounts.js` uma vez, com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `IONARA_TELEGRAM_CHAT_ID` e `NICOLAS_TELEGRAM_CHAT_ID` no ambiente privado. Informe a senha pela entrada padrão; não passe senha em argumentos ou comandos que a gravem no histórico. O script valida ambos os vínculos antes de inserir, gera salts/hash scrypt individuais e recusa contas existentes ou conflitantes. Não imprima segredos nem salve arquivos de credenciais no projeto.

Para uma conta sem Telegram, forneça `IONARA_FINANCE_USER_ID` ou `NICOLAS_FINANCE_USER_ID` no lugar do chat, referindo-se à carteira web já criada. Usernames: `ionararosendo` e `nicolasreis`. Não há cadastro público. Cinco falhas em 15 minutos bloqueiam temporariamente a conta; a senha curta e igual nas duas contas continua sendo um risco, mesmo com hash e bloqueio.

Compartilhamento é individual e opcional. O destinatário pode editar, excluir, restaurar e cancelar acesso. Totais próprios são padrão; incluir compartilhados é uma escolha explícita. Lixeira e limpeza continuam excluindo os itens dos resumos do bot, sem alterar o proprietário nem a deduplicação do Telegram.

Para gerar `SESSION_SECRET` localmente, use `openssl rand -base64 48`. Não salve a saída no repositório.

## Desenvolvimento e testes

A interface mantém o dashboard original e acrescenta uma ilha React/TypeScript no carregamento inicial. Componentes reutilizáveis ficam em `components/ui`, resolvidos por `@/components/ui` e pelo `components.json` do shadcn; essa convenção evita importações divergentes em novos componentes. Os estilos Tailwind ficam em `styles/react.css`, sem Preflight para não modificar formulários e tabelas existentes. O ShiningText usa apenas a prop `text`, sem provider/estado global ou imagens adicionais.

Use `pnpm install --frozen-lockfile`, `pnpm run build` e `pnpm test`. O build gera `dist` com os arquivos públicos e JS/CSS locais; as APIs Vercel permanecem em `api`. Para adicionar componentes, use o CLI shadcn com a configuração existente. O brilho usa Motion, para quando o carregamento termina e respeita movimento reduzido.

Use `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build` dentro desta pasta. Para testar a UI com funções Vercel localmente, configure as variáveis e execute `vercel dev`. Nunca use dados reais em um Preview público sem proteção por senha forte.

## Limites conhecidos

O botão “Instalar app” oferece instalação PWA (ou instruções para Safari/iPhone). A tela offline não contém dados: somente a página pública offline e os ícones são cacheados. Login, consultas e alterações exigem internet. O guia “Como usar” aparece no primeiro acesso de cada conta neste dispositivo e pode ser reaberto.

- Não há cadastro público nem recuperação de senha pela interface. Provisionamento e redefinição são administrativos.
- O dashboard não faz leitura de PDFs, imagens ou áudios; isso ocorre pelo bot.
- A lixeira guarda lançamentos por 30 dias; depois disso, a limpeza agendada os remove e mantém apenas a chave técnica de deduplicação do update do Telegram.

## Interface grafite/violeta

O redesign mantém HTML/CSS/JavaScript e a ilha React de carregamento. `public/ui.js` reúne navegação e componentes visuais; `public/charts.js` contém apresentação e consultas históricas com cache exclusivamente em memória. O histórico usa seis resumos mensais da API existente; respostas obsoletas e resultados anteriores a alterações/logout são descartados. O saldo apresentado é o saldo do mês, não um saldo bancário acumulado.

As seções Receitas e Despesas mantêm o tipo ao limpar filtros e trocar escopo. A visão geral mostra cinco lançamentos recentes, com acesso à lista completa. A Central financeira resume contas, cartões e parcelas futuras; Configurações reúne vínculo Telegram, instalação, tutorial e saída. Budgets, metas, alertas e insights ficam protegidos por feature flags nas APIs versionadas.

### Link do assistente

Defina `telegramBotUrl` em `public/config.js` como `https://t.me/username_do_bot`. Esse arquivo é público: não inclua tokens, senhas ou chat IDs. Sem um endereço válido, a interface informa “Link do assistente não configurado”. Isso não altera a integração ou o vínculo existente no servidor.

### Validação visual reproduzível

`node --test` inclui testes dos gráficos, isolamento do histórico e concorrência. `pnpm run build` inclui typecheck. `pnpm lint` verifica sintaticamente todos os arquivos JavaScript do dashboard.

Com o conteúdo de `dist` servido localmente, execute `node scripts/verify-redesign.cjs` em um ambiente com Playwright disponível. Opcionalmente use `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE`, `QA_URL` e `QA_OUTPUT` para indicar o pacote, navegador, URL e diretório de capturas. O script intercepta as APIs somente no navegador de teste e usa dados sintéticos; os fixtures nunca são servidos pelo produto. Verifica 360, 768, 1024 e 1440 px, login, visibilidade de senha, navegação, confirmação, formulários, vazio, erro e saída. A validação local usa a CSP de `vercel.json`.

Inter é hospedada em `public/fonts`, com licença OFL incluída. Ícones são SVGs locais. O frontend não acrescenta bibliotecas; o servidor utiliza `web-push` para Web Push. A documentação visual está em `../DESIGN.md`.


## Perfil e movimento

O menu do avatar permite editar nome e foto sincronizados na conta (`/api/profile`). Imagens JPEG/PNG/WebP são recortadas no navegador e enviadas como JPEG de 256 px; SVG não é aceito. O nome financeiro e o vínculo Telegram são preservados. O logotipo original permanece intacto, com enquadramento CSS e assinatura legível.

Diálogos abrem em 220 ms e fecham em 150 ms. Cartões recebem borda em gradiente no hover e foco interno; somente ações usam cursor interativo. `prefers-reduced-motion` elimina deslocamentos. Teste adicional: `node scripts/verify-profile.cjs`.

## Contas a pagar e pendências

A central cria contas futuras e despesas para revisão, separadas dos totais até a confirmação. Editar, pagar/validar ou cancelar usa a mesma carteira no dashboard e Telegram. A conclusão é atômica e idempotente, gera uma única despesa e exige valor, categoria e data não futura. Os lembretes são privados da carteira e não são compartilhados automaticamente com os lançamentos.

Padrão de contas: 9h de São Paulo, três dias antes, um dia antes e no vencimento; configurações por lembrete. Há um aviso único após o vencimento. Pendências recebem até três avisos diários. O scheduler verifica a cada cinco minutos; horários são aproximados. Notificações de tela bloqueada são genéricas, sem valores ou descrições. A consulta autenticada mostra os detalhes.

No PWA, abra o sino e ative notificações neste dispositivo por ação explícita. É necessário HTTPS, navegador com Push API e permissão do sistema. Instalar o app não concede permissão automaticamente. Cada dispositivo se inscreve separadamente; sair remove sua inscrição. Nenhum dado financeiro é armazenado offline. Android físico requer teste de entrega no dispositivo do usuário; testes automatizados simulam permissão e assinatura.

Comandos Telegram:

- `/lembrete 25/09/2026 Internet | 120,00 | Moradia`
- `/lembretes` ou `/pendencias`
- `/pagar CODIGO`
- `/validar CODIGO 42,50 | Alimentação`
- `/cancelar CODIGO`

O código é exibido na central e nas respostas. Mensagens interpretadas como despesas incompletas geram pendências; receitas ambíguas continuam exigindo esclarecimento. Contas futuras explícitas viram lembretes. A API privada resolve a carteira pelo chat privado cadastrado.

### Operação das notificações

Aplique a migração `finance_reminders` antes do deploy. Gere um par VAPID via `web-push.generateVAPIDKeys()` e um segredo aleatório de 32 bytes; insira uma única linha em `finance_notification_config` com `singleton=true`, `private_key`, `public_key`, `dispatch_secret` e `vapid_subject=https://assfinadoni.vercel.app`. Não rotacione as chaves existentes sem planejar reinscrição dos dispositivos. Essa tabela tem RLS e acesso somente de serviço. Nunca inclua seus valores em arquivos públicos, logs ou Git.

`api/notification-dispatch` e `api/telegram-reminders` exigem `x-notification-secret`. O primeiro processa push e devolve entregas Telegram com lease; o scheduler revalida antes de enviar e confirma usando o mesmo lease. A fila deduplica ocorrências e limita tentativas. Entrega externa é de melhor esforço: uma falha entre envio e confirmação pode gerar repetição. Assinaturas expiradas são removidas.

`scripts/configure-notifications-n8n.py` prepara, sem publicar, os dois workflows a partir de um backup autorizado do workflow ativo. A configuração usa a credencial Supabase já existente e lê somente `dispatch_secret`. Os workflows desabilitam armazenamento de dados de execução para não persistir segredos. Exports preparados e backups ficam fora do repositório. Publique o backend antes de atualizar/ativar os workflows e confira as conexões e credenciais após a publicação.

Testes: `node scripts/verify-reminders.cjs` cobre fluxos e permissões no navegador com fixtures. `FINANCE_SQL_TEST_MODULE=/caminho/@electric-sql/pglite/dist/index.js node --test tests/reminders-sql.test.js` executa a migração e valida isolamento, idempotência e agendamento em PostgreSQL isolado; sem o módulo esse teste é explicitamente pulado. O módulo de teste é opcional e não faz parte das dependências de produção.

## Domínio financeiro evolutivo

As migrations `20260924120000_finance_integrity_foundation.sql`,
`20260924130000_finance_domain_foundation.sql`,
`20260924140000_finance_planning_intelligence.sql` e
`20260924150000_finance_wealth.sql` são aditivas. Elas criam ledger de eventos,
fingerprints, duplicidades revisáveis, auditoria, anexos, contas, cartões,
faturas, splits, parcelamentos, assinaturas, budgets, metas, alertas, insights,
investimentos e patrimônio manual. Aplique-as somente depois de validar o
schema-base existente em um ambiente sanitizado.

As rotas `/api/v1/*` são wrappers versionados dos contratos internos atuais.
Incluem contas, cartões, transações, parcelas, budgets, metas, lembretes,
insights, assinaturas, busca, timeline, relatórios CSV e projeção. O gateway
`/api/v1/mcp` permanece desligado até `ENABLE_MCP=true`, exige sessão, escopo,
confirmação para ações destrutivas e registra auditoria.

`pnpm lint` executa a verificação sintática dos arquivos JavaScript; `pnpm test`
inclui fixtures SQL isoladas e testes de autorização. As flags `ENABLE_GOALS`,
`ENABLE_SMART_ALERTS`, `ENABLE_AI_AGENTS`, `ENABLE_INVESTMENTS` e
`ENABLE_FORECAST` começam desligadas para permitir rollout gradual.
