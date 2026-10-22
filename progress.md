## Evidências de produção — 01/10/2026

- PR #10 incorporada à main: commit 24eccae158fafb195c52b52c2820f2a3f97097f5.
- Vercel: deployment dpl_3mc72jGobRFgE5xq7RaaXvN1irgx READY, target production; domínio assfinadoni.vercel.app aponta para a versão.
- Código atualizado de compartilhamento confirmado no app.js publicado; API de sessão respondeu 200 sem autenticação.
- Supabase jhpappaakmdfxyujnlef: 8 entregas Telegram marcadas sent; último sent_at 2026-09-22T21:45:35.171925Z. Registro histórico não comprova entrega atual ao dispositivo.
- Nenhuma assinatura push cadastrada. Necessário habilitar notificações num dispositivo autenticado para validar entrega real.
- Há 3 lembretes pendentes e 2 concluídos; todos com flags push/Telegram habilitadas.
- Workflows Telegram e notificações ativos apontam para esse Supabase e para o dashboard. Conexão de banco efetiva da Vercel ainda não comparada.
- Tabelas finance_processing_events e finance_attachments não encontradas no schema public; finance_assistant_jobs existe. Migrations documentadas no repositório não equivalem a migrations aplicadas em produção.
- Compartilhamento externo atual envia texto; PDF como arquivo permanece pendente.
- Consultas de histórico n8n retornaram listas vazias; consultas de logs Vercel expiraram. Não há evidência suficiente para certificar todos os fluxos.

# Progresso do projeto

Atualizado em 20/09/2026.

## Concluído

- Dashboard web funcional em Vercel.
- Supabase conectado com autenticação, lançamentos, compartilhamento, lixeira e lembretes.
- Agendamento de despesas para datas futuras.
- Edição, exclusão recuperável, restauração e compartilhamento pela web.
- Menu de ações ao tocar/clicar em cada transação.
- APK Android nativo com Jetpack Compose e navegação própria.
- Fluxo de login, visão geral, transações, edição, exclusão e compartilhamento no APK.
- Migração `finance_categories_and_transaction_images` aplicada no Supabase.
- API `/api/categories` para listar e criar categorias do usuário.
- API `/api/transaction-attachments` para anexar imagens com checagem de acesso.
- Campo de nova categoria no formulário web.
- Seletor de imagem no formulário web.
- Seletor de imagem e nova categoria no editor do APK.
- Ajustes de cores, navegação e cartões do APK para aproximar o dashboard web.
- Compartilhamento externo implementado no Android com `Intent.ACTION_SEND`.
- Compartilhamento externo implementado no web com Web Share API e fallback para copiar o texto.
- Card de nova versão implementado no APK, com consulta a `/api/app-version` e download via DownloadManager.
- PR de integração aberto: https://github.com/niccolasreis-lab/assfinadoni/pull/2.

## Em validação

- Build do APK no GitHub Actions para o PR atual.
- PR #3 validado com workflow Android concluído com sucesso (run 10).
- Teste manual de upload de imagem nos dois clientes.
- Teste de categoria personalizada em contas diferentes.
- Teste de anexo em lançamento compartilhado e tentativa de acesso sem permissão.

## Pendências técnicas

- Exibir galeria/miniatura dos anexos no detalhe do lançamento.
- Disponibilizar uma ação separada para compartilhamento entre contas, caso ela continue necessária.
- Configurar `ANDROID_APK_URL` no Vercel apontando para um APK hospedado (não ZIP de artefato) e concluir instalação automática pós-download.
- Migrar data URLs para Supabase Storage quando o volume crescer.
- Adicionar idempotência para evitar duplicidade em reprocessamento do Telegram.
- Confirmar no workflow n8n a transcrição de áudio e OCR de imagens em produção.
- Adicionar testes automatizados de API para categorias e anexos.

## Próximo ciclo recomendado

