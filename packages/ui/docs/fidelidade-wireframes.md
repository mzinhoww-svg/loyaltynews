# Fidelidade do design system aos wireframes (V21-15)

Frente 05 — LN UI/UX Director. Pacote `@ln/ui`. Autoavaliação: **não é homologação** (isso é do QA/verificador).

## 1. O que foi lido e o que NÃO foi comparado

| Fonte | Como foi lida | Limite |
|---|---|---|
| `Loyalty_News_Wireframes_v2_0.html` (25 telas: 20 do Studio + 4 `/intelligence` + arquitetura) | Texto, títulos e blocos extraídos do HTML | Sem comparação de pixel |
| `Loyalty_News_v1_0_Baseline.zip` → `Loyalty_News_Wireframes.html` (35 telas: 16 portal público + 18 Studio + fluxos) | Aberto no navegador; das 35 telas extraí títulos, botões, nº de tabelas, nº de campos e posições de anúncio; li o texto completo só de Home e Matéria. Nas telas admin vi a navegação lateral, os títulos e a contagem de campos, não o conteúdo de cada campo | Sem comparação de pixel; não alternei o modo Mobile |
| `Wireframes_Completos_v2_0.pdf`, `Wireframes_v2_0.pdf`, `Wireframes_Visual.pdf` | **Não lidos**: o ambiente não tem `pdftoppm` | Pranchas visuais em PDF ficam sem conferência |
| Lista das "15 inconsistências de cobertura" citada em V21-15 | **Não localizada** nos arquivos que li | Não afirmo que foram corrigidas |

Consequência: este documento compara **estrutura e conteúdo** (componente × tela), não aparência. A comparação visual contra as pranchas deve ser feita por revisão humana depois que o brandkit for aprovado (`proposal_not_approved`).

Achado de contexto: o HTML v2.0 **não redesenha o portal público** (só Studio e `/intelligence`). As telas do portal só existem no baseline v1.0, que V21-15 declara "não normativo". O redesenho desktop/mobile do portal (R3-01) continua pendente: o design system cobre os blocos, mas não há wireframe 2.1 aprovado do portal para conferir.

## 2. Divergências de fundamento (wireframe × design system)

| Tema | Wireframe | Design system | Decisão |
|---|---|---|---|
| Cores | ≈40 tons de verde/azul-petróleo soltos no CSS do v1.0 | 6 cores do brandkit + derivadas documentadas | Segue o brandkit |
| Fonte | Arial/Helvetica | Inter (UI) e Georgia (editorial), fallback de sistema | Segue o brandkit; **fontes não são distribuídas** |
| Breakpoint | 800px | 768px e 1024px | Padrão mais comum; ajustar se o design exigir |
| Nome das editorias | "Mercado e negócios", "Bancos e cartões"… | "Mercado & Negócios", "Bancos & Cartões"… | Segue `@ln/contracts` (Blueprint 2.1) |
| Contraste | Não verificado no wireframe | `secondary #34877A` reprova AA para texto (4,29:1); texto usa `secondary-strong #2A6F65` | Achado reportado |
| Dados | Números/rótulos de demonstração em KPI e ticker | Métrica exige origem + período; sem dado = estado vazio | Regra do fast-track |
| Anúncios | Topo 1280×150, sidebar 336×280 (×3), rodapé 1280×200, in-article e entre seções responsivos | `AdSlot position=…` com os mesmos tamanhos (paridade testada com `SlotPosition`) | Fiel |
| Menu "Notícias ▾" | Dropdown com "Todas as notícias, Loyalty Flash, Análises" + 10 editorias | Header com lista plana das 10 editorias + `utilityLinks` | **Divergência**: sem dropdown (decisão de acessibilidade/mobile); confirmar com o Founder |

## 3. Componente × tela

Legenda: ✓ cobre · ◐ cobre em parte · — não se aplica. Telas v1.0 = 01–35; v2.0 = V01–V25.

