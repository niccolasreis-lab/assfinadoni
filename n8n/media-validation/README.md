# Validação de mídia

Contrato sanitizado do código publicado em `e63920df-e77f-44b0-8463-74b85a18e837`.
Nenhuma credencial, configuração privada HTTP, mídia real ou identificador pessoal é incluído.

Execute `node n8n/media-validation/test.cjs`.

Cobertura: PDF textual versus digitalizado, limite de páginas, OCR com valor incerto,
áudio inaudível, preservação de negações na transcrição, erro do provedor e montagem
da requisição com o combo `pagos_gpt_SOL-copy`. Esses testes não fazem chamadas externas.

## Verificação isolada em 30/10/2026

Um workflow temporário no mesmo n8n reutilizou as credenciais e os nós ativos de OCR
e interpretação. Usou um PDF de uma página contendo somente uma imagem de recibo
sintético. O serviço local extraiu 117 caracteres; OmniRoute retornou R$18,50, PIX,
data 2026-10-30 e descrição da padaria. Não houve escrita financeira nem envio ao
WhatsApp. O workflow foi desativado após a chamada.

Os testes de API de anexos, sessão e carteira do casal passaram (7 testes), incluindo
acesso permitido por vínculo e negado sem vínculo. Isso não substitui uma sessão
real da segunda pessoa do casal.

## Pendências para aceite

- Áudio falado real: confirmar reconhecimento e proposta no WhatsApp antes de salvar.
- PDF digitalizado real: confirmar proposta, guarda automática e download.
- Segunda conta: abrir o mesmo lançamento e comprovante; verificar isolamento pessoal.
- Falha deliberada de OCR em PDF digitalizado: atualmente a recuperação direta pela
  OmniRoute aceita imagens; PDF digitalizado depende de OCR. Ainda não declarar
  recuperação de PDF funcionando sem testar uma rota compatível.
- Implementar confirmação uniforme para texto/áudio, detecção de reenvio do mesmo
  comprovante, recuperação de anexo pendente, edição auditada da carteira do casal
  e as quatro áreas fixas do dashboard aprovadas.

## Áudio: diagnóstico isolado

O provedor principal aceitou WAV silencioso e retornou `intelligible=false` com
transcrição vazia. Isso valida a recepção de áudio e a resposta segura a silêncio,
mas não valida fala real ou valores monetários falados.

O provedor alternativo respondeu indisponibilidade de serviço em duas verificações.
Não alterar o fluxo produtivo nem considerar o fallback aprovado só por existir.
O teste final usa no máximo duas tentativas com intervalo de dois segundos.

Resultado da última tentativa: o alternativo continuou indisponível mesmo com retry
limitado. Nenhuma mudança foi aplicada ao workflow principal. Todos os workflows de
QA criados nesta rodada foram desativados.

A consulta restrita à carteira do casal confirmou duas contas vinculadas e ativas.
Isso confirma a configuração do vínculo; a sessão da segunda conta permanece
pendente de verificação visual.
