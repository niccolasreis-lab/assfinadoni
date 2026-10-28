# Assistente de Finanças — Android 1.3

APK assinado para instalação direta, Android 8 ou superior. A tela principal agora utiliza o dashboard completo dentro do aplicativo, com a mesma interface verde, animações, gráficos, filtros e funções web, junto da integração nativa de notificações, arquivos e microfone.

Consulte [PARITY.md](PARITY.md) para a matriz de funções, limites e validação. O aplicativo requer conexão para carregar o dashboard; os alarmes locais sincronizados podem funcionar sem rede. Push imediato FCM e biometria ainda não foram configurados.

## Compilar

JDK 17 completo, SDK 35, Gradle 8.9. `gradle clean :app:assembleDebug :app:testDebugUnitTest`.

Release: definir FINANCE_KEYSTORE, FINANCE_KEYSTORE_PASSWORD, FINANCE_KEY_ALIAS e FINANCE_KEY_PASSWORD, e executar `gradle clean :app:assembleRelease :app:testDebugUnitTest`. A chave deve ser a mesma das versões 1.2.x. Nunca publique a chave ou suas senhas no repositório.

Instalação: atualizar sobre o APK 1.2.x assinado com a mesma chave. Nenhuma conta ou lançamento é criado pela instalação. Em Lembretes → Notificações neste aparelho, permitir avisos e testar o aviso Android. Alarmes exatos dependem de permissão adicional e o Android pode atrasar avisos aproximados.
