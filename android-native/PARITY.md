# APK 1.3 — paridade com o dashboard

A atividade principal carrega exclusivamente https://assfinadoni.vercel.app dentro de um WebView Android. O design, animações, gráficos, formulários e regras de apresentação são os mesmos do dashboard publicado; não há uma segunda implementação das regras financeiras. A versão nativa Compose anterior permanece no código, sem ser a tela inicial.

| Área do dashboard | Disponibilidade no APK |
| --- | --- |
| Login, sessão, senha visível, logout | Mesma interface e API; sessão WebView sincronizada ao armazenamento criptografado para lembretes |
| Visão geral, saldo, receitas, despesas e comparação | Mesma interface, com dados do usuário autenticado |
| Histórico de seis meses e categorias | Mesmos gráficos, tabelas acessíveis, estados de erro e nova tentativa |
| Transações, filtros, período, paginação e pesquisa | Mesmos controles e endpoints |
| Pessoal, compartilhadas, todas e Casal | Mesmas regras de acesso; Casal mantém somente leitura |
| Criar, editar, excluir, lixeira e restaurar | Mesmas confirmações e regras; sem gravações automáticas |
| Categorias e nome do cartão | Mesmos formulários existentes |
| Central financeira | Mesmas contas, cartões e parcelas já cadastradas |
| Relatórios | Mesmas visualizações do dashboard atual |
| Perfil, nome e foto | Mesmos controles; seletor de imagem Android |
| Comprovantes e assistente | Mesmos uploads e backend; seletor Android de imagens, PDFs e áudio; microfone depende de permissão |
| Compartilhar texto em outro app | Seletor nativo quando Web Share não é oferecido pelo WebView; o app não envia mensagens sozinho |
| Lembretes e revisão | Criar, editar, cancelar, revisar, concluir com confirmação e definir antecedência, horário e canais pela interface web |
| Notificações Android | Controles nativos substituem as opções Web Push que não são suportadas em WebView; mantém AlarmManager e WorkManager existentes |
| Capa e ícone | Imagem fornecida pelo usuário preservada; capa aparece durante a abertura |
| Teclado, rotação e botão voltar | Insets Android; rotação preserva o WebView; voltar fecha dialog antes de navegar |

## Segurança

A ponte de mensagens usa AndroidX WebKit com origem HTTPS exata e exige frame principal e página inicial do dashboard. Não usa addJavascriptInterface, não ignora erro TLS e não libera navegação file/javascript/intent. Links externos abrem fora da ponte. Uploads partem de escolhas do usuário. Microfone só é concedido para o domínio autorizado após a permissão Android. Arquivos escolhidos/baixados podem existir no cache privado; detalhes financeiros não são incluídos em notificações. Os cookies não são expostos ao JavaScript nem enviados para domínios externos. Download autenticado não segue redirects e limita tipo e tamanho.

Nenhum endpoint, migração, registro financeiro ou workflow WhatsApp é alterado por este pacote. A atualização usa a mesma chave das versões 1.2.x. Segredos de assinatura ficam fora do repositório.

## Limites

É necessária internet para abrir e operar o dashboard. Os lembretes locais já sincronizados continuam agendados sem rede, sujeitos às permissões e restrições de bateria. Atualizações remotas precisam ser sincronizadas para cancelar alarmes locais. O APK depende de Android System WebView atualizado.

Push imediato FCM e biometria continuam fora desta versão. A integração visual completa não transforma sincronização periódica em push. Não há leitura automática de notificações bancárias ou do WhatsApp.

## Verificação

- Suíte web: 245 aprovados, 1 opcional ignorado; lint e build aprovados.
- Chromium com respostas locais simuladas: 360, 768, 1024 e 1440 px, sem erros. Login, logout, navegação, histórico, categorias, perfil, formulários, lixeira/confirmador, estados vazio/erro, teclado e movimento reduzido. Ponte Android simulada: montagem, sincronização, teste de aviso e compartilhamento sem enviar mensagens reais. Executar de dashboard: `QA_ANDROID=1 CHROMIUM_EXECUTABLE=/caminho/chromium node scripts/verify-redesign.cjs`.
- Android: compilação release assinada e testes de datas/origem. Origem rejeita HTTP, domínio semelhante, porta não autorizada, credenciais na URL e esquemas locais.
- Permissão de microfone, câmera externa, retorno do seletor, entrega de avisos com aparelho bloqueado/reiniciado e comportamento de fabricantes exigem validação no celular real. Testes no Chromium não substituem esses testes físicos.
