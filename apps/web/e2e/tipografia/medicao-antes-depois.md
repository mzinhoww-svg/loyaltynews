# Medição antes/depois — tipografia (Inter local)

Protocolo: `auditoria-design/tipografia/aceite-tipografia.md` (UI/UX, 25/11/2026).
Chromium headless (Playwright), processo novo por rodada, CDP 1,6 Mbps / 750 kbps / 150 ms, CPU 4x, 3 rodadas por célula (mediana).
Build de produção local no perfil vitrine do e2e (fixtures MOCK), `next start` em `localhost:3000`, mesma máquina.

- **Antes:** `origin/main` `d355b12`.
- **Depois:** `ft/portal-tipografia` (`cabc643` + commit das setas/tokens).
- Motivo do perfil vitrine: a página de pessoa de M-03 só existe localmente com as fixtures; o build é de produção.

## Medianas (FCP / LCP / CLS)

| Célula | Antes | Depois | CLS ≤ 0,10 | FCP ≤ antes+50 | LCP ≤ antes+100 |
|---|---|---|---|---|---|
| home 390 | 1468 / 1636 / 0,001 | 1648 / 2588 / 0 | ✓ | ✗ (+180) | ✗ (+952) |
| home 768 | 1680 / 1996 / 0 | 1564 / 2312 / 0 | ✓ | ✓ | ✗ (+316) |
| home 1280 | 1544 / 1664 / 0,006 | 1364 / 2124 / 0 | ✓ | ✓ | ✗ (+460) |
| pessoa 390 | 1196 / 1196 / 0,012 | 1152 / 1152 / **0,275** | **✗** | ✓ | ✓ |
| pessoa 768 | 1188 / 1188 / 0,02 | 1348 / 1348 / 0,006 | ✓ | ✗ (+160) | ✗ (+160) |
| pessoa 1280 | 1924 / 1924 / 0,008 | 1392 / 1392 / 0,001 | ✓ | ✓ | ✓ |
| Studio /studio e /studio/creative 1280 | Arial, 0 fonte | Inter, 1 fonte, 0 @font-face url, CLS 0 | ✓ | — | — |
| fonte bloqueada, pessoa 768 | — | CLS **0** | ✓ | — | — |

## O que passou

- 768 no perfil (o portão do staging): CLS **0,006**; com o `.woff2` abortado, **0** — `adjustFontFallback` funciona.
- 1 requisição de fonte de **48.256 B**, preload presente, **1 `@font-face` com url** (a segunda regra é a reserva `local("Arial")` com as métricas, criada pelo próprio `adjustFontFallback`).
- Studio em Inter, sem Arial, 1 fonte; Georgia só em `.pt-body` e `.pt-article-sub`; tokens approved; axe não foi repetido nesta rodada (fica para o e2e do QA).

## O que reprovou, e por quê

1. **pessoa 390: CLS 0,275.** O "antes" local **não reproduziu** o 0,399 do staging (deu 0,02 a 768), como o aceite previu; o teste com a fonte bloqueada decidiu (0). No 390, a preload faz a troca cair dentro da janela de medição e a quebra de linha muda (~0,8% de diferença de largura da reserva), empurrando as seções. Ajustar `size-adjust` para 104,5% zera o 390 neste fixture, mas é um número ajustado à página e frágil; não foi aplicado.
2. **LCP das homes (+316 a +952 ms) e FCP de home 390/pessoa 768.** A troca de fonte agora acontece **dentro** de `load + 1 s` (antes o `.woff2` chegava depois da janela e não contava). O LCP de texto é reemitido no swap, e a fonte pré-carregada disputa banda com a imagem do LCP na home. É o mesmo efeito de fronteira do CLS: o "antes" parece melhor porque não mede a troca.
3. **`@font-face` = 2 regras, não 1.** O `adjustFontFallback: 'Arial'` obrigatório gera a segunda regra (Arial local com métricas). Só uma tem arquivo/rede.

## Conclusão

O defeito do staging (0,399 a 768) é coberto pela mudança e pelo teste da fonte bloqueada. O aceite numérico **não fecha** em pessoa 390 e nas células de LCP/FCP por causa do swap dentro da janela — não por regressão de carregamento. Preciso de decisão do UI/UX/PM: (a) aceitar o efeito de fronteira com o registro acima; (b) `display: optional` (zera CLS, mas deixa Arial na primeira visita lenta, contra a decisão de marca); (c) reserva ajustada (104–104,5%) só para o 390, com o risco de trocar a quebra em outras páginas. Nenhuma opção foi aplicada à revelia.

## Arquivos

- Spec: `apps/web/e2e/tipografia/medir.spec.ts`; config `apps/web/e2e/tipografia.config.ts`.
- JSON bruto: `apps/web/e2e/tipografia/evidencias/{antes,depois}/*.json` (versionado na branch).
- Capturas: `auditoria-design/tipografia/evidencias-cabc643/` (390/768/1280, antes e depois, e Studio).
