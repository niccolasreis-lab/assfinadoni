# Comprovantes após confirmação

O workflow ativo guarda somente a referência da mídia na proposta pendente. Depois da confirmação financeira, ele verifica o evento original, baixa a mídia pela Evolution e salva um anexo privado em `finance_transaction_attachments`.

- `prepare-confirmed.js`: somente resultados confirmados, mesma origem e lançamento salvo.
- `prepare-content.js`: valida PDF/imagem e limite de 900 KB.
- `restore-result.js`: preserva o lançamento se a guarda falhar.
- O HTTP de guarda usa a credencial Supabase existente no servidor, `on_conflict=id` e `Prefer: resolution=ignore-duplicates,return=representation`. O ID do anexo automático é o ID do lançamento, permitindo repetir a guarda sem duplicar.
- O normalizador conserva `attachment: {mediaMessage, mimeType, fileName}` na proposta. O comprovante não é salvo como outra movimentação.
- O bot informa quando o lançamento foi salvo mas o comprovante ficou pendente.

Credenciais, workflows completos e dados reais não são versionados.

Teste: `node n8n/attachments/test.cjs`.
