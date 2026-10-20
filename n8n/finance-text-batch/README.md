# Várias movimentações na mesma conversa

Correção publicada no n8n em 20/10/2026. O agente nativo devolve new_transactions com até dez itens; cada item conserva receita/despesa, valor, descrição, data e pagamento. A proposta mostra os itens e separa entradas, saídas e resultado, exigindo confirmação antes de gravar. Lotes incompletos ou inválidos não são registrados parcialmente.

O novo chat model de intenção reutiliza a credencial OpenAI existente, com limite de saída suficiente para o lote. A voz, imagens, follow-up e preferências não foram modificados.

contract.json contém somente parâmetros e código dos nós, sem credenciais, staticData ou webhook. Preparar itens do lançamento é referência de regressão, sem alteração. Para reproduzir, atualizar os cinco nós existentes, criar o chat model de intenção e conectar somente AI Agent · intenção financeira a ele; a conversa continua no modelo existente. Preservar as credenciais de todos os nós e não enviar staticData ao atualizar o workflow.

Validação: node n8n/finance-text-batch/test.cjs (17 verificações). A IA real também passou a lista de quatro itens mistos e dois gastos distintos com valor igual. Esses testes não gravam lançamentos nem enviam mensagens no WhatsApp.

Recuperação do caso antigo: não reprocessar a mensagem completa já confirmada parcialmente. O salário já usa uma chave individual; reenviar o lote antigo poderia duplicá-lo. Solicitar confirmação somente dos pagamentos que ficaram de fora.

Os exemplos publicados usam valores e destinatários fictícios; nenhum dado financeiro real do teste foi incluído.
