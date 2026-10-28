# Navegação fixa no rodapé do app

Base: `ddf18d2d0528cffef4b2a3463c2528398dfa6915`. Branch: `fix/mobile-app-navigation`.

## Comportamento

A navbar passa de uma cápsula flutuante para um rodapé contínuo de largura total, fixo no limite inferior da viewport útil. Os quatro botões mantêm as ações e seleção existentes. O conteúdo continua rolando e tem espaço final para tornar o último item acessível acima do rodapé. O botão do assistente permanece acima da navbar.

- Android WebView: o contêiner nativo já reserva as barras do sistema. O módulo de viewport reconhece a ponte `FinanceAndroid` existente e não soma novamente `env(safe-area-inset-bottom)`.
- Navegadores: continuam usando a área segura CSS uma única vez, incluindo a área do indicador de gestos.
- Navbar: 64 px de área funcional; no navegador, soma apenas a área segura. Alvos de toque: 56 px. Sem margem inferior, arredondamento externo ou espaço de conteúdo visível abaixo da barra.
- Rolagem: `position:fixed`, sem handlers de scroll ou novos loops de animação.
- Animação de autenticação: aplica-se à workspace, em vez do ancestral da navbar. Um transform em um ancestral muda o bloco de referência de elementos fixos; a navbar fica fora desse transform.
- Teclado: quando há foco editável e redução substancial da viewport, oculta navbar e botão do assistente temporariamente. Eles reaparecem ao restaurar a viewport ou encerrar a edição, sem saltar para cima do teclado. A detecção é uma heurística de viewport, não uma nova permissão Android.

Nenhuma alteração em código nativo, permissões, interceptação de botões do Android, autenticação, APIs financeiras, banco, integrações, lembretes ou notificações. Nenhuma dependência adicionada. A correção é web e funciona no APK existente após publicação web aprovada; não exige outra compilação APK.

## Validação

Build/typecheck e testes existentes executados. Playwright usa APIs financeiras e ponte nativa simuladas, com assets do build local; não faz lançamentos financeiros reais. A cobertura acrescentada mede a posição da navbar antes/depois de rolar, distância zero da borda inferior, largura completa, último registro visível acima do rodapé, safe-area de 28 px aplicada uma vez no navegador e zero vezes no WebView que já recebe insets nativos, e redução de viewport simulando teclado com foco em campo. Também verifica posição durante a animação completa de entrada e depois da navegação.

As evidências finais estão em `docs/evidence/docked-mobile-navigation-20261028.json`. A captura real do usuário motivou esta correção; não há aparelho Android físico ou emulador conectado para repetir a medida dos insets/IME reais. A validação em dispositivo permanece pendente. Os testes anteriores verificavam apenas a altura e não exigiam distância zero da borda inferior; essa lacuna agora está coberta.

A primeira execução do novo cenário de safe-area tentou inserir uma tag style, bloqueada pela CSP estrita do teste. O fixture foi ajustado para configurar uma propriedade CSS pela CSSOM; não houve relaxamento da política de segurança da aplicação.

## Publicação e rollback

Manter a correção isolada para revisão. Publicação de produção depende da aprovação explícita do usuário. Reverter o commit desta branch restaura a barra flutuante anterior, sem rollback de dados. A PR de versão Android 1.3.2 é independente e não é integrada por esta correção.
