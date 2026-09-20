# Progresso do projeto

Atualizado em 20/09/2026.

## Concluído

- Dashboard web funcional em Vercel.
- Supabase conectado com autenticação, lançamentos, compartilhamento, lixeira e lembretes.
- Agendamento de despesas para datas futuras.
- Edição, exclusão recuperável, restauração e compartilhamento pela web.
- Menu de ações ao tocar/clicar em cada transação.
- APK Android nativo com Jetpack Compose e navegação própria.
- Fluxo de login, visão geral, transações, edição, exclusão e compartilhamento no APK.
- Migração `finance_categories_and_transaction_images` aplicada no Supabase.
- API `/api/categories` para listar e criar categorias do usuário.
- API `/api/transaction-attachments` para anexar imagens com checagem de acesso.
- Campo de nova categoria no formulário web.
- Seletor de imagem no formulário web.
- Seletor de imagem e nova categoria no editor do APK.
- Ajustes de cores, navegação e cartões do APK para aproximar o dashboard web.
- Compartilhamento externo implementado no Android com `Intent.ACTION_SEND`.
- Compartilhamento externo implementado no web com Web Share API e fallback para copiar o texto.
- PR de integração aberto: https://github.com/niccolasreis-lab/assfinadoni/pull/2.

## Em validação

- Build do APK no GitHub Actions para o PR atual.
- PR #3 validado com workflow Android concluído com sucesso (run 10).
- Teste manual de upload de imagem nos dois clientes.
- Teste de categoria personalizada em contas diferentes.
- Teste de anexo em lançamento compartilhado e tentativa de acesso sem permissão.

## Pendências técnicas

- Exibir galeria/miniatura dos anexos no detalhe do lançamento.
- Disponibilizar uma ação separada para compartilhamento entre contas, caso ela continue necessária.
- Migrar data URLs para Supabase Storage quando o volume crescer.
- Adicionar idempotência para evitar duplicidade em reprocessamento do Telegram.
- Confirmar no workflow n8n a transcrição de áudio e OCR de imagens em produção.
- Adicionar testes automatizados de API para categorias e anexos.

## Próximo ciclo recomendado

1. Validar o PR e gerar APK de distribuição.
2. Testar uma despesa com categoria nova e imagem no web e Android.
3. Testar áudio, foto e exclusão natural no Telegram.
4. Implementar galeria de anexos e compressão no cliente.
5. Adicionar OCR com revisão antes de salvar.

