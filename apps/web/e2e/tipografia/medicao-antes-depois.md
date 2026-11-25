# Medição antes/depois — tipografia (Inter local, V1 `optional`)

Protocolo: `auditoria-design/tipografia/aceite-tipografia.md` (UI/UX, 25/11/2026).
Chromium headless (Playwright), processo novo por rodada, CDP 1,6 Mbps / 750 kbps / 150 ms, CPU 4x, 5 rodadas por célula a 390 e 3+ nas demais (mediana). Build de produção local no perfil vitrine do e2e (fixtures MOCK), `next start` em `localhost:3000`, mesma máquina.

- **Antes:** `origin/main` `d355b12`.
- **Final (V1):** `ft/portal-tipografia` (`1a78fb5`).
- Escolha do PM em 25/11: **`display: optional`, sem preload**. A primeira tentativa (swap + preload) foi descartada.

## V1 — resultado final

| Célula | Antes (5 rodadas) | V1 `optional`, sem preload | CLS ≤ 0,10 |
|---|---|---|---|
| home 390 | 1124 / 1220 / 0,001 | 1372 / 1492 / **0** | ✓ |
| home 768 | 908 / 1016 / 0 | 1376 / 1588 / **0** | ✓ |
| home 1280 | 884 / 976 / 0,006 | 1204 / 1300 / **0** | ✓ |
| perfil 390 | 860 / 860 / 0,012 | 1264 / 1264 / **0** | ✓ |
| perfil 768 | 784 / 784 / 0,02 | 1272 / 1272 / **0** | ✓ |
| perfil 1280 | 832 / 832 / 0,008 | 1356 / 1356 / **0** | ✓ |

FCP / LCP / CLS em ms; o último número é o CLS.

**Provas da V1 (o gate):**

- **1 requisição de 48.256 B** e **1 `@font-face` com arquivo** (a outra regra é a reserva `local("Arial")` com métricas, criada pelo `adjustFontFallback`). O critério é **1 face com arquivo + a reserva local**, não “1 regra `@font-face`” ao pé da letra.
- **Sem troca depois do primeiro paint:** `optional` não faz swap; com o `.woff2` abortado a 768, CLS **0**. A atribuição com a fonte abortada também deu **0** a 390 (5/5) e 1280 (3/3).
- **Cache quente:** família resolvida no portal e no Studio (`document.fonts.check` verdadeiro), 1 arquivo.
- **Studio:** Inter, sem Arial; Georgia só em `.pt-body` e `.pt-article-sub`; tokens approved.
- **Custo de marca (declarado):** na primeira visita em rede lenta o texto sai em **Arial ajustado e permanece**; com o cache quente a identidade em Inter aparece.

## FCP / LCP

**Não são atribuíveis entre janelas nesta máquina.** O mesmo “antes” deu 784–1124 ms em 5 rodadas e 1196–1924 ms em 3 rodadas, com dispersão de até 70% dentro da célula — acima das margens de +50/+100 ms. Não há regressão nem melhoria atribuível; os dois serão **remedidos no staging depois do deploy, com mais rodadas**, como o PM determinou. Nenhum número de FCP/LCP desta rodada é gate.

## Histórico: tentativa descartada (swap + preload)

A primeira implementação usava `display: swap` com `preload: true`. Ela fechava o 768 (0,006) e a fonte bloqueada, mas, no perfil a 390, a troca caía dentro da janela de `load + 1 s` e dava **CLS 0,275**; e o LCP das homes subia porque a fonte disputava banda com a imagem do LCP. O ajuste de `size-adjust` para 104,5% foi descartado por ser número ajustado à fixture. Foi essa medição que levou o PM à V1.

## Arquivos

- Spec: `apps/web/e2e/tipografia/medir.spec.ts`; config `apps/web/e2e/tipografia.config.ts`.
- JSON bruto: `apps/web/e2e/tipografia/evidencias/{antes5,v1-optional,v2-hibrido,atribuicao}/*.json` (versionado na branch).
- Capturas: `auditoria-design/tipografia/evidencias-cabc643/`.
