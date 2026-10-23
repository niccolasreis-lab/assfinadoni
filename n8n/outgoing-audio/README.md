# Respostas por áudio no fluxo principal

O áudio de resposta é autorizado, preparado, gerado e enviado no mesmo workflow principal de WhatsApp. Uma solicitação de resposta em voz pode acompanhar respostas gerais; os resumos automáticos conservam sua preferência anterior. A interpretação usa `response_mode` sem alterar a intenção financeira. Pedido explícito de texto prevalece. Receber um áudio não ativa, sozinho, resposta falada.

A fala parte da mensagem textual já entregue com recibo, sem outra chamada de IA para recalcular dados. O preparo remove marcações/emoji, transforma valores monetários para fala e limita respostas longas, indicando que os detalhes completos permanecem no texto. O modelo e a voz existentes são preservados.

Apenas a geração TTS tem duas tentativas, com intervalo de dois segundos. Reserva, autorização, envio e confirmação conservam a proteção de evento/lease existente; envio ao WhatsApp ocorre uma vez. Timeout sem recibo é entrega incerta, não autorização para reenviar. Erros de preparação, geração ou autorização seguem um resultado explícito e podem avisar que o texto está disponível. Eventos recentes mantêm somente metadados de resultado, limitados a vinte, sem áudio ou conteúdo financeiro.

O monitor externo de áudio recebido é produção e continua referenciado; não foi confundido com testes descartáveis. Nenhum nó de lançamento, identificação de pagador, imagem, credencial, estado ou configuração global é substituído pelo builder.

## Verificação

`node n8n/outgoing-audio/test.cjs`: 30 verificações isoladas, sem rede/banco/envio, cobrem autorização semântica, recibos diretos/aninhados, preferência de texto, preparo, limites, áudio inválido, falhas, entrega incerta, metadados e configuração de retries. Regressões adicionais: `n8n/payer-attribution/test.cjs`, `n8n/finance-text-batch/test.cjs` e `n8n/image-reading/test.cjs`.

A QA nativa usa os modelos reais de intenção e TTS com banco e envio substituídos por fixtures; o WAV gerado foi decodificado independentemente. O contrato contém somente código, prompts e configurações sanitizadas. O builder lê snapshots privados e não chama APIs nem publica.

Publicado em 23/10/2026 na versão `deae5575-aa2c-4830-abcd-5cd705130eb4`. Uma simulação pela entrada autenticada do próprio principal entregou voz no grupo verificado; o arquivo recuperado foi decodificado como OGG/Opus mono de 48 kHz, com 7,213 segundos. Os doze lançamentos anteriores conservaram seu digest; dois lançamentos legítimos posteriores foram preservados, e nenhum lançamento veio do evento de QA. Dezenove workflows temporários antigos e o workflow novo de QA nativa foram excluídos após guardar evidências; produção não foi excluída.
