# Leitura de imagens — correção publicada

A rota antiga usa um modelo Codex que rejeitou a imagem com HTTP400. O alias do agente de texto também não extraiu os pagamentos. O caminho multimodal existente de Gemini foi validado separadamente com a imagem original, sem escrita financeira ou envio ao grupo.

O builder altera somente:

- A saída verdadeira de `Anexo é imagem?` para `Preparar anexo IA` → `Ler anexo com Gemini`.
- `Preparar anexo IA`: valida base64, MIME JPEG/PNG/WebP e assinatura dos bytes apenas para imagens. Áudio/PDF preservam o comportamento anterior.
- `Normalizar anexo IA`: aceita Chat/Gemini/Responses, rejeita recusas/estrutura malformada/tipos inválidos e explica o uso da data atual quando a data não aparece. Apenas uma proposta validada recebe `verifiedAttachmentProposal: true`.
- `Resposta verificada?`: preserva essa proposta diretamente somente com a flag estritamente verdadeira e estado `aguardando_confirmacao`, mantendo o aviso de data, valores e confirmações existentes.
- `Ler anexo com Gemini`: somente envelope de retry limitado; nenhuma configuração HTTP é exportada no contrato sanitizado.

A leitura Gemini apresentou HTTP503 por alta demanda em QA nativo. Somente `Ler anexo com Gemini` recebe retry limitado a duas tentativas totais, com 2 segundos entre elas. Nenhum nó financeiro ou de envio recebe retry. Parâmetros HTTP, credenciais, modelo/URL Gemini, timeouts, conversão compartilhada de mídia, nós OpenAI antigos, fluxo financeiro, propostas legadas e staticData permanecem preservados. A leitura gera somente proposta pendente. Pagador não é inferido da imagem, do encaminhamento nem do remetente.

`python n8n/image-reading/build-private.py` usa por padrão `n8n-work/image-reviewed-base.json`; `--source /caminho/privado/base.json` seleciona outra base explicitamente revisada. A base padrão preserva metadados/configuração/estado atuais, com nós e conexões da versão ativa conferidos separadamente; não usa o draft inativo com parâmetros financeiros ausentes. O builder lê essa base e grava `image-live-proposed.json` privado. Exporta apenas código/rota sanitizados para `baseline-contract.json` e `contract.json`; não faz chamadas externas.

`node n8n/image-reading/test.cjs --baseline n8n/image-reading/baseline-contract.json` compara 30 checks antes/depois. O novo contrato passa 30/30; o baseline demonstra as falhas corrigidas. O runner verifica formatos permitidos/rejeitados, preservação de áudio/PDF, três pagamentos totalizando R$20,25, lotes inválidos, pagador desconhecido, ausência de escrita automática e o caminho normalizador → preparação da conversa → guard estrito → resposta verificada, preservando o aviso de data sem reescrita pela IA.

Regressões: `node n8n/finance-text-batch/test.cjs` (17) e `node n8n/payer-attribution/test.cjs` (53). A QA nativa final incluiu extração e o caminho Interpretar lançamento → Preparar conversa → Resposta verificada? → Usar resposta verificada. Reconheceu os três pagamentos, total R$20,25, e preservou o aviso de data, sem envio ou gravação financeira. Versão publicada e ativa conferida em 2026-10-22: `3f344999-861b-4fa6-ba47-6e32d70caed0`. Os 12 lançamentos existentes conservaram o mesmo digest antes/depois; configurações, credenciais, estado e nós financeiros/voz preservados. O rascunho inativo anterior foi guardado privadamente e não foi usado como configuração financeira.