| Componente | Onde o wireframe o usa | Estado |
|---|---|---|
| `Header` (10 editorias, busca, `utilityLinks`) | v1.0 01–16 (topo) | ◐ (sem dropdown, sem faixa Market Data) |
| `Footer` | v1.0 01–16 | ✓ (grupos por props; conteúdo real vem do portal) |
| `ArticleCard` lg/md/sm/compact+rank | 01 Home (Destaques, Em alta, Últimas), 02, 03, 04 (Leia também), 05, 06, 13 | ✓ |
| `SectionHeading` | 01, 02, 03, 05, 07 | ✓ |
| `Breadcrumb` | 04 Matéria ("Home / Programas…") | ✓ |
| `Pagination` | 02, 03, 06 | ✓ |
| `AdSlot` | 01–08, 10, 13, 14, 17–34 | ✓ |
| `SearchInput` | 06 Busca, topo | ✓ |
| `Button`, `Input`, `Form/FormField` | 04 e 27 (e-mail), 08, 14, 15 (formulários públicos), 19–34 (campos) | ✓ (selects/textarea/date simples; falta checkbox/radio/switch) |
| `EmptyState` | 11 Market Data sem dados, 33 Analytics, V01 "Sem dados" | ✓ |
| `MockBadge` | todas as telas "demonstração" | ✓ |
| `Sidebar` + `StudioLayout` | 17–34 (LN Studio, 18 itens) | ✓ (itens por props) |
| `KpiCard` (origem/período obrigatórios) | 17 Visão geral (12/4/—), 27, 33; V01, V04, V12, V14 | ✓ |
| `DataTable` (busca, filtro, ordenação, paginação) | 18, 20, 21, 24, 26–29, 32, 34; V08, V09, V12, V17, V24 | ✓ |
| `Tabs` | 18 (Todos/Novos/Revisão/Bloqueados/Agendados), 05 (24h/7d/30d) | ◐ (tem painéis; falta variante "filtro" sem painel) |
| `StatusPill` | 18, 26, 28, 34; V01, V08, V17 | ✓ |
| `Modal` / `Drawer` | 19 (evidências e qualidade), V08 (detalhe da ação) | ✓ |
| `Toast` | confirmações "Salvar / enviar (demo)" | ✓ |
| Templates (thumbnail, capa, lower third, vinheta) | 01–04 (imagens), 12 Talks, 13 Entrevistas, vídeo | ✓ (sem ilustração própria; aceitam a do Growth) |

## 4. Tela × cobertura (o que falta para V21-15)

### Portal público (v1.0, 01–16)
| Tela | Cobertura | Falta |
|---|---|---|
| 01 Home | ◐ | `MarketDataBar` (ticker; flag `portalMarketData`), `EventCard` (bloco de data "MÊS/DIA"), `NewsletterBand` (flag `theLoyal` desligada), toggle de período de "Em alta" |
| 02 Últimas | ◐ | `FilterChips` (Todos / Loyalty Flash / Análises / Entrevistas), botão "Carregar mais" (usar `Button`) |
| 03 Editoria | ✓ | — |
| 04 Matéria | ◐ | `ArticleHeader` (byline + data e atualização + tempo de leitura), `ShareBar` ("Copiar link"), `SourcesList` ("Fontes e referências"), `ImageCredit` (foto: autor/licença), `RelatedArticles` |
| 05 Em alta | ◐ | Alternância 24h/7d/30d |
| 06 Busca | ◐ | Filtros/facetas |
| 07 Agenda, 08 Evento | ◐ | `EventCard`, filtros (Todos/Brasil/Online/Internacional); formulário público atrás de `portalFormularios` |
| 09 The Loyal, 10 Edição | ◐ | `NewsletterBand`, layout de edição (flag `theLoyal`) |
| 11 Market Data | ◐ | Tabela de indicadores (estado vazio honesto; sem números inventados; flag `portalMarketData`) |
| 12 Loyalty Talks | ◐ | `EpisodeCard` (flag `portalPodcast`) |
| 13 Entrevistas | ✓ | — |
| 14 Mídia kit | ◐ | Tabelas estáticas de formatos (usar tabela simples, não `DataTable`); audiência = estado vazio |
| 15 Sobre/Contato, 16 Políticas | ◐ | Página de texto longo (`Container width="reading"` existe; falta tipografia de prosa) |

