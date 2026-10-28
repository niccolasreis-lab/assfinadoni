# Auditoria e entrega incremental — 28/10/2026

## Escopo e referência estável

Branch: `feature/premium-motion-ui`. Base para rollback: `6d2659ca49e9db2a57a18b49b0d2d41e5f9aed36` (APK 1.3.0). Tag local: `rollback/premium-motion-ui-20261028`.

Nenhuma publicação de produção, alteração de credenciais, migração de banco ou modificação de n8n/Evolution/OCR foi feita nesta entrega. O vídeo citado no pedido não estava anexado; o trabalho segue os critérios descritos e a identidade verde existente.

## Diagnóstico anterior às novas alterações

- Dashboard Vite 8.3.0, TypeScript 7.0.2, React/ReactDOM 19.3.0 e Motion 13.4.0, com módulos JavaScript para a maioria dos fluxos. Não é Next.js.
- Android Kotlin 2.0.21, AGP 8.7.3, compile/target SDK 35, mínimo 26. Launcher `DashboardActivity`: WebView seguro com ponte limitada à origem do dashboard. Compose legado permanece disponível no código; não houve reconstrução.
- Fluxos: login/logout, navegação, perfis, transações e confirmação de exclusão, filtros, histórico e categorias, relatórios, lembretes, anexos e assistente. As rotas financeiras continuam fornecendo os valores dos gráficos.
- Baseline web: 245 testes aprovados, 1 opcional ignorado; typecheck e build aprovados. Já existiam avisos de diretivas `use client` no bundle e um chunk Three/WebGL de aproximadamente 1,1 MB (259 KB gzip). Não houve aumento de dependências.
- A auditoria retomou alterações locais de abertura do APK e animações iniciadas na etapa anterior, preservando-as. Os artefatos temporários de ferramentas da etapa anterior precisaram ser reinstalados; resultados antigos não foram usados como prova de testes desta entrega.

## Riscos e medidas

| Risco | Medida |
|---|---|
| Fechamento atrasado confirmar uma exclusão | Cancelamento explícito; fechamento repetido retorna a mesma operação; geração impede callback antigo de fechar diálogo reaberto |
| Modais React montados depois da inicialização | Observador instala animação de forma idempotente; sem substituir conteúdo/formulários |
| Capa do APK permanecer sobre uma página funcional ou desaparecer antes do desenho | Estado de inicialização, prazo de 35 s, prontidão do DOM e callback de estado visual; erro oferece tentar novamente |
| Callback de sincronização recriar alarmes após logout | Pausa imediata, geração e revalidação do cookie; ajuste isolado motivado pela corrida encontrada na auditoria, sem mudar datas/regras dos lembretes |
| Consumo decorativo em segundo plano | WebGL respeita movimento reduzido, preferência local e visibilidade; listeners removidos na desmontagem |
| APK externo trocado ou downgrade | HTTPS e host/caminho permitidos, sem redirects, limite 50 MB, tamanho exato, SHA-256, pacote, versão e assinatura instalada |
| Perda de autorização de instalação | Android controla a permissão e a confirmação; o aplicativo não instala silenciosamente |

## Arquivos e responsabilidades

- `dashboard/public/motion.js`: camada reutilizável de apresentação para diálogos, expansão de details, entrada de páginas e preferência local. Usa Web Animations; não acrescenta uma segunda biblioteca nem envolve regras financeiras em componentes novos.
- `dashboard/public/glass.css`: popovers, gráficos e mensagens; profundidade/pressão já existentes preservadas; desligamento global e movimento reduzido.
- `dashboard/components/ui/shining-text.tsx`: texto de abertura respeita o controle local e movimento reduzido, sem alterar o estado de carregamento.
- `dashboard/components/ui/canvas-effect.tsx`: suspensão do efeito decorativo quando desativado ou em segundo plano; ciclo de vida dos listeners revisado.
- `dashboard/scripts/verify-redesign.cjs`: testes de interrupção, cancelamento, rascunho, flags, atualização simulada e amostras de frames.
- `dashboard/api/app-version.js`, `dashboard/tests/app-version.test.js`: metadados públicos adicionais de integridade; contrato anterior preservado.
- `android-native/.../DashboardActivity.kt`, `StartupGate.kt`, `StartupGateTest.kt`: abertura, falhas de renderização e callbacks antigos; integração com o instalador Android.
- `android-native/.../assets/dashboard-native.js`, `AppUpdater.kt`, `ReleasePolicyTest.kt`: consulta, card de atualização, ação explícita e verificação antes da instalação.
- `android-native/.../ReminderScheduler.kt`: proteção contra sincronização atrasada após logout.
- `android-native/app/build.gradle.kts`: versão de testes 1.3.1, código 6. Permissões não foram acrescentadas.

## Atualizador e publicação futura

A rota existente `/api/app-version` recebe apenas configuração pública de release: `ANDROID_VERSION_CODE`, `ANDROID_VERSION_NAME`, `ANDROID_APK_URL`, `ANDROID_APK_SHA256`, `ANDROID_APK_SIZE_BYTES` e `ANDROID_RELEASE_NOTES`. Nenhuma dessas configurações foi alterada em produção nesta entrega.

O endereço deve ser um APK imutável no bucket público `android-releases` do projeto Supabase já utilizado. O bucket e o upload **não foram criados**. Não há motivo para alterar tabelas financeiras ou políticas do banco para este recurso.

