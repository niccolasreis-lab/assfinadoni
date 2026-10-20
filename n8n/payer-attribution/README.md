# Identificação de pagador no n8n

`build-private.py` lê somente o snapshot privado revisado em `n8n-work/payer-live-before.json`, gera `n8n-work/payer-live-proposed.json` (modo 0600) e exporta `contract.json` sem credenciais, telefones, cabeçalhos de autenticação ou origem privada do RPC. Não chama a API do n8n nem publica nada.

O contexto de pagadores é consultado após as preferências de voz e antes do áudio. Erro/indisponibilidade fica como `available:false`; mensagens sem pagador explícito continuam no caminho legado. Um pagador explícito indisponível ou inválido impede toda a nova proposta financeira, pedindo esclarecimento. Não registrar parcialmente o lote.

Cada nova despesa pode ter seleção individual, conjunta ou desconhecida. Os IDs são validados contra o cadastro ativo verificado, e os nomes aparecem por item antes da confirmação. A seleção fica congelada na proposta. A confirmação por outra pessoa não muda quem pagou. Novas propostas com `payerFrozenVersion:1` usam a resposta verificada diretamente, inclusive quando o pedido veio por áudio, impedindo a IA de conversa de omitir esses nomes.

As fórmulas e a ordem de `recordKey` ficam intactas. Somente lançamentos novos recebem `source=API` e `external_event_id=wa:<sourceMessageId>:<itemIndex>`. Autoria de origem permanece nula. Depois dos ramos de gravação/duplicidade, o hook de metadados só aceita despesa com esse evento exato, proposta confirmada e pagador explícito congelado. Histórico sem vínculo não é preenchido automaticamente.

O resultado do RPC só confirma identificação quando `ok=true`, carteira, lançamento, kind e todos os participantes retornados coincidem com a seleção congelada. Erro mantém o status financeiro e informa identificação pendente, sem pedir que o casal reenvie os pagamentos. Os RPCs novos não têm retries. O timeout é de 5 segundos por consulta/chamada, preservando o limite de execução existente e o watchdog.

## Validação

- `python n8n/payer-attribution/build-private.py`: constrói a proposta local privada e verifica preservação de settings, staticData, credenciais e todos os nós não alterados.
- `node n8n/payer-attribution/test.cjs`: 53 checks VM, incluindo a regressão original de 17 casos de lote, comparação das chaves antigas e novas, troca de confirmador, erros de contexto/RPC, labels de propostas de áudio e consulta limitada aos 50 registros recentes, com nomes verificados do cadastro e esclarecimento para aliases sem vínculo.

Não confundir esses testes com testes de integração reais no grupo. É necessário aplicar os RPCs já validados, conferir as associações administrativas e revisar a versão atual antes de publicar. O build é baseado na versão indicada em `baseVersionId`; não substitui um workflow alterado posteriormente sem revisão.

## Aplicação e publicação

Reutilizar a origem e as credenciais Supabase dos nós existentes conforme o builder; não substituir placeholders por segredos dentro do Git. Ao atualizar pelo n8n, omitir staticData e conferir as credenciais/versionId e os nós de voz/watchdog. Publicação e mensagens de QA são responsabilidade da etapa autorizada de integração, não deste builder.

## Evidências de 20/10/2026

Patch ativo, após cinco cenários nativos individuais aprovados e relatórios de simulação aceitos pelo WhatsApp. Nenhum lançamento financeiro foi criado pelos testes. Os workflows de QA foram desativados. `validation.json` registra os cenários e recibos; `deployment.json` registra a versão publicada e a preservação de estado, credenciais e monitor de áudio. Recebimento no aparelho/leitura não foi afirmado. O filtro visual no painel permanece pendente.
