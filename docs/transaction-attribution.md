# Identificação de quem pagou

Status em 20/10/2026: persistência e integração WhatsApp publicadas, com identidades verificadas e cinco cenários nativos aprovados individualmente. O filtro e os rótulos do painel Casal foram implementados na etapa seguinte.

## Comportamento

- Quem envia e quem paga são informações distintas. O remetente só pode ser proposto como pagador quando declarar explicitamente que pagou.
- Cada despesa mostra o pagador antes da confirmação. A seleção fica congelada: outra pessoa confirmar não substitui o pagador pelo confirmador.
- Participantes vêm do cadastro administrativo da carteira, vinculado às contas ativas e à associação explícita do casal. Nomes e IDs produzidos pelo modelo são propostas, sem autoridade própria.
- Histórico sem identificação continua como “Não identificado”. Não há backfill pelo nome, telefone, proprietário, voz, cartão ou descrição.
- Pagamento conjunto exige pessoas distintas verificadas. Não implica divisão meio a meio, não duplica o gasto nem aumenta o total individual de cada participante.
- Daniel ou outro beneficiário não vira pagador por ser destinatário de um pagamento.
- Participante inativo não recebe novas atribuições, mas o histórico identificado pode continuar sendo consultado.
- A autoria de origem permanece desconhecida nesta etapa. Quem confirma a atribuição é auditado separadamente e não vira autor original.

## Persistência e autorização

`finance_wallet_participants` é um cadastro privado. `finance_transaction_attributions` guarda metadados separados do ledger. Ambas têm RLS, sem acesso por anon/authenticated. As RPCs novas são SECURITY INVOKER, executáveis somente pelo backend.

`finance_set_transaction_attribution` exige conta ativa, associação à carteira, confirmação, participantes válidos e revisão esperada. A mesma chave com o mesmo conteúdo é idempotente; retries antigos não desfazem revisões novas. Uma divergência entre a carteira da atribuição e a carteira atual do lançamento é recusada inclusive no caminho de replay.

`finance_whatsapp_payer_context` resolve a identidade a partir do vínculo administrativo de WhatsApp e retorna participantes sem telefones. `finance_whatsapp_set_payer` exige despesa ativa, confirmação e evento exato de uma ingestão nova (`source=API`, `external_event_id=wa:<mensagem original>:<item>`). Não anota histórico sem essa prova e não cria transações.

As escritas de atribuição serializam pelo mesmo lançamento com FOR UPDATE. Os testes locais usam PGlite e não medem concorrência entre conexões PostgreSQL reais. Não foram fabricadas despesas na base de produção para esse teste.

A migration foi gerada pelo Supabase CLI como `20261020215110`; após aplicação pela ferramenta oficial, o arquivo foi alinhado à versão efetivamente registrada, `20261020220846`. Não houve reparo de histórico nem reexecução de migrations anteriores. Ver `supabase/production-history.json`.

## Integração e compatibilidade

O patch do bot consulta contexto de forma opcional antes do processamento de áudio. Sem contexto, movimentos sem pagador explícito continuam compatíveis; uma identificação explicitamente pedida exige esclarecimento em vez de ser descartada. Propostas novas usam resposta direta verificada para preservar os nomes antes da confirmação, inclusive em áudio transcrito.

As chaves financeiras recordKey são preservadas. A identificação é gravada depois do resultado financeiro e possui status separado: uma falha informa identificação pendente, sem anunciar falha do pagamento ou pedir seu reenvio. Não há caminho de retry do metadado para o nó de criação financeira.

A consulta por pessoa usa somente os até 50 lançamentos recentes disponíveis e explicita esse recorte. Ausência de atribuição significa desconhecido; receitas e lixeira não entram. Não anuncia esse recorte como total mensal. A visão Casal existente continua com o resumo mensal independente da página.

`payer-attribution-scope.js` valida escopo multicartiera, período e cobertura completa/paginada, e permanece disponível para consumidores de resumos completos. O painel usa uma consulta própria com filtros no banco antes da paginação, mantendo o resumo mensal separado.

