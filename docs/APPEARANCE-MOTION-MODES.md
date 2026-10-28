# Configurações > Aparência > Animações

## Comportamento

- Desativadas (`off`): CSS e Web Animations ficam sem movimento. Diálogos e navegação continuam funcionando.
- Suaves (`soft`, padrão): fades curtos de até 140 ms em diálogos/páginas, feedback discreto dos botões; sem animação de altura nos details e sem entrada decorativa dos cards/gráficos.
- Completas (`full`): movimentos de entrada, expansão de details e efeitos dos cards. Não restaura WebGL ou blur mobile; navbar compacta permanece.
- `prefers-reduced-motion: reduce` desativa os efeitos em qualquer modo e informa o motivo na tela, sem substituir a escolha salva. Ao desligar a preferência do sistema, a escolha volta a valer.

A preferência é local ao aparelho/navegador, compartilhada entre as abas da mesma origem. A chave `finance_motion_v2` armazena `off`, `soft` ou `full`; uma escolha anterior `finance_motion_v1=off` é preservada. Ausência de configuração, valor desconhecido ou armazenamento bloqueado resultam em Suaves; bloqueio de storage mantém a opção em memória durante a sessão.

O seletor tem rótulo e descrição acessíveis; mudanças não recarregam a página ou apagam formulários. Transições em andamento terminam de modo consistente ao trocar a preferência. A API binária anterior `setMotionEnabled` é mantida como compatibilidade (true→Suaves, false→Desativadas).

## Escopo e verificação

A configuração aplica-se ao dashboard e ao conteúdo web reutilizado pelo APK. Nenhuma alteração em permissões, código nativo, serviços de notificação, autenticação, regras financeiras, integrações ou banco. A capa nativa de abertura continua respeitando a configuração de animações do Android. Não é necessário gerar outro APK para esta configuração web.

Testes de preferências cobrem os três modos, migração da opção anterior, valores inválidos, storage indisponível, prioridade do sistema, mudança entre abas e frames/duração de Suaves versus Completas. Playwright verifica o seletor nos quatro tamanhos, persistência e a preferência do sistema, junto dos fluxos de regressão existentes. As evidências finais ficam em `docs/evidence/appearance-motion-modes-20261028.json`.

Rollback: reverter o commit desta funcionalidade para a base `537366f3c6679089f303a7bb108a05a2a8647499` e publicar a versão web anterior. A chave v1 foi preservada; a chave v2 não altera dados financeiros. Não há migração de banco nem novo pacote/dependência.
