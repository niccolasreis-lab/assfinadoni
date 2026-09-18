---
name: Assistente de Finanças — Nicolas & Ionara
description: Clareza financeira em uma interface grafite e violeta.
colors:
  primary: "#7C3AED"
  primary-deep: "#6D28D9"
  positive: "#22C55E"
  negative: "#F43F5E"
  gold: "#F4B000"
  background: "#080B12"
  surface: "#121722"
  surface-raised: "#171D29"
  text: "#F8FAFC"
  muted: "#94A3B8"
  border: "#283142"
typography:
  headline:
    fontFamily: Inter
    fontSize: "36px"
    fontWeight: 650
    lineHeight: "1.2"
    letterSpacing: "-0.035em"
  title:
    fontFamily: Inter
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "1.4"
  body:
    fontFamily: Inter
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "1.6"
rounded:
  control: "10px"
  compact: "16px"
  panel: "20px"
  dialog: "24px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
  page: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary-deep}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.panel}"
    padding: "24px"
---

# Design System: Assistente de Finanças — Nicolas & Ionara

## Overview

**Creative North Star: "Clareza para seus planos"**

Uma interface financeira sóbria, com valores legíveis e controles próximos da tarefa. O violeta organiza a hierarquia; a identidade original permanece no logotipo e no dourado dos nomes.

**Key Characteristics:**
- Superfícies grafite e bordas discretas.
- Violeta concentrado nas ações e no saldo mensal.
- Gráficos com legendas e valores textuais equivalentes.

## Colors

A base escura usa texto claro e cinza azulado. Verde e rosa identificam entradas e saídas, sempre acompanhados de sinais ou rótulos. Tons claros de verde e rosa são usados no texto para preservar contraste. O dourado permanece como detalhe da marca.

**The Meaning Rule.** Cor acompanha informação textual; nunca substitui o significado de uma operação.

## Typography

Inter variável hospedada localmente, com fallback de sistema. Títulos têm peso semibold e espaçamento compacto. Valores usam numerais tabulares. Os cards pequenos reduzem a fonte no celular; valores excepcionais permitem rolagem horizontal em vez de quebrar dígitos.

## Layout

Sidebar fixa a partir de 901 px; navegação inferior até 900 px. Cards, filtros e tabelas reorganizam-se em 600 px. A composição do login fica em duas colunas e passa abaixo do formulário em celulares. Área de conteúdo limitada a 1600 px; respiro lateral de 16 a 40 px.

**The Task Rule.** A visão geral mostra cinco lançamentos e acesso à lista completa. Filtros e ações detalhadas pertencem à listagem.

## Elevation & Depth

Painéis usam bordas e camadas tonais. Sombras ficam restritas aos diálogos e à composição abstrata de login. Fundo do modal permanece opaco; backdrop escurece o restante da página.

## Shapes

Controles compactos, painéis arredondados e avatar circular. O logotipo é exibido sem alterações no arquivo original.

## Components

- Botões primary, secondary, ghost e destructive com foco visível e toque mínimo de 44 px.
- Inputs e selects com labels permanentes; datas usam controles nativos do navegador.
- Diálogos nativos para lançamento, compartilhamento e confirmação, com cancelamento por Escape.
- Badges distinguem propriedade e compartilhamento.
- Ícones SVG locais com traço de 1.7 px; transações usam setas de entrada/saída.
- Skeletons sinalizam consulta; falhas não viram zeros. Animações de entrada e interação duram 180–220 ms. `prefers-reduced-motion` desativa movimento.

## Do's and Don'ts

- Use dados reais e estados explícitos de indisponibilidade.
- Preserve labels, foco visível e equivalentes textuais dos gráficos.
- Não reutilize assets ou identidade Frentix.
- Não adicione metas ou notificações fictícias.
- Não use páginas parciais para calcular totais mensais.


## Perfil, movimento e lembretes

O avatar abre um menu ancorado com nome, foto e acesso à edição sincronizada. O editor prioriza prévia, recorte simples e nome; a assinatura informa que as alterações acompanham a conta. A marca preserva o arquivo original e usa enquadramento CSS com texto legível separado.

Entradas de seção e diálogos duram 220 ms; saídas, 150 ms. Uma borda violeta em gradiente aparece no hover/foco dos módulos sem deslocar layout. Áreas informativas não recebem cursor de ação. Movimento reduzido mantém estados e foco sem deslocamentos.

O sino dá acesso a contas a pagar e pendências. A central diferencia consulta indisponível, lista vazia, concluído e cancelado. Formulários mostram a preferência de canal, antecedência e horário em São Paulo. Os avisos externos são discretos; somente a interface autenticada revela detalhes. Contas futuras não integram os totais antes da confirmação.
