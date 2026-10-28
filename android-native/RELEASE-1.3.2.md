# Android 1.3.2 — código 7

Base: `ddf18d2d0528cffef4b2a3463c2528398dfa6915`.

Esta versão atualiza o número do aplicativo para distribuição e mantém o mesmo pacote `br.com.assfinadoni` e a chave de assinatura das versões anteriores. Não altera permissões, autenticação, lógica financeira, notificações ou integrações.

O dashboard é carregado de `https://assfinadoni.vercel.app/` e já contém navbar mobile compacta, retirada do efeito 3D decorativo e Configurações > Aparência > Animações (Desativadas, Suaves por padrão, Completas). A preferência de movimento reduzido do sistema tem prioridade. Esses arquivos web não são copiados para dentro do APK; o aplicativo precisa de conexão para abrir o dashboard.

Instalar por cima da versão anterior, sem desinstalar, para preservar os dados locais. A assinatura do APK deve ser comparada com a versão 1.3.1 antes da distribuição. A instalação ainda depende da confirmação do Android.

O cliente de atualização verificada permanece no código, mas a distribuição automática por card depende de hospedar o APK e publicar metadados válidos em `/api/app-version`. Esta entrega do arquivo não ativa esse canal nem solicita novas permissões.

Validação desta geração: clean assembleRelease, testDebugUnitTest, inspeção do pacote/versão e comparação da assinatura. As contagens e o SHA-256 finais constam em `docs/evidence/android-1.3.2.json`. Não foi executado teste em aparelho físico ou emulador nesta geração.

Resultado final: clean build aprovado; 18 testes Android aprovados, sem falhas ou testes ignorados. Pacote e versão conferidos; assinatura válida e idêntica à 1.3.1. Tamanho: 12.943.790 bytes. SHA-256: `341853bd2670a08082ca104dc9897b905174622997d3973f382dc51fbf1caa25`.
