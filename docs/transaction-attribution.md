# Identificação de quem pagou — primeira etapa

Status: regras de domínio implementadas, ainda sem integração ou publicação. O banco foi consultado somente para conferir a estrutura; não foram criadas tabelas nem alterados lançamentos. O módulo novo não é importado pelas rotas ou pelo bot.

## Comportamento definido

- Quem envia a mensagem e quem paga são informações distintas. A identidade autenticada do remetente nunca vira pagador por padrão.
- O cliente ou LLM pode propor um responsável; uma atribuição só será persistida após a confirmação do lançamento/proposta.
- A seleção recebe IDs de um cadastro de participantes carregado pelo servidor para aquela carteira. Texto, apelido e destinatário de um pagamento não são identidades de autorização.
- Registros sem atribuição, inclusive o histórico, continuam como "Não identificado". Não fazer backfill pelo nome, Telegram, proprietário da carteira, voz ou descrição.
- "Pagamento conjunto" exige pelo menos duas identidades distintas e confirmadas. Isso não é divisão de custos, não implica metade para cada pessoa e não é adicionado novamente ao total de cada uma.
- Um participante inativo não recebe novas atribuições. Sua identidade continua disponível para apresentar o histórico.
- Valores iguais de lançamentos distintos continuam separados. Duplicação da mesma linha em uma consulta não aumenta o total.
- O resumo recebe o recorte autorizado e filtrado por período; considera somente despesas ativas da carteira e trabalha em centavos. Ele não é um mecanismo de autorização e não calcula o saldo geral do casal.

## Integração planejada

A estrutura real de finance_transactions possui proprietário da carteira, origem e dados de pagamento, mas não um campo específico para pagador ou autor da mensagem. Não reutilizar user_id, updated_by_account_id ou payment_details para resolver essa ausência.

Preparar um cadastro de participantes por carteira, com associação administrativa explícita às contas/identidades do conector. O cadastro não pode ser fornecido pelo corpo da requisição. Metadados de atribuição devem ser vinculados ao lançamento existente e registrar pagador, autor autenticado, confirmação e auditoria separadamente. A ausência do metadado é válida e mantém compatibilidade com os canais antigos.

A persistência deve rejeitar participantes de outra carteira, preservar os vínculos ao restaurar da lixeira e impedir alteração de autoria/escopo pelo cliente. Não modificar as assinaturas dos RPCs usados pelo n8n sem uma camada compatível e testes dos fluxos existentes. Não aplicar DDL até gerar a migration pelo CLI e validá-la numa base isolada.

Rollout futuro: integração opcional sob ENABLE_PAYER_ATTRIBUTION, padrão desligado. Primeiro conferir schema e isolamento; depois integrar confirmação/consulta no WhatsApp e apresentar filtro no painel. O rollback desliga o recurso sem apagar metadados ou reprocessar lançamentos.

## Verificação

- 25 casos definidos em dashboard/tests/helpers/payer-attribution-cases.js.
- Esses mesmos casos foram executados no V8 disponível na sessão: 25 passaram. Isso não equivale à suíte Node, lint, build ou teste de banco.
- O runner Node usa node:test e node:assert/strict, sem dependências novas.
- Workflow próprio no GitHub Actions executa os casos em Node 22, com permissões somente de leitura e sem acesso a segredos/banco. Execução confirmada com sucesso no run 39457658676, commit b690bccc6d8b7f445a65651aa5dfe493e0fea3f7: os 25 casos passaram em Node 22.
- O terminal da sessão estava indisponível. Lint, build, migrations e testes completos de integração permanecem pendentes.

Comando: node --test dashboard/tests/payer-attribution.test.js

A implementação só estará disponível no produto depois de persistência, API, confirmação do bot e interface passarem pelos testes. Esta PR é uma base isolada para essa integração.


## Revisão da continuação

O cadastro agora rejeita IDs duplicados independentemente da ordem ativo/inativo; UUIDs são comparados de forma canônica. Metadados de transações fora do recorte selecionado não afetam o resumo. A visão Casal atual reúne várias carteiras e pagina os lançamentos: uma integração futura precisa particionar por carteira e declarar quando o resumo cobre apenas as linhas carregadas. O summary mensal existente deve permanecer separado.
