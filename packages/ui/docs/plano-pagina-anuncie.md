# Plano: página "Anuncie / Mídia kit" do Loyalty News

Frente 05 (UI/UX). Referência pedida: [fidcnews.com.br/midia-kit](https://fidcnews.com.br/midia-kit). Este é um plano, não está implementado. Nada aqui é aceite de governança.

## 1. O que a referência faz bem (estrutura, não texto)

Uma página única, longa, navegável por âncoras, que vende por **prova + especificação + caminho claro até a proposta**:

| # | Bloco da referência | Função |
|---|---|---|
| 0 | Barra fixa de âncoras + botão "Reservar posição" | Orientação e conversão em qualquer ponto |
| 0 | Abertura com frase forte e 2 números ao vivo | Credibilidade imediata |
| 1 | Cobertura: texto + editorias com contagem | "O que vocês publicam" |
| 2 | Audiência por canal, cada número com fonte e período | Prova |
| 3 | Decisores: 4 perfis | Para quem se fala |
| 4 | Tese: comparativo "mídia de dispersão × mídia de decisão" | Argumento comercial |
| 5 | Formatos: ficha por posição + mapa visual do portal + matéria publicitária | Especificação |
| 6 | Catálogo em abas por categoria, preços e **pacotes/combos** com botão que leva ao formulário | Escolha |
| 7 | Como funciona: 4 passos | Reduz atrito |
| 8 | Reserve sua posição: contatos + formulário (pacote, formato, mensagem, opt-in) | Conversão |
| – | Faixa de consentimento de cookies e rodapé completo | Confiança |

## 2. O que NÃO copiar (guard-rails do Loyalty News)

1. **Nenhum número sem origem e período.** A referência mostra visitas, alcance e engajamento. No LN a audiência só aparece com coleta real (`MetricStore`, regra do fast-track); hoje o estado correto é "Em atualização". Usar `KpiCard` (origem e período obrigatórios).
2. **Não somar canais.** A referência soma portal + LinkedIn + Instagram em um "alcance mensal". O módulo comercial já diz que contatos por canal não são deduplicados nem somados. Mostrar canal a canal.
3. **Sem afirmação não comprovada.** "Decisores", "custo por decisor (CPD)" e "vagas escassas por design" exigem evidência ou política real. O módulo comercial já marca o bloco Decisores como indisponível sem evidência.
4. **Preço é referência, não oferta** (D12), e o formato só aparece como à venda se estiver `disponivel` (CP-12; flag `adServerVendas` desligada). A página mostra "valor de referência" + estado do formato; o único caminho é "Solicitar proposta" (sem checkout; `planosPagos` desligada).
5. **LGPD no formulário.** Lead é dado pessoal: finalidade clara, consentimento registrado com data, opt-in da newsletter separado e **desmarcado**, nada enviado por e-mail a pessoas sem aprovação. Atrás de `portalFormularios` (desligada).
6. **Conteúdo patrocinado sempre rotulado** (F-074).
7. **Identidade própria.** Reusar a estrutura de informação, não o texto, o visual nem os números do FIDC News.

⚠ Achado a confirmar: os 8 valores de referência de banners do nosso catálogo (topo 3.000, sidebar 1.750, rodapé 1.250, dentro do artigo 2.000, entre seções 2.250, patrocínio de dados 2.500, agenda 1.000, takeover 5.000) e as cotas (4/10/6) são **idênticos** aos que o FIDC News publica. Confirme que é decisão comercial própria do LN antes de publicar.

## 3. O que já existe

- `@ln/commercial` → `generateMediaKit()`: 8 blocos (cobertura, audiência, decisores, tese, especificações, catálogo com 47 formatos e 8 pacotes, contratação em 10 passos, formulário com opt-in separado) e `METRIC_SLOTS` com fonte e período.
- `@ln/contracts`: `AD_FORMATS` (47, 9 seções), `SlotPosition`, `Lead`, flags.
- Design system: `KpiCard`, `Tabs`, `StatusPill`, `AdSlot` (tamanhos 1280×150 / 336×280 / 1280×200), `Form/FormField`, `DataTable`, `EmptyState`, `MockBadge`, `Footer` (agora com frase e redes).
- **Não existe** a página pública (só a API `api/midia` e o módulo). O wireframe v1.0 tela 14 já tem a mesma espinha (01 Cobertura … 05 Formatos e mapa).

## 4. Anatomia proposta da página

| Seção | Conteúdo | Dado (fonte) | Componentes | Vazio / flag |
|---|---|---|---|---|
| Âncoras + CTA | Cobertura · Audiência · Formatos · Catálogo · Como funciona · Contato · "Solicitar proposta" | fixo | **AnchorNav** (novo) | – |
| Abertura | Frase do wireframe ("Quem decide o futuro da fidelidade precisa estar bem informado.") + 2 `KpiCard` | CMS e GA4 via `MetricStore` | `SectionHeading`, `KpiCard` | "Em atualização" (honesto) |
| 1 Cobertura | Texto + as 10 editorias, cada uma com nº de matérias em 90 dias | CMS | **EditoriaCoverageList** (novo) | "—" por editoria sem dado |
| 2 Audiência | Um cartão por canal: Portal (GA4), The Loyal (ESP), LinkedIn; nota de metodologia | `METRIC_SLOTS` | `KpiCard` em grade | `EmptyState` "Sem analytics conectado ainda" · The Loyal atrás da flag `theLoyal` |
| 3 Decisores | Perfis-alvo **rotulados como público pretendido**, sem estatística | texto aprovado | cartões simples | Oculto até haver evidência (como no módulo) |
| 4 Tese | Comparativo qualitativo, sem métricas inventadas | texto aprovado | **ComparisonTable** (novo) | – |
| 5 Formatos | Ficha por posição (cotas, peso máx., contrato mínimo, tipos) + **mapa do portal** + matéria publicitária (selo "Conteúdo patrocinado") | `POSITIONS` | **FormatSpecCard**, **PositionMap** (usa `AdSlot`), `Tag` | – |
| 6 Catálogo | Abas por seção (Banners, The Loyal, Conteúdo patrocinado, Redes e canais, Entrevistas, Loyalty Talks, Eventos, Cobertura de eventos, Impulsionamento); cada formato com valor de referência e `StatusPill`; 8 pacotes com botão que pré-seleciona o formulário | `AD_FORMATS`/`CATALOG`/`PACKAGES` | `Tabs`, `StatusPill`, **FormatCard**, **PackageCard** (novos) | Texto fixo "valores de referência, não oferta" |
| 7 Como funciona | Os 10 passos do módulo agrupados em 4 etapas (Conversa, Proposta, Veiculação, Relatório) | `contratacao.steps` | **Stepper** (novo) | – |
| 8 Contato | Contatos reais + formulário (nome, empresa, e-mail, WhatsApp, formatos, objetivo, mensagem, opt-in) | `Lead` | `Form`, `FormField`, **Checkbox** (novo), **LeadForm** (novo) | Atrás de `portalFormularios`; sem contato validado mostra aviso, não inventa e-mail |
| Rodapé | Logo, frase, redes, editorias, links institucionais | config | `Footer` ✓ | – |
| Consentimento | Faixa só se houver coleta (analytics) | política J-15 | **ConsentBanner** (novo) | Atrás de `analytics` |

## 5. Componentes novos (design system)

| Componente | Observação de UX/a11y | Porte |
|---|---|---|
| AnchorNav | Sticky; destaca a seção ativa (IntersectionObserver) com `aria-current`; no mobile vira menu recolhível; respeita `prefers-reduced-motion` | M |
| EditoriaCoverageList | Lista (não tabela) com número alinhado; "—" quando vazio | P |
| ComparisonTable | `<table>` real com cabeçalhos; sem cores como único sinal | P |
| FormatSpecCard | `<dl>` de especificações; selo de disponibilidade com texto e ícone | P |
| PositionMap | Esquema do portal com as posições nos tamanhos reais; texto alternativo descrevendo a ordem; no mobile empilha | M |
| FormatCard / PackageCard | Valor rotulado "referência"; CTA "Solicitar proposta" leva ao formulário com o item pré-selecionado | M |
| Stepper | Lista ordenada; passo atual opcional | P |
| Checkbox (+ Radio/Switch) | Rótulo clicável, foco visível, alvo 44px (já é lacuna P1 no doc de fidelidade) | P |
| LeadForm | `Form` com resumo de erros; consentimento obrigatório; opt-in separado e desmarcado; honeypot/limite de taxa no servidor | M |
| ConsentBanner | Foco gerenciado, botões de mesmo peso ("Só necessários" / "Aceitar"), sem bloquear leitura | M |

Responsivo: sem carrossel de catálogo (a referência usa setas); abas com rolagem horizontal e, em telas estreitas, lista em acordeão. Sem conteúdo só no hover.

## 6. Fases

| Fase | Entrega | Dono principal | Depende de |
|---|---|---|---|
| F1 | Página estática honesta: AnchorNav, Formatos + PositionMap, Catálogo e Pacotes (do contrato), Como funciona; Cobertura/Audiência/Decisores em estado vazio; formulário substituído por aviso | UI (componentes) + Frontend (rota `/anuncie`) | `generateMediaKit` via API ou chamada direta no servidor |
| F2 | Formulário real: `LeadForm`, `Checkbox`, endpoint de lead gravando no CRM com consentimento datado | Backend + Commercial; revisão de Security & Governance | flag `portalFormularios`, parecer LGPD |
| F3 | Métricas ao vivo: coleta GA4/LinkedIn/ESP → `MetricStore`; `ConsentBanner` | Integration + Data + Commercial | flags `analytics`, política de privacidade publicada |
| F4 | Proposta em PDF a partir de `generateMediaKit`, SEO/Open Graph da página, testes de conversão | Commercial + Growth + UI | F2 |

Critérios de aceite sugeridos para cada fase: axe sem violações em 375/768/1280 px (`npm run showcase` e e2e), nenhum número renderizado sem origem e período (`verify:no-mock`), flags desligadas por padrão, teste de teclado do formulário, e2e com porta própria (`E2E_PORT`), Lighthouse ≥ 90 em staging (limiar do gate).

## 7. Decisões que precisam do proprietário

1. Mostrar **valores de referência publicamente** (como a referência) ou só "sob proposta"? Hoje o contrato os guarda como referência.
2. Confirmar que os valores e cotas atuais são decisão própria (ver ⚠ na seção 2).
3. URLs reais dos perfis (LinkedIn, Instagram, X, Google Notícias, YouTube) e e-mail público de contato. O wireframe marca o domínio como "a validar"; o rodapé só mostra ícones com URL informada.
4. Exibir o ícone do Instagram com a flag `instagram` desligada? (é só um link para o perfil, mas a regra do fast-track trata Instagram como "construído e desligado").
5. Frase do rodapé em inglês ("The global network for board-level loyalty leaders.") com portal em português: manter assim?
6. Mensagens de escassez ("vagas limitadas") só se houver política real de cotas (o contrato tem 4/10/6 cotas por posição).
7. Menu "Notícias ▾" com dropdown (wireframe v1.0) × lista plana atual.

## 8. Limites desta análise

Li a página de referência pelo texto e estrutura; não medi o desempenho nem a acessibilidade dela. Não consegui ver as pranchas em PDF do LN. Nenhuma métrica do FIDC News foi usada ou verificada.
