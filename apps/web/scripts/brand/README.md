# Assets de marca do portal

`node apps/web/scripts/brand/gerar-assets.mjs [--folha <pasta>]` (na raiz do repositório) gera, de forma determinística (sem IA de imagem, sem rede), todos os assets de marca a partir das fontes oficiais do brandkit que já estão no repositório: logo e monograma (`packages/ui/src/components/logo-data.ts`), ilustrações de contexto (`packages/growth/src/creative/assets.data.ts`) e a fonte Inter (`@fontsource/inter`, OFL).

| Saída | Arquivos | Tamanho |
|---|---|---|
| Logo e monograma | `public/brand/logo-sobre-claro.svg`, `logo-sobre-escuro.svg`, `logo-monocromatico.svg`, `monograma-escuro.svg`, `monograma-claro.svg` | SVG |
| Placeholder de imagem de matéria (16:9, com a marca, sem texto) | `public/brand/placeholder-materia.svg`, `placeholder-materia-escuro.svg` | SVG |
| Ícones das 10 editorias (24×24, traço de 2 px, `currentColor`) | `public/icones/editorias/<slug>.svg` | SVG |
| Imagem de compartilhamento padrão | `public/og/padrao.png` (1200×630), `public/og/padrao-quadrada.png` (1080×1080) | ≤ 60 KB |
| Imagem de compartilhamento por editoria | `public/og/editoria-<slug>.png` (1200×630) | ≤ 60 KB |
| Favicon e ícones de app | `app/favicon.ico` (16, 32 e 48), `app/icon.svg`, `app/apple-icon.png` (180), `public/brand/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | PNG |
| Manifesto do site | `public/site.webmanifest` | JSON |

O brandkit segue marcado como "proposta não aprovada": quando o proprietário aprová-lo ou trocar a arte, basta atualizar as fontes e rodar o gerador de novo. `apps/web/lib/brand-assets.test.ts` guarda dimensões, pesos e a lista de arquivos.
