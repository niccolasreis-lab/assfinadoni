# Fila individual de propostas

A fila usa Supabase como estado autoritativo, com chave por carteira, grupo, pessoa e
mensagem original. Um comprovante novo não substitui o anterior. A leitura entrega
um conjunto de versões; a confirmação reivindica esse conjunto em uma transação,
e a conclusão altera somente as fontes efetivamente processadas.

- Até dez itens pendentes por pessoa e grupo; propostas expiram em trinta minutos.
- Mensagens repetidas da mesma origem não acrescentam outra proposta.
- Identificadores `wa:<mensagem original>:<índice original>` são preservados, inclusive
  quando a confirmação reúne comprovantes diferentes.
- Cada anexo vem do snapshot do comprovante original, sem consultar uma pendência
  global que possa ter sido substituída por outra execução.
- Duas confirmações concorrentes de versões incompatíveis não podem gravar juntas.
- Falha parcial devolve a fonte para pendente; a repetição financeira usa a mesma
  chave de idempotência. Uma confirmação interrompida pode ser retomada após o lease.
- Cancelamento lógico e RLS; apenas o backend executa a RPC. Sem exclusão física pelo
  fluxo. Conclusões removem referências de mídia da fila, preservando o anexo salvo.

## Preparação privada

O builder não acessa a rede e não ativa workflows. Requer uma exportação privada
contendo `activeVersion`, obtida por operador autorizado, e a versão esperada:

```
python n8n/pending-queue/build-private.py --source /caminho/privado/atual.json --output /caminho/privado/proposto.private.json --expected-version VERSAO_OBSERVADA
```

A exportação e o resultado contêm credenciais/referências privadas herdadas do
workflow e nunca devem ser versionados. O builder verifica contratos conhecidos e
interrompe se encontrar uma topologia ou versão diferente. Antes de publicar, valide
as pendências legadas, aplique a migração, faça backup da versão ativa e teste uma
cópia isolada sem nós de escrita financeira ou envio de mensagens.

## Testes

- `node n8n/pending-queue/test.cjs`: separação por pessoa, snapshots, eventos originais,
  anexos, conclusão por fonte, falha parcial e reivindicações inválidas.
- `node --test dashboard/tests/pending-queue.test.js`: execução real da migração em
  Postgres local, acúmulo de propostas, repetição, isolamento, versões, concorrência,
  limite da fila e permissões.

Em 31/10/2026, uma cópia temporária no n8n executou os nós de carregar, reivindicar,
preparar itens e concluir contra a fila real usando somente dados fictícios. Dois
itens mantiveram as origens e a fila terminou com zero pendências. Não houve escrita
financeira nem envio ao WhatsApp. A cópia foi desativada após o teste.

O teste em grupo com comprovantes novos após a ativação continua sendo o aceite
final; nunca use reenvio de um pagamento existente para esse teste.

Publicação conferida em 31/10/2026: versão ativa
`32157284-8a6e-480b-9144-4cb63fdf9d59`, com 147 nós. A versão anterior foi
preservada como backup inativo. Suíte do dashboard: 260 aprovados, 1 ignorado,
nenhuma falha; teste dedicado dos nós da fila também aprovado.
