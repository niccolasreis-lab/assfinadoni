# Progress — assfinadoni

Legenda: `[ ]` planejado · `[~]` em desenvolvimento · `[x]` concluído · `[!]` bloqueado

## Fase 0 — Auditoria e baseline

- [x] Stack, rotas, migrations e integrações presentes no repositório auditadas.
- [x] `pnpm test` executado: 62 aprovados, 1 teste SQL opcional inicialmente pulado.
- [x] Testes SQL com PGlite executados: 2 aprovados.
- [x] `pnpm typecheck` e `pnpm build` executados com sucesso.
- [x] `PRD.md` criado com limites e contratos aprovados.
- [x] Inventário de variáveis documentado sem valores.
- [!] Schema-base do Supabase, workflows n8n, webhook Telegram e projeto APK não estão no repositório.

## Fase 1 — Integridade e idempotência

- [~] Migration de eventos de processamento, anexos, duplicidades e auditoria.
- [~] Fingerprint determinístico e revisão de duplicidades.
- [ ] Integração de todos os canais ao mesmo evento idempotente.
- [ ] Testes de regressão de reentrega e isolamento.

## Fases futuras

- [ ] Domínio financeiro normalizado: contas, cartões, faturas, splits, parcelas e recorrências.
- [ ] Assistente com ferramentas tipadas e contexto persistente.
- [ ] Agentes, categorização, alertas, budgets, metas e projeções.
- [ ] Relatórios, timeline, patrimônio, investimentos, API v1 e MCP.
- [ ] Hardening, rollout por flags, observabilidade e validação do APK.

## Migrations, deploy e APK

- Migrations aplicadas: as migrations existentes do diretório `supabase/migrations`.
- Nova migration: será aplicada somente após validação em schema sanitizado.
- Deploy: pendente de revisão e dos artefatos externos bloqueados.
- Versão APK: `[!]` projeto APK não fornecido.

