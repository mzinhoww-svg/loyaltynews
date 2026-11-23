# 03 — Adaptadores de provedor

Contrato: `KeyedReader` → `createReader` (pool de chaves, cota, guardas) → `ReaderPort` (`packages/intelligence/src/reader-port.ts`, Data, 88c407e). Não reescrevi os adaptadores do Data; acrescentei `direct` e `tavily-extract`.

| Caminho | Classe | Endpoint | Crédito/leitura (pior caso → medido) | Desbloqueio | Custo informado na resposta | Conta |
|---|---|---|---|---|---|---|
| direct | `DirectReader` (este pacote) | GET da página | 0 | não | — | — |
| scrapfly-basic | `ScrapflyReader('basic')` | `api.scrapfly.io/scrape` | 1 → 1 | não | sim (`x-scrapfly-api-cost`) | conta 1 |
| scrapfly-asp | `ScrapflyReader('asp')` | idem + `asp=true` | 30 (teto) | sim | sim | conta 1 |
| zyte-http | `ZyteReader('http')` | `api.zyte.com/v1/extract` | 13 → 2 (estimado) | sim (ban = 520) | não | conta 1 |
| exa-contents | `ExaContentsReader` | `api.exa.ai/contents` | 1 (US$ 0,001) | não (só índice) | sim (`costDollars.total`) | conta 1 |
| tavily-extract | `TavilyExtractReader` (este pacote) | `api.tavily.com/extract` | 1 → 0,2 | não | não (regra: 1 crédito / 5 sucessos) | conta 2 |
| brightdata-unlocker | `BrightDataUnlockerReader('web_unlocker1')` | `api.brightdata.com/request` | 1 → 1 | sim | não (1 req = 1) | conta 2 (conta 1 sem zona) |
| apify-rag-web-browser | `ApifyRagBrowserReader` | Actor `apify~rag-web-browser` (sync) | 5 → 4 | não documentado | só na execução (`usageTotalUsd`) | conta 1 |
| firecrawl | — | — | — | — | — | **sem chave: não executado** |

## Campos por tentativa (Diretiva §9)

`AttemptRecord` (`src/types.ts`): provedor, modo, URL original e final, título, autor, fonte (sourceMatch), data, idioma, tamanho do texto, hash SHA-256, trecho ≤ 200, HTTP status, duração, créditos, custo estimado, custo efetivo (quando informado), erro classificado, estado do cache, correlationId, runId, experimentId, versão do código, `mock`. **O conteúdo não é gravado** (DP-29/DP-32).

## Validação única

`quality.evaluate`: HTTP 200 só conta se o texto tiver ≥ 600 caracteres, o título conferir com o do feed (similaridade ≥ 0,5) e não houver login, paywall ou desafio. Mesmo critério para todos os caminhos.

## Testes

`src/tests/benchmark.test.ts` — 20 testes (contrato do Scrapfly via `createReader` sem vazar segredo; SSRF; roteador; orçamento; runner com checkpoint; métricas). Todas as respostas dos testes são **MOCK** e marcadas. Os testes de contrato dos outros adaptadores estão no pacote do Data (`readers.test.ts`, `exa.test.ts`). Validação real: sondagem `smoke-01` (7/7) e a rodada `run-20261123-01` (ver 04).
