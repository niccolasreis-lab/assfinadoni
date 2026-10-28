# Fluidez e navbar mobile — 28/10/2026

Continuação da PR 21, sem publicação de produção. Referência anterior: c812145cbffb5ee19cbca285d19fde69e74a7c9d.

## Problema e mudanças

A captura enviada mostra uma barra inferior com grande faixa vazia abaixo dos botões. O CSS acumulava padding de safe-area com blur na superfície fixa. O WebView também já protege as bordas nativas; a captura é compatível com espaçamento redundante, mas não foi possível medir os insets no aparelho do usuário.

- Barra mobile passa a ter altura limitada a 72 px, padding interno de 6 px e área segura posicionada fora da barra. Os quatro botões mantêm pelo menos 44 px de altura de toque, textos, ações e seleção. O conteúdo mantém espaço final para rolar além da barra.
- Blur da navbar e do backdrop de modais é desativado no mobile; fundo fixo decorativo e animação ampla de entrada de todos os cards também são desativados. Feedback breve de pressão e animações funcionais de abertura/fechamento permanecem.
- Decoração WebGL do assistente é retirada do caminho de renderização. Mensagens, gravação, anexos, envio, confirmação e polling continuam iguais.
- Texto de carregamento é estático e não importa mais o runtime Motion. A camada reutilizável de movimento do dashboard continua disponível.

## Evidências e limites

Build anterior da PR: loading-island.js 487,93 KB (127,46 KB gzip), mais jsx-runtime 11,49 KB e chunk WebGL carregado sob demanda de 1.116,37 KB (259,16 KB gzip).

Build otimizado: loading-island.js 317,72 KB (83,18 KB gzip); nenhum chunk WebGL gerado. Redução de aproximadamente 35% no arquivo principal da ilha React. Os pacotes instalados não foram alterados; o código decorativo sem consumidores não entra no build. Essa redução é medida de tamanho de bundle, não garantia de FPS ou de redução proporcional na RAM.

Os testes completos e Playwright são registrados em `docs/evidence/mobile-fluidity-20261028.json`. O navegador usa fixtures e ponte Android simulada, sem alterar dados financeiros reais. Há verificações novas de altura da navbar, ausência de blur, limite da viewport e tamanho de toque. Navegação, formulários, cancelamento, gráficos, responsividade e movimento reduzido continuam cobertos.

Não foram feitos testes em dispositivo físico, perfil CPU/RAM/bateria ou teste real de teclado Android/insets. Não há nova compilação APK nesta correção: os arquivos alterados são da camada web reutilizada pelo APK. O APK 1.3.1 já entregue continuará carregando o dashboard hospedado; estas mudanças só chegarão a ele depois de um deploy web aprovado.

Nenhuma modificação em autenticação, Supabase, regras financeiras, n8n, Evolution, OCR, notificações, lembretes ou permissões Android. Nenhuma dependência adicionada ou removida.

## Rollback e liberação

Reverter apenas o commit desta otimização restaura a aparência anterior, sem migração de banco. O controle de animações em Configurações continua funcionando. Antes da publicação, revisar a PR e testar no aparelho afetado; depois do deploy aprovado, verificar rolagem, navbar, teclado, Voltar e abertura do assistente no mesmo dispositivo. Não declarar o travamento resolvido no celular sem essa conferência.