1. Validar o PR e gerar APK de distribuição.
2. Testar uma despesa com categoria nova e imagem no web e Android.
3. Testar áudio, foto e exclusão natural no Telegram.
4. Implementar galeria de anexos e compressão no cliente.
5. Adicionar OCR com revisão antes de salvar.

## Auditoria e evolução financeira

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
## Validação de 01/10/2026 — dashboard e colaboração

- Colaboração completa confirmada como requisito: destinatário autorizado pode visualizar, editar, excluir e restaurar lançamentos compartilhados.
- API n8n acessível; workflows financeiros identificados. A listagem não comprova a execução nem o uso do mesmo projeto Supabase.
- Corrigido upload de imagens: leitor JSON do endpoint agora comporta o limite de anexo existente, mantendo 4 KB nos demais endpoints.
- Corrigido falso sucesso no compartilhamento externo quando não há Clipboard API; falha mantém as ações abertas para nova tentativa.
- Notificações Telegram agora orientam revisão pelo dashboard, sem exigir comando com barra na mensagem.
- Validação inicial: 78 testes aprovados, um ignorado; build aprovado. Após correção do upload: 16 testes específicos aprovados, incluindo teste novo de tamanho e persistência.
- Pendente: compartilhamento de PDF (ação externa atual envia texto; API de anexos transacionais atual aceita imagens), entrega real de notificações, revisão visual mobile e comparação das conexões de banco dos workflows ativos.
- Alterações desta etapa são locais; publicação em produção ainda não verificada.
- Verificação adicional em 01/10: um job do dashboard continua queued desde 24/09/2026 15:36 UTC, sem atualização. Não há evidência de processamento desse pedido; investigar serviço worker e conexão de banco.
- Mensagens do chat agora distinguem pedido com falha de fila atrasada, evitando espera genérica indefinida. Não reprocessado automaticamente nenhum pedido financeiro antigo.


## 2026-10-20 — Banco e WhatsApp sincronizados

- [x] Adicionadas 21 tabelas e funções pendentes sem alterar lançamentos existentes.
- [x] Versionadas nove migrations WhatsApp recuperadas do histórico remoto.
- [x] Preservados Agent nativo, OpenAI, imagens, áudio, confirmação, edição/exclusão, menções, typing, follow-up, alertas e resumo falado do n8n. Os workflows/credenciais não foram reimportados.
- [x] Guards da fila e pagamento híbrido preservados; funções financeiras sem EXECUTE público.
- [x] Visão Casal optativa para os dois logins; históricos pessoais preservados.
- [x] 86 testes passaram, sem skips; lint, typecheck e build passaram.
- [x] Banco real: dados existentes e quatro definições WhatsApp inalterados; resumo Casal igual ao ledger para ambos.
- [x] Oito baselines históricos regularizados com autorização explícita em 20/10/2026; somente metadados, sem reexecutar DDL. Verificação sem versões financeiras pendentes e hashes de lançamentos, voz e funções inalterados. Correspondência em supabase/production-history.json.

Operação e limites: supabase/README.md. Limites/lembretes WhatsApp permanecem autoritativos para os avisos do grupo; flags avançadas web não foram ativadas automaticamente.


## 2026-10-20 — Correção de múltiplas movimentações no WhatsApp

O agente de texto e áudio aceita até dez movimentações por mensagem, incluindo entradas e saídas juntas. Mostra cada item e os totais separados antes de confirmar; preserva valores iguais como registros distintos. Receita não é anunciada como compra, e pagamento de fatura não implica pagamento feito no cartão. Foram preservadas credenciais, voz, estado de conversa e idempotência dos lotes. Testes e contrato sem segredos: n8n/finance-text-batch. Não reprocessar mensagens antigas já confirmadas parcialmente.


## 2026-10-20 — Pagador: persistência e integração WhatsApp

