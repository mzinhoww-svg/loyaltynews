# Templates sociais (cards de matéria e de análise) e rasterização SVG → PNG

Dono do desenho: UI/UX Director. Dono do pacote e do envio ao mLabs: Integration (Frente 09). **Nada aqui publica, agenda ou chama o mLabs.**

## O que existe

| Card | Quando | Aparência | Selo |
|---|---|---|---|
| **Matéria** (`kind: 'materia'`) | qualquer matéria da Fábrica | fundo primário `#153C3C`, ilustração de contexto da editoria (à direita no 1200×627, no alto no 1080×1080), editoria, manchete, apoio opcional, logo branco | nunca leva o selo de autoral |
| **Análise** (`kind: 'analise'`) | só conteúdo autoral (DP-29: tipo `analise`, formato `analise`, `explicador` ou `comparativo`) | fundo menta `#DDEFE8`, selo **CONTEÚDO AUTORAL** + formato, editoria, manchete maior, assinatura "Redação Loyalty News", logo azul | selo sempre |

Formatos: `linkedin_landscape` = 1200×627 e `square` = 1080×1080 (vêm de `design.tokens.json`: `open_graph` e `square`; área segura 72 px no quadrado, 64 px no paisagem).

Regras que o código impõe (recusa com `CreativeRefusal`, nunca "dá um jeito"):
- `sem_autoral`: card de análise sem conteúdo autoral. `autoral_sem_selo`: conteúdo autoral no card de matéria. `autoral_patrocinado`: patrocinado nunca leva o selo.
- `manchete_longa`: a manchete não cabe em 4 linhas com corpo ≥ 30 px (paisagem) ou 40 px (quadrado). **A manchete nunca é encurtada com reticências.** O apoio (até 2 linhas) é cortado com reticências ou omitido se atrapalhar a manchete.
- `glifo_ausente`: caractere que a Inter embutida não tem (emoji, CJK). Cobre o português do Brasil, travessão, aspas curvas, ponto médio, reticências, €, R$.
- `sem_manchete`.
- Patrocínio: o rótulo (`article.sponsored.label`) aparece no card e no texto alternativo. MOCK: faixa vermelha "MOCK — NÃO PUBLICAR" e rótulo "MOCK · EXEMPLO" na ilustração.
- Ilustração: sempre a **ilustração conceitual** do brandkit (travel, retail ou payments, por editoria), com o rótulo "ILUSTRAÇÃO CONCEITUAL". Foto de fonte (`source_image`) **não é suportada** por estes cards (exigiria baixar imagem, o que quebra o determinismo e depende de direito de uso decidido pela Fábrica).

## Como é gerado (determinístico, sem IA de imagem)

```ts
import { renderSocialCard } from './creative/social-cards';   // SVG + HTML de prévia (isomórfico: Node e navegador)
import { rasterizeCreative } from './creative/raster';         // PNG (só Node; NÃO está no índice do pacote)

const card = renderSocialCard(article, { format: 'linkedin_landscape' }); // CreativeAsset
const png = await rasterizeCreative(card);                                // RasterAsset
```

- O **texto vira curvas** com a Inter (OFL-1.1) embutida em `social-assets.data.ts`; o SVG não tem `<text>`, então SVG e PNG não dependem de fonte instalada, e a quebra de linha usa a medida real da fonte. Mesma entrada = mesmo SVG, byte a byte.
- `rasterizeCreative` é pura (sem rede, sem relógio, sem fonte do sistema), usa `sharp` (versão exata no `package.json`) e **recusa** SVG com `<text>`, `<script>`, `foreignObject` ou recurso externo, dimensão divergente ou sem texto alternativo.
- Saída: PNG RGB 8 bits **opaco** (sem canal alfa), no tamanho exato do SVG, 50–120 KB.

### Contrato do uploader (`RasterAsset`, combinado com a Integration)

`{ png, sha256, svgSha256, sizeBytes, width, height, filename, mimeType: 'image/png', altText, brandStatus, mock }`

- **Chave de idempotência = `svgSha256`** (hash do SVG de origem), não o `sha256` do PNG: o PNG pode ter bytes diferentes entre Windows e Linux (zlib/libvips) com pixels idênticos. O `sha256` vale como integridade do envio na mesma plataforma. Os testes comparam o hash dos **pixels** decodificados (`rasterPixelSha256`).
- `filename`: ASCII `[a-z0-9-]` + `.png`, ≤ 200 (`ln-<kind>-<slug do título>-<L>x<A>-<8 primeiros do svgSha256>.png`).
- `altText`: o `<desc>` do SVG (descreve o card; não repete o post).
- `brandStatus` e `mock` propagam do `CreativeAsset`. O brandkit está `proposal_not_approved`: o status acompanha todo card.
- mLabs: `prepare_media_upload` (filename, `image/png`, `sizeBytes` exato, `sha256` opcional, `channels: ['linkedin']`) e PUT na `uploadUrl`; depois `get_media_upload` até `completed`. Implementação é da Integration, sobre este `RasterAsset`.

## Dependências (versões exatas)

- `opentype.js` 1.3.4 (+ `@types/opentype.js` 1.3.10): leitura da fonte e curvas.
- `sharp` 0.35.5: SVG → PNG (nativo). **No Linux (Vertra), rode `npm ci` no próprio build do Linux; nunca copie `node_modules` do Windows.** O Next já usa o `sharp` para imagens quando instalado.
- `@fontsource/inter` 5.3.0 (devDependency): só alimenta `npm run fonts -w @ln/growth` (copia os WOFF latinos 400/600/700 para `assets/fonts/` e regenera `social-assets.data.ts`). Licença da fonte: `assets/fonts/OFL-1.1-Inter.txt` (SIL OFL 1.1).

## Limites conhecidos (honestos)

- **Kerning parcial.** O `opentype.js` 1.3.4 aplica só o kerning de dígitos e pontuação da Inter; o kerning de letras fica em tabela de extensão (GPOS lookup 9) que a biblioteca não lê, e a 2.0.0 falha com a Inter. Visualmente aceitável em manchetes em caixa mista; um leitor próprio de GPOS é melhoria futura.
- PNG: bytes idênticos só na mesma plataforma/versão do `sharp`; pixels idênticos entre plataformas **não foram verificados em Linux** (só rodei no Windows). A chave de idempotência (`svgSha256`) independe disso.
- O criativo antigo `renderPost` (com `<text>`) não pode ser rasterizado; o pipeline do LinkedIn deve passar a usar `renderSocialCard`.
- Sem foto de fonte, sem carrossel/PDF e sem Instagram nestes templates.
- Amostras: `npx tsx packages/growth/scripts/render-social-samples.ts` gera 16 cards em `packages/growth/out/social-samples/` (pasta não versionada; dados fictícios).
