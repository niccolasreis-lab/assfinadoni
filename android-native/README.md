# Assistente de Finanças — Android 1.2

Aplicativo nativo Kotlin/Compose, Android 8 ou superior (minSdk 26, target 35). Instalação direta por APK; não exige Play Store. Usa a API HTTPS existente, mantém a sessão criptografada no Android Keystore e não inclui chaves do Supabase ou senhas de usuário.

## Disponível

- Login, lançamentos pessoais e compartilhados, consulta à carteira Casal do WhatsApp, sem permitir alteração dos registros do casal pelo app.
- Tema verde; layouts adaptativos; anexo de imagem pelo seletor Android.
- Mais → Lembretes: consultar, criar e cancelar contas pendentes; criação de lembrete não lança despesa.
- Notificações locais discretas, com ação Abrir lembretes. Botão de teste de notificação.
- Agendamento 3 dias, 1 dia e no vencimento, respeitando as opções do registro existente e horário de Brasília.
- Sincronização por WorkManager quando há rede, no mínimo de 15 minutos, sujeita ao Android; atualização ao abrir/voltar ao aplicativo e manualmente.
- Reagendamento após reinicialização/atualização e cancelamento dos agendamentos ao sair da conta. Notificações só usam a preferência notify_push dos lembretes, mas são agendamentos locais, não FCM.
- Dashboard completo acessível pelo navegador em Mais, para funções ainda não portadas (concluir pagamento, edição avançada, relatórios, perfil etc.).

## Limites e validação no aparelho

Push imediato FCM NÃO está configurado: requer projeto Firebase, google-services.json e credencial do servidor, além de registro/revogação de tokens por usuário. Não foi substituído o Web Push que atende ao site. Os fluxos WhatsApp, banco e dashboard não são modificados por este módulo.

É necessário permitir notificações. Sem acesso a alarmes exatos, usa alarmes aproximados. Economia de bateria, aparelho desligado, parada forçada e revogação de permissões podem atrasar ou impedir os avisos. Alteração remota só cancela um alarme local após sincronização. Lembretes pessoais da conta são consultados; pendências do casal precisam estar disponíveis numa API autorizada antes de serem incluídas.

Validar em aparelhos reais: login de cada conta; alternância Pessoal/Casal; criar lembrete sem valor; permitir/negar notificações; botão Testar aviso; horário agendado com app fechado; perda de rede; reinicialização; cancelamento; logout; troca de conta; revogação de alarme exato. Não considerar compilação ou testes de datas como prova de entrega no Android real.

Biometria, captura de câmera dedicada, FCM e compartilhamento de arquivos recebidos de outros apps ainda não estão implementados nesta versão.

## Compilar

JDK 17, Gradle 8.9, SDK 35. `gradle :app:assembleDebug :app:testDebugUnitTest`. Para release, definir FINANCE_KEYSTORE, FINANCE_KEYSTORE_PASSWORD, FINANCE_KEY_ALIAS, FINANCE_KEY_PASSWORD e executar `gradle :app:assembleRelease`.

A mesma chave precisa assinar todas as atualizações. Guarde o backup de assinatura fora do repositório. Um APK assinado por outra chave não atualiza uma instalação anterior com o mesmo applicationId.