### LN Studio v1.0 (17–35)
| Tela | Cobertura | Falta |
|---|---|---|
| 17 Visão geral, 18 Fila, 20 Fontes, 24 Editorias/SEO, 26 Eventos, 28 Distribuição, 29 Inventário, 32 Catálogo, 34 Auditoria | ✓ | — |
| 19 Editor/revisão | ◐ | Editor de texto rico (fora do escopo do design system), `Checkbox/Radio/Switch` |
| 21 Biblioteca de mídia | ◐ | `FileInput`, grade de mídia |
| 22 Automações | ◐ | `Switch` |
| 23 Gestão da home | ◐ | Reordenação de blocos |
| 25 Agenda editorial | ◐ | `Calendar` (mês/semana) |
| 27 Newsletter, 30 Campanhas, 31 Leads | ◐ | Seletor de data/intervalo; prévia |
| 33 Analytics | ◐ | Gráficos (com origem/período obrigatórios, sem dado fictício) |
| 35 Fluxos e arquitetura | — | Diagramas (documentação, não componente) |

### Wireframes v2.0 (V01–V25)
| Tela | Cobertura | Falta |
|---|---|---|
| V01 Command Center, V04 Diretoria Editorial, V12 FinOps, V14 Intelligence | ✓ | Gráfico de consumo (V12) |
| V02 Organograma, V16 Org Chart Builder | ✗ | `OrgChart`/árvore |
| V03 Perfil de agente | ◐ | Editor de prompt versionado (campo de código) |
| V05 Redações, V08 Decisões, V09 ModelOps, V10 Routing, V11 Evals, V15 Editor de entidade, V17 Moves, V19 Trust, V20 Integrações, V24 Watchlist | ◐ | `Stepper` (V10, V11, V17), `EvidenceList` (V15), `Switch` (V24), ações OAuth (V20) |
| V06 Calendário de reuniões | ◐ | `Calendar` |
| V07 Sala e ata | ✗ | `Stepper`/linha do tempo (Snapshot → Contribuições → Síntese → Validação → Ações) |
| V13 Workflow Monitor | ✗ | Visualização de DAG |
| V18 Relationship Graph | ✗ | Grafo |
| V21 Intelligence (portal), V22 Perfil corporativo, V23 Perfil profissional | ◐ | `LinkCard` (Empresas/Pessoas/Moves/Dados), `ProfileHeader` |
| V25 Arquitetura | — | Diagrama |

## 5. Prioridade sugerida para fechar V21-15

1. **P0 (portal MVP, R3):** `ArticleHeader`, `SourcesList`, `ImageCredit`, `ShareBar`, `RelatedArticles`, `FilterChips`, `EventCard`.
2. **P1 (Studio):** `Checkbox/Radio/Switch`, `Stepper`, `Calendar`, `FileInput`, `EvidenceList`.
3. **P2:** `OrgChart`, DAG, grafo, gráficos (cada um com origem e período; sem dados fictícios), `NewsletterBand` e `MarketDataBar` atrás de flag.
4. **Decisões de produto:** menu "Notícias ▾" com dropdown (mantido plano); breakpoint 800px × 768/1024px; aprovação do brandkit (`proposal_not_approved`).
5. **Fora do design system:** editor de texto rico, diagramas de arquitetura.

## 6. Como validar o que foi feito

- `npm test -w @ln/ui` (ou `npm test` na raiz): testes de componente, axe (jsdom) e contraste WCAG por pares de tokens.
- `npm run showcase -w @ln/ui` e abrir `http://127.0.0.1:5175/?axe`: roda axe-core no navegador real (inclui `color-contrast`); resultado em `window.__axe`.
- Última execução registrada: 0 violações em 1280, 768 e 375px. O axe marca como "incompleto" só glifos decorativos `aria-hidden` (✓ ◐ ▲ ⇅), que ele não consegue medir.
- Não verificado: leitor de tela real, outros navegadores, as fontes Inter/Georgia, as pranchas em PDF.