- [x] Regras puras revisadas por subagentes: pagador diferente de remetente/confirmador; cadastro por carteira e valores em centavos.
- [x] Escopo multicartiera com período e cobertura explícitos; páginas não são anunciadas como total mensal.
- [x] Persistência validada isoladamente com todas as migrations, auditoria real, grants/RLS e pagamento híbrido preservado.
- [x] Corrigidos replay com carteira divergente, UUIDs canônicos, duplicatas no cadastro e metadados fora do recorte.
- [x] Migration aplicada em produção como 20261020220846; vínculos administrativos de Ni e Ionara conferidos. Nenhum backfill histórico.
- [x] Antes/depois do schema: os dez lançamentos do grupo mantiveram exatamente o mesmo digest; zero atribuições históricas.
- [x] Suíte completa local: 179/179 testes, zero skips; lint e build aprovados.
- [x] Patch n8n: propostas mostram pagador congelado; novos eventos preservam recordKey; falha de metadado não altera status financeiro nem repete pagamento.
- [x] Contexto RPC testado no n8n real com as credenciais existentes.
- [x] Cinco cenários de intenção/classificação passaram individualmente no n8n; cinco recibos de envio de simulação ao grupo registrados. Os fluxos temporários foram desativados.
- [x] Patch do bot publicado e versão ativa conferida: f0f464c4-d59c-4948-ad05-95af9d77920d. Estado da conversa, credenciais, settings, voz e monitor de áudio preservados. 53 verificações VM aprovadas, incluindo 17 regressões de lote.
- [x] Filtro e rótulos por pagador implementados no painel Casal: nova RPC de leitura com filtros antes da paginação, API com conta da sessão, UI segura e períodos preservados.

Operação, limites e comandos: docs/transaction-attribution.md e n8n/payer-attribution/README.md. A PR16 mantém o código e o contrato sem segredos para revisão.

## 2026-10-20 — Pagador no painel

- [x] Consulta adicionada sem substituir a RPC Casal antiga ou escrever no ledger.
- [x] Migration aplicada como 20261020223443; ambos os logins conferidos no banco real para all/unknown/participant/joint.
- [x] Totais mensais e IDs de linhas sem filtro iguais ao contrato antigo; dez lançamentos e zero atribuições históricas preservados.
- [x] 182 testes gerais, 19 da nova consulta e integração all-migrations aprovados, sem skips; lint/build aprovados.
- [x] Casal oferece filtro por tipo/pessoa e labels de histórico/conjunto; outros escopos e datas preservados.

A evidência final de CI e publicação acompanha a PR16 e a implantação Vercel correspondente. Áudio de conclusão autorizado para o mesmo grupo WhatsApp, somente depois da conferência da publicação.


## 2026-10-22 — Correção de reconhecimento das imagens

- [x] Causa reproduzida: modelo anterior recusava a solicitação HTTP400; alias de texto não extraía pagamentos.
- [x] Rota multimodal existente validada com a imagem original: três itens de R$4,98, R$10,00 e R$5,27, total R$20,25.
- [x] Validação de bytes/MIME e resposta estruturada; lotes inválidos não viram propostas parciais.
- [x] Data ausente fica explícita antes da confirmação, preservada pela resposta direta. Pagador permanece desconhecido.
- [x] Retry somente da leitura Gemini, no máximo duas tentativas com intervalo de 2 segundos para erros transitórios HTTP503.
- [x] 30 testes de imagem, 53 de pagador e 17 de lote aprovados. QA nativa da cadeia até a resposta final aprovada sem escrita/envio.
- [x] Publicado e ativo: 3f344999-861b-4fa6-ba47-6e32d70caed0. Nós e conexões partiram da versão publicada; draft inativo incompleto foi preservado em backup privado.
- [x] Credenciais, settings, voz e estado da conversa preservados. Doze lançamentos existentes com digest idêntico antes/depois.
- [x] Relatório TESTE/SIMULAÇÃO enviado uma vez ao grupo verificado, com recibo confirmado; workflow temporário desativado.

Código, contrato sanitizado e limites em n8n/image-reading. Imagens reais, snapshots completos e segredos não integram o repositório.
