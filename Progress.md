# Progress — assfinadoni

Legenda: `[ ]` planejado · `[~]` em desenvolvimento · `[x]` concluído · `[!]` bloqueado

## Fase 0 — Auditoria e baseline

- [x] Stack, rotas, migrations e integrações presentes no repositório auditadas.
- [x] `pnpm test` executado: 73 aprovados, 1 teste SQL opcional inicialmente pulado.
- [x] Testes SQL com PGlite executados: baseline e 6 novas suítes aprovados.
- [x] `pnpm typecheck` e `pnpm build` executados com sucesso.
- [x] `PRD.md` criado com limites e contratos aprovados.
- [x] Inventário de variáveis documentado sem valores.
- [!] Schema-base do Supabase, workflows n8n, webhook Telegram e projeto APK não estão no repositório.

## Fase 1 — Integridade e idempotência

- [x] Migration de eventos de processamento, anexos, duplicidades e auditoria.
- [x] Fingerprint determinístico e revisão explícita de duplicidades.
- [~] Eventos já cobrem assistant jobs e lançamentos; Telegram, uploads e lembretes aguardam validação dos fluxos externos.
- [x] Testes de idempotência, isolamento e merge seguro adicionados.

## Fase 2 — Domínio financeiro

- [x] Migrations aditivas para contas, cartões, faturas, splits, parcelas e assinaturas.
- [x] RPCs autenticadas para contas, cartões, splits, parcelas e consultas financeiras.
- [x] APIs internas para contas, cartões, splits e parcelas.
- [x] Migrations iniciais para budgets, metas, alertas e insights.
- [x] APIs protegidas por feature flags para planejamento e inteligência.
- [~] Central financeira com contas, cartões e parcelas; backfill de dados legados aguarda validação do schema externo.

## Fase 3 — Assistente, API e projeções

- [x] Catálogo de ferramentas financeiras server-side com validação e confirmação.
- [x] Wrappers versionados `/api/v1` para os contratos principais.
- [x] Gateway MCP experimental protegido por `ENABLE_MCP` e auditoria.
- [x] Busca, timeline, relatório JSON/CSV e projeção de fluxo de caixa.
- [ ] Workflow n8n real conectado ao catálogo após receber export sanitizado.

## Fases 4–8 — Inteligência, planejamento, relatórios e patrimônio

- [x] Fundamentos de categorização, budgets, metas, alertas, insights e flags adicionados.
- [x] Projeções, timeline, relatórios JSON/CSV, investimentos e patrimônio líquido adicionados.
- [~] Agentes de IA, evidências de insights e UX completa de planejamento dependem de rollout e dados reais.

## Assistente tipado

- [x] Registro de ferramentas server-side com validação e confirmação destrutiva.
- [~] Prompt do worker referencia o catálogo de ferramentas.
- [ ] Execução de consultas do worker exclusivamente via ferramentas após validar o workflow n8n.

## Fase 9 — Hardening e rollout

- [x] `pnpm lint` determinístico com 87 arquivos JavaScript verificados.
- [~] Feature flags, APIs versionadas e gateway MCP prontos para rollout gradual.
- [ ] Observabilidade operacional, execução de todos os canais e validação do APK.

## Migrations, deploy e APK

- Migrations aplicadas: as migrations existentes do diretório `supabase/migrations`.
- Novas migrations: serão aplicadas somente após validação em schema sanitizado.
- Deploy: pendente de revisão e dos artefatos externos bloqueados.
- Versão APK: `[!]` projeto APK não fornecido.
