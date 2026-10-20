# Banco e sincronização

O schema financeiro foi conferido com a produção em 20/10/2026. As 21 tabelas de
integridade, domínio, planejamento e patrimônio do código foram adicionadas pela
migration `20261020111147_finance_sync_preserve_live_contracts.sql`. Nenhum
lançamento ou preferência existente foi atualizado por essa migration.

## Prioridade dos contratos atuais

- As nove migrations WhatsApp de 19–20/10 foram recuperadas do histórico remoto,
  com seus timestamps reais. Elas preservam alertas, limites, resumos e voz.
- Os overloads com `payment_details` conservam assinatura, JSON, permissões de
  conta ativa e edição compartilhada. A API também grava origem e fingerprint.
- O enqueue do assistente conserva a validação conta/carteira antes de criar o
  evento de processamento. A migration Jev é reaplicável com OR REPLACE.
- Todos os RPCs `finance_*` são restritos a service_role. Os identificadores de
  conta sempre são resolvidos pela sessão no servidor.
- n8n e suas credenciais existentes continuam operando fora do Git. Nenhum token,
  chave de provedor ou export com credenciais foi adicionado ao repositório.

## Carteiras pessoais e visão Casal

`finance_dashboard_couple_memberships` concede acesso explícito de uma conta a
uma carteira compartilhada. Os vínculos são dados administrativos e não fazem
parte das migrations; provisionar por SELECT sobre identidades conferidas, sem
copiar UUIDs de produção. As duas contas do casal foram vinculadas em produção.

O botão Casal consulta `/api/couple` (também `/api/v1/couple`) e apresenta lista,
resumo mensal, filtros, paginação e lixeira. O padrão Minhas e as carteiras
pessoais permanecem. A visão Casal é somente leitura; alterações dos gastos do
grupo continuam pelo WhatsApp. Cache e histórico dos gráficos separam os escopos.

Limites WhatsApp (`finance_whatsapp_budgets`) e lembretes WhatsApp
(`finance_whatsapp_alerts`) continuam sendo as fontes dos avisos do grupo.
As tabelas do domínio web não substituem esses cadastros. Esta sincronização não
transforma limites ou lembretes existentes em lançamentos, nem habilita flags
novas automaticamente.

## Histórico regularizado

Em 20/10/2026, após autorização explícita do usuário e nova verificação do schema,
foram registrados os oito baselines históricos que faltavam. A operação foi
atômica e alterou somente metadados em supabase_migrations.schema_migrations;
nenhuma migration antiga foi reexecutada.

Lixeira/cron, assistente e Jev já existiam sem quatro registros correspondentes.
As quatro foundations de 24/09 foram implantadas pela migration de reconciliação
20261020111147. Os comentários dos oito registros identificam essa procedência;
não representam uma nova execução dos SQLs antigos na data original.

`production-history.json` documenta as versões e o reparo autorizado.
`verify-sync.sql` é somente leitura: missing_tables, missing_functions e
missing_migration_versions devem estar vazios e public_finance_rpcs deve ser zero.
Os hashes de lançamentos, preferências de voz e definições financeiras foram
conferidos antes/depois do reparo e permaneceram iguais.
Há três migrations de outros serviços no mesmo projeto, listadas no manifesto;
não foram alteradas e não devem ser removidas ou reproduzidas por este projeto.

Não executar db reset, db push --include-all ou migration repair cegamente em
produção. Qualquer divergência futura exige comparar schema, versões e definições
antes de regularizar metadados, sem reconstruir despesas ou funcionalidades.

## Instalação nova e validação

Para uma base nova, inicialize `bootstrap.sql` antes das migrations em ordem.
Ele contém somente o schema legado de users/transactions, sem dados ou segredos.
Supabase fornece pgcrypto/pg_cron; os testes isolados substituem apenas esses
recursos de infraestrutura quando necessário.

No dashboard:

```sh
pnpm install --frozen-lockfile
pnpm lint
FINANCE_SQL_TEST_MODULE=./node_modules/@electric-sql/pglite/dist/index.js pnpm test
pnpm run build
```

`synchronization-sql.test.js` aplica banco legado e instalação nova, todas as
migrations WhatsApp e a reconciliation, conferindo despesas, pagamentos híbridos,
preferências, limites, agenda, definições WhatsApp, autorização e reaplicação.