O APK consulta ao abrir a interface e ao voltar ao primeiro plano, com intervalo mínimo de uma hora; há também consulta manual em Configurações. A interface mostra card, versão, notas e botão. Só baixa após toque. Não existe notificação de atualização em segundo plano nesta versão; o pedido permite card como alternativa.

A primeira instalação que introduz o atualizador precisa ser manual. Versões futuras só aparecem depois que o APK assinado é hospedado e os metadados publicados. A versão anterior 1.3.0 não ganha essa capacidade remotamente. O usuário precisa autorizar a origem e confirmar a instalação no Android; negar ou cancelar não remove a versão instalada.

O APK continua usando o dashboard hospedado em produção. As alterações web desta branch só aparecerão nele após uma publicação web aprovada. Os testes de UI desta entrega usam build local com APIs interceptadas, inclusive a ponte nativa simulada; não são prova de execução no aparelho.

## Rollback

1. Efeitos: em Configurações, selecionar “Animações: desativadas”. Para suporte técnico, `localStorage.setItem('finance_motion_v1','off')` e recarregar. Movimento reduzido do sistema também os desliga.
2. Antes de merge/deploy, basta manter a branch sem publicação; produção permanece na base estável.
3. Depois de publicação aprovada, reverter o commit da branch e publicar novamente a versão web estável. Não é necessário rollback de banco.
4. Android não aceita downgrade normal de versionCode. Para corrigir um APK distribuído, compilar o código estável com código de versão maior e a mesma assinatura. Evitar desinstalação, que remove dados locais.
5. Para interromper a oferta de uma release, retirar seu URL dos metadados públicos. Isso não altera os lançamentos financeiros nem o APK instalado.

## Checklist de liberação (ainda não liberada)

- [ ] Validar APK assinado em aparelho real: instalação sobre 1.3.0 preservando sessão, abertura sem rede, retry e retorno após suspensão.
- [ ] Validar botão Voltar com teclado, modais, anexo/câmera/microfone e formulário preenchido.
- [ ] Validar notificações/reinício/horário exato/segundo plano em Android suportado, incluindo permissão negada.
- [ ] Hospedar APK imutável, verificar assinatura e SHA-256 após download e configurar metadados públicos.
- [ ] Executar atualização 6→7 de teste: sucesso, cancelamento, permissão negada, rede interrompida e hash/assinatura inválidos.
- [ ] Medir CPU, memória, bateria e frames em aparelho real com efeitos ligados/desligados; não inferir 60 FPS a partir do computador.
- [ ] Smoke test autorizado das integrações em homologação; não criar movimentações de teste nas carteiras reais.
- [ ] Obter aprovação explícita para produção.

## Evidências finais executadas

| Verificação | Resultado |
|---|---|
| Node, contratos e SQL isolado | 246 aprovados, 0 falhas, 1 ignorado; 247 casos no total |
| Teste SQL real opcional de lembretes | Ignorado: sem ambiente de banco de teste dedicado; não substituído por escrita em produção |
| Typecheck, Vite e lint | Aprovados; 117 arquivos JavaScript verificados |
| Playwright dashboard + ponte Android simulada | Aprovado em 360, 768, 1024 e 1440 px; zero erros inesperados |
| Playwright lembretes | Aprovado em 360 e 1440 px; criação/edição, validação, conclusão atômica simulada, cancelamento, permissão negada, offline, conta antiga e logout |
| Android clean assembleRelease e testDebugUnitTest | BUILD SUCCESSFUL; 75 tarefas; contagens JUnit no JSON de evidências |
| APK | 1.3.1, código 6, 12.943.794 bytes; assinatura verificada e igual à 1.3.0 |
| Dispositivo real/emulador | Não executado |
| Integrações externas em produção | Não executadas nesta rodada; contratos cobertos localmente, sem escritas financeiras reais |

O teste de navegador inclui abrir/reabrir/fechar rapidamente, callbacks antigos, rascunho preservado, cancelamento explícito pelo Voltar, formulário, confirmação, Tab/Escape, filtros, gráficos, relatório, estados vazios/erro, toggle desligado e prefers-reduced-motion. O atualizador foi simulado para consulta, card e comando de download; a instalação Android real permanece pendente.

Medição sintética: 30 intervalos requestAnimationFrame por modo e largura (240 intervalos). P95 entre 16,7 e 16,8 ms com efeitos ligados ou desligados. Não é medição de bateria, CPU, RAM nem garantia de 60 FPS no celular. Bundle React passou de 127,34 para 127,46 KB gzip; chunk decorativo WebGL passou de 259,09 para 259,16 KB gzip. CSS/JS públicos não empacotados não estão incluídos nesses dois números. Nenhuma dependência adicionada/removida.

Falhas finais: nenhuma nos testes executados. A primeira chamada do runner Node interpretou uma flag como nome de arquivo; foi corrigida para `node --test --test-concurrency=1` e a suíte completa passou. Permanecem os avisos existentes de `use client`, ícones Compose obsoletos e símbolos da biblioteca nativa não removidos; nenhum impediu os builds.

As evidências estruturadas e suas limitações estão em `docs/evidence/premium-motion-20261028.json`. Esta entrega não constitui liberação de produção.
