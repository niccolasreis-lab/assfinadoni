# Resposta e acompanhamento de áudio no WhatsApp

O fluxo aceita os envelopes temporários conhecidos do WhatsApp, mantém as tentativas de transcrição e entrega falha/resultado verificado sem uma segunda chamada à IA. O download usa até duas tentativas de 15 segundos; a transcrição principal, duas de 20 segundos; a alternativa, uma de 25 segundos. Somente operações de leitura são repetidas. O envio de mensagens e as gravações financeiras não recebem retries novos.

Um subworkflow assíncrono espera 25 segundos a partir do início do processamento de áudio e consulta exclusivamente a execução de origem. Se ela ainda não entregou resposta, envia um aviso de processamento. Em erro/crash envia um aviso que orienta conferir os lançamentos antes de reenviar pagamentos: erro de resposta não comprova rollback de uma operação financeira. Depois do aviso de processamento, aguarda mais 285 segundos e consulta novamente. O fluxo principal tem limite de 300 segundos; o monitor tem limite de 360 segundos. São limites de execução, sujeitos ao agendamento do n8n.

Resposta entregue suprime os avisos. Execução concluída/cancelada, 404, falha da API e execução de outro fluxo não geram mensagens. Não se presume erro em uma consulta inconclusiva. Os avisos não usam IA. Sucessos não são armazenados, como antes; o progresso da execução principal passa a ser salvo para permitir a checagem. O monitor não salva seu histórico. Uma indisponibilidade do próprio n8n, da API de consulta ou do WhatsApp ainda pode impedir o aviso; não há garantia de disponibilidade contínua ou entrega exatamente uma vez.

A consulta por pessoa explicita que a carteira compartilhada não identifica autoria e apresenta somente despesas recentes da carteira, sem chamar receitas de despesas ou atribuí-las a Ionara/Nícolas. A consulta é limitada aos 50 últimos registros, e a mensagem declara esse limite. Não cria atribuição retroativa nem lança pagamentos ausentes automaticamente.

## Reprodução

1. Leia e faça backup do workflow atual. Aplique `contract.json` por nome, preservando IDs/credenciais dos nós existentes. Os nós novos precisam de IDs únicos. Aplique os timeouts de `readOnlyNodeUpdates` em `parameters.options.timeout`.
2. No normalizador autenticado, mantenha a validação de origem e grupo; transforme `m` em variável e insira `unwrap-message.js` após obter a mensagem. Não publique o segredo do webhook.
3. Instancie `watchdog-template.json` no mesmo proprietário do workflow. Substitua os placeholders somente no ambiente privado. Reutilize URL e cabeçalhos de envio do nó de resposta existente e a chave fornecida para a API do mesmo n8n. Não coloque esses valores no Git. O acompanhamento depende de uma chave de API válida; é necessário renovar ou substituir a chave antes da expiração. A chave fornecida nesta retomada vence em 26/10/2026 às 00:00 de São Paulo, portanto não serve como credencial operacional permanente. O monitor recebe somente IDs de execução/fluxo/mensagem/grupo/remetente.
4. Publique o subworkflow e configure seu ID em `Iniciar acompanhamento do áudio`. Publique a versão principal; no PUT omita `staticData` e preserve as credenciais existentes. Confira `activeVersionId`, estado da conversa e credenciais após salvar.

## Validação

`node n8n/audio-reliability/test.cjs`: decisões de acompanhamento, supressão de duplicidade, erros de API, isolamento por execução/fluxo, consulta sem autoria, entrega direta e envelopes de áudio.

Também executar os 17 casos de `finance-text-batch/test.cjs` com o `Classificar comando` desta alteração sobreposto ao contrato anterior. O teste nativo usa workflows temporários sem nós de WhatsApp nem acesso ao banco financeiro: pai dispara o filho sem aguardar, filho consulta o pai e gera uma decisão de progresso, checagem posterior não repete o aviso. Esses testes não comprovam a transcrição de um áudio novo recebido no grupo.
