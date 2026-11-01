# Assistente parado na fila — diagnóstico e proteção

## Diagnóstico operacional

A consulta autorizada encontrou três pedidos do dashboard em `queued`, todos com zero tentativas, sem lease e sem resultado. Não havia pedido com arquivo PDF. O consumidor da fila não está assumindo os pedidos deste banco; isso ainda não distingue serviço parado, ausência de implantação ou configuração incorreta na VPS.

A interface bloqueia Enviar enquanto existir um pedido queued/processing. Assim, a leitura do PDF nem chegou a ser iniciada pelo worker. A captura de tela mostra a mensagem de espera, não um erro do extrator PDF. Não foi obtida uma cópia do PDF do usuário e não houve reprocessamento ou escrita financeira durante esta investigação.

O worker existente roda separadamente da Vercel (`dashboard/worker/index.js`, Dockerfile em `dashboard/worker/Dockerfile`). Depende de configuração privada de Supabase e n8n; PDF usa Poppler, e PDF digitalizado também depende da visão configurada. O estado da API web não comprova que esse worker esteja disponível.

O acesso à VPS/EasyPanel não estava disponível nas conexões desta investigação; a restauração do consumidor e o teste real com PDF permanecem bloqueados até obter esse acesso. Não se deve declarar este incidente resolvido apenas com a correção da interface.

## Correção preparada, ainda não publicada

- API acrescenta indicação `stalled` a pedidos queued antigos, sem expor payload, arquivo ou lease.
- Botão explícito “Cancelar pedido parado”. Requer sessão, mesma origem e propriedade do pedido.
- Só cancela queued há pelo menos dois minutos, attempts=0, sem lease/token. O PATCH repete essas condições atomicamente; uma corrida com claim do worker retorna conflito e preserva o processamento.
- Cancelamento não executa operações financeiras. Limpa somente o payload do pedido cancelado, marca resultado cancelled/changed=false e preserva um resultado final de cancelamento para retries idempotentes.
- Pedidos processing, com tentativa anterior ou com resultado incerto não são cancelados por essa ação.
- O polling passa a reconciliar o snapshot atual, retirando pedidos expirados da memória do componente. Uma revisão local impede uma resposta GET antiga de desfazer a aceitação/cancelamento mais recente.
- Rascunho e PDF selecionado permanecem intactos durante o cancelamento.

Não há migração, mudança em RLS, credenciais ou serviço WhatsApp/n8n. Nenhum job de produção foi cancelado pela investigação. Não houve deploy de produção.

## Validação e próximos passos

Testes cobrem validação/mídia já existente, fila antiga versus nova, propriedade, origem, sessão, corrida de claim, idempotência e resposta pública sem campos privados. Navegador com fixtures cobre pedido travado, cancelamento, manutenção do rascunho e envio de PDF simulado em 360/768/1024/1440 px, além das regressões existentes. As evidências ficam em `docs/evidence/assistant-queue-20261028.json`.

Esses testes não substituem iniciar/verificar o worker real. Próximo passo: acessar o EasyPanel autorizado, conferir serviço/container/logs e variáveis exigidas pelo worker sem expor valores, restaurar o consumidor e testar primeiro uma conversa sem efeito financeiro. Reenvio de documentos reais deve evitar duplicidades e respeitar as confirmações existentes.

Rollback: reverter o commit desta branch. A mudança do endpoint é aditiva; não há alteração de esquema ou cálculo. A PR fica em rascunho até restaurar o serviço e autorizar a publicação.
