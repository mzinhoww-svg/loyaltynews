# @loyaltynews/ui — Design System (Frente 05)

Tokens do brandkit 2.0-draft.1 (status do brandkit: **proposta não aprovada**) + componentes React acessíveis, mobile-first.

## Uso
```tsx
import "@loyaltynews/ui/styles.css";           // uma vez (tokens + estilos)
import { Header, Footer, ArticleCard } from "@loyaltynews/ui";

<div className="ln-root"> ... </div>            // escopo de base/foco
```
- Links: passe `linkAs={NextLink}` (padrão `<a>`). URLs de editoria: `hrefFor` (padrão `/editorias/<slug>`).
- Datas em pt-BR, fuso America/Sao_Paulo. Sem `new Date()` em render (SSR determinístico).
- `isMock` / `MockBadge` / `MockFrame`: selo **MOCK** sempre visível. Não existe dado real nem imagem inventada no pacote.

## Tokens
- `tokens/design.tokens.json` = cópia literal do brandkit. `tokens/extensions.json` = valores **derivados** por esta frente (espaçamento, raio, escala tipográfica, breakpoints, cores semânticas), marcados como proposta.
- `npm run tokens` gera `src/tokens/tokens.css` (CSS vars `--ln-*`) e `tokens.ts`. `npm run assets -- <pasta assets do brandkit>` regenera `logo-data.ts` a partir dos SVG oficiais.

## Achado de acessibilidade no brandkit
`secondary #34877A` tem 4,29:1 sobre branco (abaixo de AA 4,5:1 para texto normal) e o branco sobre ele idem. Uso restrito a gráficos/texto grande; para texto e botões usa-se `secondary-strong #2A6F65` (derivado). Coberto por `test/contrast.test.ts`.

## Componentes
Logo/Monogram (4+2 variações oficiais), Header (skip link, 10 editorias, menu mobile com Esc), Footer, Container, Grid, VisuallyHidden, ArticleCard (`lg|md|sm|compact`, título é o único link), Tag, EditoriaBadge, Button, Input, SearchInput, Pagination (links reais), Breadcrumb, SectionHeading, EmptyState (`empty|error|unavailable`), AdSlot (rotulado "Publicidade", placeholder honesto), MockBadge, MockFrame.

## Comandos
`npm test` (vitest + vitest-axe + contraste WCAG) · `npm run typecheck` · `npm run showcase` (vitrine em http://127.0.0.1:5175; `?axe` roda axe-core no navegador e expõe `window.__axe`) · `npm run showcase:build`.
