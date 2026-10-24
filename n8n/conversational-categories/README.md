# Categorias e consultas em conversa natural

O fluxo carrega o catálogo verificado da carteira antes dos caminhos de texto, áudio e anexos. A intenção recebe esse catálogo, o contexto recente da mesma pessoa e ações estruturadas. A IA interpreta linguagem livre; o workflow valida a ação e executa somente os parâmetros permitidos. O resultado verificado informa o que foi criado, proposto ou consultado. A resposta de intenção solicita somente campos relevantes em um JSON completo, sempre com intent; ações none e defaults não precisam ser repetidos. Os orçamentos maxTokens passam para6000 nos modelos de intenção (antes2200) e conversa (antes650), acomodando raciocínio sem truncar JSON, frases ou valores. A intenção pede somente campos relevantes; a conversa pede mensagem curta e completa, até2parágrafos quando não houver lista verificada a preservar. Modelos, endpoints, credenciais, timeouts e retries permanecem idênticos.

## Categorias

`category_action` tem `action: none|create|list|apply|clarify`, `name` e `target: none|pending|selected|recent`. `apply_all` e `item_numbers` permitem uma seleção explícita na proposta mostrada. O campo legado `category` continua sendo nome ou null; um objeto `category` com action também é aceito para compatibilidade.

- Nomes têm de 2 a 60 caracteres e usam as mesmas letras, números e pontuação simples aceitos pela RPC. Grafia e acentos são resolvidos pelo catálogo, preservando o nome canônico cadastrado. Criar uma categoria conhecida também chama a RPC idempotente, permitindo persistir nomes que só existiam no histórico.
- Criar categoria é metadado; não registra nem reclassifica despesas existentes. Aplicar na proposta muda somente a categoria dos itens escolhidos e reapresenta a confirmação, preservando origem, valores, direções, pagamento e pagador. Aplicar em registro selecionado ou último registro identificável cria a mesma proposta de edição usada pelo fluxo atual; a escrita continua dependendo da confirmação financeira existente.
- Um lote exige todos os itens ou posições explícitas. Mudança da proposta durante uma criação assíncrona não autoriza aplicar a categoria à nova proposta. Alvos ambíguos pedem esclarecimento.
- O contexto de categoria é limitado à carteira, conversa, remetente e 15 minutos. Um pedido de nova categoria pode conservar os dados originais que faltavam para retomar a conversa, mas criar o rótulo não confirma nem registra aquela movimentação.
- Categoria explícita desconhecida não vira silenciosamente `Outros`. Sem categoria explícita, as inferências legadas continuam disponíveis. O rótulo `Recorrencia` não cria uma agenda de pagamentos; pedidos reais de recorrência conservam o aviso de suporte atual.

## Consultas

`financial_query` tem `action: none|list|total|breakdown`, datas ISO opcionais, tipo receita/despesa, categoria do catálogo, busca textual de até 120 caracteres e limite de 1 a 50 itens exibidos. Somente esses filtros tipados chegam à RPC; SQL livre, carteira escolhida pela IA e campos de pagador não são aceitos. Consultas por pessoa conservam o caminho de identificação existente ou pedem esclarecimento; nomes de pessoas não viram filtros de estabelecimento para produzir um falso zero.

`inherit: true` reaproveita filtros verificados da mesma pessoa por até 15 minutos. Campos omitidos permanecem; null remove um filtro explicitamente. Datas inválidas, categorias desconhecidas, filtros não suportados e indisponibilidade geram esclarecimento ou falha de leitura, sem estimativas inventadas.

O retorno da RPC deve confirmar cobertura completa e fornecer totais antes da limitação da lista. A resposta mostra quantos itens foram exibidos e quantos correspondem aos filtros. O limite de exibição não significa subtotal dos últimos N itens; `subset_only: true` esclarece pedidos desse recorte ainda não suportado. Descrições exibidas são limitadas a 180 caracteres, mantendo totais e cobertura integrais. O breakdown usa exatamente `{category,type,count,total}`. Respostas sem totais numéricos válidos, com cobertura incompleta ou filtros divergentes não são anunciadas como resultado nem guardadas como consulta verificada.

## Construção e verificação

`python n8n/conversational-categories/build-private.py --source /caminho/privado/workflow.json` lê uma base explicitamente revisada, prepara o snapshot privado `category-live-proposed.json` e exporta somente código, prompts, rotas e identificadores de RPC sanitizados em `contract.json`. Não usa rede nem publica. Credenciais, URLs, cabeçalhos, configurações HTTP existentes, estados e configurações globais permanecem no ambiente privado. A integração adiciona somente três chamadas RPC e seus nós de decisão/resultado; os nós financeiros, voz, idempotência e monitor de áudio continuam intactos.

`node n8n/conversational-categories/test.cjs` executa 42 verificações sem rede, banco ou envio: criação/duplicidade/canonização, limites de nomes, indisponibilidade, contexto, propostas e edição, filtros, continuação, cobertura, breakdown, anexos e proteção de dados. Os testes também sobrepõem os nós atuais aos contratos de regressão: 53 verificações de pagador incluindo os lotes, 20 de clareza de entrada e 30 de imagem. As expressões dos três corpos RPC também são verificadas sem delimitadores internos `}}`; o payload vazio de listagem usa `Object.fromEntries([])` para evitar interpretação prematura pelo n8n. Os modelos e RPCs reais, a publicação e a limpeza dos workflows de QA são validados separadamente pela integração autorizada.

## Publicação validada

Versão ativa `1a8a88a7-a770-439c-8dab-a4c3a581d57a`,125nós, em23/10/2026. Migration aplicada e sincronizada no repositório como `20261024005716_finance_whatsapp_custom_categories_query.sql`. Oito casos com modelos e RPCs reais passaram individualmente: criação de Recorrencia, repetição com acento, total mensal, continuação para mês passado, lista com limite3, breakdown completo, categoria em proposta de2itens e conversa livre sem truncamento. Nenhum nó financeiro de escrita ou envio existia no workflow isolado, que foi excluído ao terminar.

A categoria solicitada foi criada uma única vez. Os16 lançamentos existentes mantiveram o mesmo digest durante testes e publicação. As duas carteiras pessoais dos logins são diferentes da carteira compartilhada; aAPI de categorias agora usa as associações explícitas da sessão para listar nomes visíveis, mantendoPOSTrestrito à carteira pessoal. Opções preservam nomes exatos porque os filtros do painel usam igualdade exata; aRPCconversacional resolve equivalências dentro da carteira.

Validação local:228testes backend, zero skips; lint ebuild aprovados, além dos42checks do workflow. Antes de publicar, aQA nativa detectou e corrigiu um delimitador de expressão daRPC e uma resposta da intenção truncada no orçamento antigo. Ambos os modelos de interpretação/conversa conservam modelo, endpoint, credenciais, timeout e retries; somente o orçamento e as instruções de completude foram ajustados.

Uma consulta somente de leitura também passou pela entrada autenticada do próprio workflow principal. O resultado verificado apareceu no grupo com recibo identificado, sem lançamento ou alteração financeira. A simulação usou contexto separado para não herdar filtros da pessoa real.
