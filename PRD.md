# Assistente de Finanças — PRD

## 1. Visão

Aplicação de controle financeiro pessoal para Nicolas e Ionara, com dashboard web, APK Android nativo e assistente no Telegram. O produto deve permitir registrar, revisar, compartilhar e acompanhar receitas, despesas, contas futuras e comprovantes usando texto, áudio e imagens.

## 2. Status atual

- Dashboard web publicado em Vercel.
- Autenticação por sessão com Supabase como persistência.
- APK Android nativo em Jetpack Compose, sem WebView, gerado por GitHub Actions.
- Telegram integrado ao fluxo de lançamentos e lembretes.
- Lançamentos com edição, exclusão recuperável e compartilhamento.
- Lançamentos futuros tratados como lembretes/agendamentos até serem pagos.
- Categorias padrão e categorias personalizadas por usuário.
- Imagens JPG, PNG e WebP anexáveis a receitas e despesas, com validação de tamanho e acesso.
- Compartilhamento externo de lançamentos pelo Android e navegador, usando o menu nativo de apps sociais.
- Verificação de versão do APK com card de atualização e download iniciado pelo CTA.

## 3. Usuários e permissões

Cada conta possui seus próprios lançamentos e categorias. Um lançamento pode ser compartilhado com a outra conta; nesse caso, as duas pessoas podem visualizar e gerenciar o registro conforme o vínculo. APIs exigem sessão e validam origem nas operações de escrita.

## 4. Funcionalidades

### Lançamentos

- Criar receita ou despesa.
- Definir valor, categoria, descrição e data.
- Agendar despesa futura.
- Editar um lançamento existente.
- Excluir para a lixeira e restaurar por até 30 dias.
- Compartilhar, encerrar compartilhamento e confirmar o impacto para a outra conta.
- Compartilhar externamente com WhatsApp, Telegram, Instagram, e-mail e outros apps.
- Anexar imagem do comprovante; a imagem fica vinculada ao lançamento.

### Categorias

- Exibir categorias padrão.
- Criar categoria personalizada pelo web e pelo APK.
- Isolar categorias por usuário.
- Usar categorias personalizadas em filtros, totais e lançamentos.

### Dashboard

- Resumo mensal de saldo, receitas e despesas.
- Despesas agrupadas por categoria.
- Histórico dos últimos meses.
- Filtros por texto, categoria, tipo e intervalo de datas.
- Menu de ações ao tocar em uma linha: editar, excluir e compartilhar.

### Telegram

- Conversa natural sem exigir comandos com barra.
- Texto, áudio e anexos para interpretação de lançamentos.
- Confirmação de lançamentos identificados.
- Exclusão do lançamento mais recente por linguagem natural.
- Lembretes e confirmação de pagamentos agendados.

## 5. Requisitos não funcionais

- Interface em português do Brasil.
- Layout responsivo e acessível no dashboard web.
- APK Android com navegação e modais nativos.
- Dados protegidos por sessão, RLS e checagem de propriedade/compartilhamento.
- Imagens limitadas a JPG, PNG ou WebP e aproximadamente 1 MB por anexo.
- Evitar duplicidade de lançamentos quando uma mensagem ou anexo for reprocessado.

## 6. Arquitetura

- `dashboard/`: frontend estático, APIs serverless e integração Supabase.
- `supabase/migrations/`: schema versionado de categorias e anexos.
- `android-native/`: app Kotlin/Compose.
- GitHub Actions: compilação e publicação do APK como artefato.
- Vercel: hospedagem e execução das APIs.

## 7. Critérios de aceite

1. Usuário autenticado cria uma categoria e a utiliza em novo lançamento.
2. Usuário anexa imagem a uma despesa e consegue reencontrá-la pelo lançamento.
3. Outro usuário não consegue ler ou anexar imagem em lançamento sem acesso.
4. Toque em qualquer linha abre ações de editar, excluir e compartilhar.
5. Data futura pode ser agendada e não entra no total até ser paga.
6. APK mantém as mesmas regras de dados e oferece os mesmos campos principais do dashboard.

## 8. Próximas evoluções

- Galeria de anexos no detalhe do lançamento.
- Compressão automática e armazenamento de imagens no Supabase Storage.
- Deduplicação por hash/idempotência no Telegram.
- OCR de comprovantes e revisão dos campos extraídos.
- Separar visualmente ações de compartilhamento externo e compartilhamento entre contas.
- Relatórios exportáveis e notificações nativas.

## 9. Contratos e invariantes
1. Toda entrada externa possui `source`, chave idempotente e hash do payload.
2. O mesmo evento nunca cria dois efeitos financeiros.
3. Duplicidade é uma hipótese revisável; uma transação legítima nunca é apagada
   apenas por valor igual.
4. O LLM não consulta tabelas diretamente. Ferramentas validam escopo, schema,
   autorização, confirmação e auditoria.
5. Valores realizados, comprometidos e estimados ficam separados.
6. Exclusões são confirmadas e preservam o histórico conforme a retenção atual.
7. Feature flags permitem rollout e rollback sem remover dados.


## 10. Feature flags
Os padrões são desativados até validação por fase:

`ASSISTANT_ENABLED`, `ENABLE_BUDGETS`, `ENABLE_AI_AGENTS`, `ENABLE_SMART_ALERTS`,
`ENABLE_SMART_CATEGORIZATION`, `ENABLE_INVESTMENTS`, `ENABLE_FORECAST`,
`ENABLE_GOALS` e `ENABLE_MCP`.

## 11. Limites explícitos
Não haverá conexão automática com bancos, consentimento bancário, sincronização
de contas, agregação bancária ou infraestrutura de Open Finance. Investimentos,
ativos e passivos são cadastrados manualmente.