## Validação e operação

- Regras puras: 30 casos; escopo multicartiera: 16 casos.
- Persistência e integração com todas as migrations: 47 testes após hardening, incluindo auditoria real e preservação de pagamento híbrido.
- n8n: 53 verificações VM, incluindo as 17 regressões originais de lote, hashes, troca de confirmador e falhas de RPC.
- Suíte completa final: 179/179 testes, zero skips. Compilação e lint aprovados. CI ampliada para regressões financeiras, SQL, n8n e build, sem segredos de produção.
- Contexto RPC executado com sucesso no n8n usando as credenciais existentes. Antes/depois da migration: os dez lançamentos do grupo mantiveram o mesmo digest e nenhuma atribuição histórica foi criada.

Comandos locais:

```sh
cd dashboard
FINANCE_SQL_TEST_MODULE=@electric-sql/pglite node --test --test-concurrency=1
pnpm run lint
pnpm run build
cd ..
node n8n/payer-attribution/test.cjs
```

Os cinco cenários nativos (primeira pessoa, outro pagador, conjunto, beneficiário e confirmação por outra pessoa) passaram. Cada relatório de simulação teve aceite do serviço WhatsApp com ID de mensagem; isso não comprova leitura ou recebimento no aparelho. Workflows temporários foram desativados. Recibos: `n8n/payer-attribution/validation.json`. A versão ativa do bot e as preservações verificadas estão em `n8n/payer-attribution/deployment.json`.

O contrato versionado do bot está em `n8n/payer-attribution/contract.json`; snapshots completos e vínculos de identidade permanecem privados. Para reverter a integração, restaurar os nós e conexões revisados da versão anterior sem substituir staticData ou credenciais. Manter os metadados e os lançamentos existentes, sem reprocessar mensagens antigas.

## Filtro no painel Casal

A visão Casal mostra “Quem pagou”: todos, não identificado, pagamentos individuais, uma pessoa cadastrada ou pagamentos conjuntos. Selecionar uma pessoa inclui seus pagamentos individuais; conjuntos têm opção separada. Receitas aparecem em Todos e mostram “não se aplica”. O histórico não identificado continua desconhecido, sem backfill.

`finance_dashboard_couple_payer_transactions` é uma nova RPC de leitura. Delega à RPC antiga a autorização, os filtros anteriores e o resumo mensal; enriquece as linhas com labels de pagador e filtra no banco antes de OFFSET/LIMIT. Devolve somente participantes das carteiras autorizadas, sem contatos. A API obtém a conta da sessão, aceita UUID opcional apenas no filtro individual e rejeita IDs não autorizados. A RPC antiga permanece intacta.

Trocar pagador reinicia a página. O filtro só é enviado em Casal; Minhas, Compartilhadas e Todas mantêm seus períodos e comportamento. Nomes recebidos são renderizados como texto. Despesas conjuntas não são divididas ou somadas novamente.

Validação desta etapa: 182 testes gerais aprovados sem skips; 19 novos testes da consulta e uma integração com todas as migrations aprovados; lint e build aprovados. Os testes incluem mais de 50 linhas por participante, paginação, homônimos em carteiras distintas, lixeira, participante inativo, metadata inválida, XSS e isolamento por sessão. No banco real, ambos os logins retornaram os mesmos IDs/totais da consulta antiga, para todos os filtros aplicáveis, e os dez lançamentos mantiveram o digest anterior.

A migration foi criada pelo CLI como 20261020223006 e alinhada ao registro real da ferramenta, 20261020223443. A consulta é somente leitura; reverter o handler e a interface mantém o caminho antigo sem apagar dados.

Limite da verificação visual: o browser público exige login e o ambiente de testes não disponibilizou o binário local do navegador. Os testes da interface executam os eventos reais do app em DOM isolado; não representam um login manual de produção.
