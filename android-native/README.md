# Assistente de Finanças — Android nativo

Aplicativo Android em Kotlin + Jetpack Compose e Material 3. Não usa WebView e não salva dados financeiros offline.

## Abrir

1. Abra a pasta `android-native` no Android Studio.
2. Use JDK 17 e Android SDK 35.
3. Sincronize o Gradle e execute o módulo `app`.

A API de produção é configurada em `BuildConfig.API_BASE_URL`. A sessão HTTP é guardada criptografada no Android Keystore. Requisições de escrita enviam o cabeçalho de origem exigido pelo backend.

## APK

O workflow `android-apk.yml` gera `app-debug.apk` como artefato em cada alteração do app Android. Para produção, configure uma chave de assinatura no GitHub e crie uma variante release assinada.
