# PRD — assfinadoni

## Objetivo

Evoluir o assfinadoni para uma plataforma financeira conversacional, multimodal,
proativa e auditável, preservando os contratos existentes de Web/PWA, Telegram,
Supabase e APK. O sistema usa somente dados fornecidos pelo usuário e não
implementa Open Finance.

## Arquitetura aprovada

- **Canais:** Web/PWA, APK Android, Telegram, texto, áudio, imagem e PDF.
- **Backend:** Vercel Functions para HTTP, Supabase/PostgreSQL para domínio e
  RLS, worker Docker para mídia e processamento assíncrono.
- **IA:** n8n pode permanecer como provedor de interpretação, mas acessa o
  domínio somente por ferramentas tipadas do backend.
- **Dados:** `finance_transactions` continua sendo o contrato legado. Novos
  domínios usam migrations aditivas e RPCs autorizadas por usuário.
- **Segurança:** nenhuma chave de serviço no cliente; anexos privados usam
  referências e URLs assinadas; operações sensíveis geram auditoria.

## Contratos e invariantes

1. Toda entrada externa possui `source`, chave idempotente e hash do payload.
2. O mesmo evento nunca cria dois efeitos financeiros.
3. Duplicidade é uma hipótese revisável; uma transação legítima nunca é apagada
   apenas por valor igual.
4. O LLM não consulta tabelas diretamente. Ferramentas validam escopo, schema,
   autorização, confirmação e auditoria.
5. Valores realizados, comprometidos e estimados ficam separados.
6. Exclusões são confirmadas e preservam o histórico conforme a retenção atual.
7. Feature flags permitem rollout e rollback sem remover dados.

## Feature flags

Os padrões são desativados até validação por fase:

`ASSISTANT_ENABLED`, `ENABLE_AI_AGENTS`, `ENABLE_SMART_ALERTS`,
`ENABLE_SMART_CATEGORIZATION`, `ENABLE_INVESTMENTS`, `ENABLE_FORECAST`,
`ENABLE_GOALS` e `ENABLE_MCP`.

## Limites explícitos

Não haverá conexão automática com bancos, consentimento bancário, sincronização
de contas, agregação bancária ou infraestrutura de Open Finance. Investimentos,
ativos e passivos são cadastrados manualmente.

