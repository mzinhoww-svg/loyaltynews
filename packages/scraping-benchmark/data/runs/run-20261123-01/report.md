# Resultados — run-20261123-01 — critério v2 (estrito, reaplicado aos campos gravados; estimativa)

Tentativas reais (com chamada) no dataset vigente: 800 — 800 pares URL × provedor (fora do dataset v1.2, de URLs trocadas: 182; bloqueios por teto sem chamada, depois refeitos: 130; mock: 0). Gerado em 2026-11-23T16:33:07.989Z.

## Métricas por provedor

| Provedor | n | Técnico | Editorial | Título | Data (verif.) | p50 ms | p95 ms | p99 ms | 403 | 429 | Timeout | Créditos | US$ equiv. | US$/artigo válido |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| firecrawl-scrape | 100 | 100.0% | 95.0% | 98.0% | 100.0% (59) | 5668 | 9425 | 11506 | 0.0% | 0.0% | 0.0% | 100 | 0.3800 | 0.00400 |
| zyte-http | 100 | 100.0% | 94.0% | 97.0% | 100.0% (78) | 1249 | 7578 | 23842 | 0.0% | 0.0% | 0.0% | 200 | 0.0200 | 0.00021 |
| scrapfly-basic | 100 | 99.0% | 93.0% | 97.0% | 100.0% (77) | 2377 | 6010 | 8958 | 0.0% | 0.0% | 0.0% | 171 | 0.0256 | 0.00028 |
| brightdata-unlocker | 100 | 94.0% | 89.0% | 97.9% | 100.0% (75) | 2360 | 17375 | 42819 | 0.0% | 0.0% | 0.0% | 94 | 0.1410 | 0.00158 |
| exa-contents | 100 | 100.0% | 88.0% | 93.0% | — (0) | 238 | 940 | 2369 | 0.0% | 0.0% | 0.0% | 100 | 0.1000 | 0.00114 |
| direct | 100 | 93.0% | 87.0% | 96.8% | 100.0% (71) | 400 | 3461 | 30566 | 4.0% | 0.0% | 3.0% | 0 | 0.0000 | 0.00000 |
| apify-rag-web-browser | 100 | 90.0% | 86.0% | 98.9% | — (0) | 7957 | 17820 | 33736 | 0.0% | 0.0% | 0.0% | 360 | 0.3600 | 0.00419 |
| tavily-extract | 100 | 93.0% | 17.0% | 19.4% | — (0) | 934 | 9797 | 10182 | 0.0% | 0.0% | 0.0% | 18.6 | 0.1488 | 0.00875 |

## Ranking ponderado (qualidade 35, sucesso 25, custo 20, latência 15, frescor 5)

| # | Provedor | Score | Qualidade | Sucesso | Custo | Latência | Frescor | n |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | direct | 0.885 | 0.96 | 0.93 | 1.00 | 0.59 | 0.55 | 100 |
| 2 | zyte-http | 0.849 | 0.98 | 1.00 | 1.00 | 0.19 | 0.56 | 100 |
| 3 | exa-contents | 0.791 | 0.94 | 1.00 | 0.19 | 1.00 | 0.52 | 100 |
| 4 | scrapfly-basic | 0.786 | 0.97 | 0.99 | 0.77 | 0.10 | 0.56 | 100 |
| 5 | brightdata-unlocker | 0.645 | 0.97 | 0.94 | 0.13 | 0.10 | 0.60 | 100 |
| 6 | firecrawl-scrape | 0.639 | 0.98 | 1.00 | 0.05 | 0.04 | 0.56 | 100 |
| 7 | apify-rag-web-browser | 0.602 | 0.96 | 0.90 | 0.05 | 0.03 | 0.52 | 100 |
| 8 | tavily-extract | 0.450 | 0.39 | 0.93 | 0.02 | 0.25 | 0.76 | 100 |

## Sucesso editorial por categoria

| Categoria | apify-rag-web-browser | brightdata-unlocker | direct | exa-contents | firecrawl-scrape | scrapfly-basic | tavily-extract | zyte-http |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| financeiro | 100.0% (25) | 88.0% (25) | 92.0% (25) | 92.0% (25) | 100.0% (25) | 100.0% (25) | 28.0% (25) | 100.0% (25) |
| fintech | 80.0% (20) | 95.0% (20) | 90.0% (20) | 100.0% (20) | 95.0% (20) | 90.0% (20) | 25.0% (20) | 95.0% (20) |
| aviacao-fidelidade | 100.0% (20) | 100.0% (20) | 95.0% (20) | 100.0% (20) | 100.0% (20) | 100.0% (20) | 0.0% (20) | 100.0% (20) |
| tecnologia | 66.7% (15) | 100.0% (15) | 80.0% (15) | 66.7% (15) | 100.0% (15) | 100.0% (15) | 20.0% (15) | 100.0% (15) |
| restritivo | 73.3% (15) | 60.0% (15) | 73.3% (15) | 80.0% (15) | 80.0% (15) | 73.3% (15) | 13.3% (15) | 73.3% (15) |
| internacional | 80.0% (5) | 80.0% (5) | 80.0% (5) | 60.0% (5) | 80.0% (5) | 80.0% (5) | 0.0% (5) | 80.0% (5) |

## Sucesso editorial por recência

| Recência | apify-rag-web-browser | brightdata-unlocker | direct | exa-contents | firecrawl-scrape | scrapfly-basic | tavily-extract | zyte-http |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| historico | 100.0% (20) | 95.0% (20) | 90.0% (20) | 100.0% (20) | 100.0% (20) | 100.0% (20) | 5.0% (20) | 100.0% (20) |
| recente | 85.0% (60) | 93.3% (60) | 90.0% (60) | 85.0% (60) | 96.7% (60) | 96.7% (60) | 21.7% (60) | 96.7% (60) |
| problema | 75.0% (20) | 70.0% (20) | 75.0% (20) | 85.0% (20) | 85.0% (20) | 75.0% (20) | 15.0% (20) | 80.0% (20) |

## Pipeline combinado (URLs elegíveis = sem paywall)

- Elegíveis: 100; sucesso técnico combinado: 100 (100.0%); editorial válido: 99 (99.0%).
- Título (extrator mais barato com texto, sem filtro de título): 97/100 (97.0%). Medida automática contra o título do feed/busca; precisão rotulada pendente.
- Data: cobertura 78/99 com data comparável; correta 78/78 (100.0%).
- Deduplicação: só repetição de hash por provedor; precisão ≥ 99 % exige pares rotulados (pendente).
- Incluindo paywall: 99/100.

### URLs elegíveis sem extração válida

- u098 thepointsguy.com (internacional): direct:title_mismatch/200, zyte-http:title_mismatch/200, exa-contents:title_mismatch/200, tavily-extract:title_mismatch/200, brightdata-unlocker:title_mismatch/200, apify-rag-web-browser:title_mismatch/200, scrapfly-basic:title_mismatch/200, firecrawl-scrape:title_mismatch/200

## Matriz por domínio (válidos/tentativas)

| Domínio | apify-rag-web-browser | brightdata-unlocker | direct | exa-contents | firecrawl-scrape | scrapfly-basic | tavily-extract | zyte-http |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| aeroin.net | 0/1 | 1/1 | 0/1 | 1/1 | 1/1 | 0/1 | 0/1 | 0/1 |
| airlines.org | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 0/4 | 4/4 |
| bradescori.com.br | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 | 3/3 | 0/3 | 3/3 |
| brasscom.org.br | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 | 0/4 | 4/4 |
| canaltech.com.br | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 |
| edpb.europa.eu | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 |
| exame.com | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 |
| finextra.com | 0/1 | 1/1 | 0/1 | 1/1 | 1/1 | 0/1 | 0/1 | 1/1 |
| finsidersbrasil.com.br | 2/2 | 1/2 | 1/2 | 2/2 | 1/2 | 1/2 | 0/2 | 1/2 |
| gov.br | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 |
| iata.org | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 |
| infomoney.com.br | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 |
| itau.com.br | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 0/1 | 1/1 |
| latamairlines.com | 0/3 | 0/3 | 0/3 | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 |
| livelo.com.br | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 0/1 | 1/1 |
| melhoresdestinos.com.br | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 0/2 | 2/2 |
| mercadoeconsumo.com.br | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 1/5 | 5/5 |
| mobiletime.com.br | 7/7 | 7/7 | 7/7 | 7/7 | 7/7 | 7/7 | 1/7 | 7/7 |
| moneytimes.com.br | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/3 | 3/3 |
| nu.com | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 1/2 | 2/2 |
| olhardigital.com.br | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 |
| onemileatatime.com | 2/2 | 2/2 | 2/2 | 1/2 | 2/2 | 2/2 | 0/2 | 2/2 |
| oneworld.com | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| passageirodeprimeira.com | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 | 0/8 | 8/8 |
| paymentsdive.com | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 1/3 | 3/3 |
| pontospravoar.com | 3/3 | 3/3 | 2/3 | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 |
| portal.staralliance.com | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 | 3/3 | 0/3 | 3/3 |
| pt.oneworld.com | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| pymnts.com | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 | 3/3 |
| seudinheiro.com | 6/6 | 6/6 | 4/6 | 6/6 | 6/6 | 6/6 | 1/6 | 6/6 |
| simpleflying.com | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 0/2 | 2/2 |
| tecnoblog.net | 0/5 | 5/5 | 2/5 | 0/5 | 5/5 | 5/5 | 3/5 | 5/5 |
| thepointsguy.com | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 | 0/1 |
| www12.senado.leg.br | 2/2 | 2/2 | 2/2 | 0/2 | 2/2 | 2/2 | 0/2 | 2/2 |

## Matriz de roteamento recomendada (menor custo esperado por artigo válido)

| Domínio | 1º | 2º | 3º |
|---|---|---|---|
| aeroin.net | apify-rag-web-browser (0.0006) | direct (0.0006) | tavily-extract (0.0006) |
| airlines.org | direct (0.00024) | scrapfly-basic (0.00042) | zyte-http (0.00048) |
| bradescori.com.br | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| brasscom.org.br | direct (0.00024) | scrapfly-basic (0.00042) | zyte-http (0.00048) |
| canaltech.com.br | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| edpb.europa.eu | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| exame.com | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| finextra.com | apify-rag-web-browser (0.0006) | direct (0.0006) | scrapfly-basic (0.0006) |
| finsidersbrasil.com.br | direct (0.0004) | scrapfly-basic (0.0007) | zyte-http (0.0008) |
| gov.br | direct (0.00025) | zyte-http (0.0005) | exa-contents (0.0015) |
| iata.org | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| infomoney.com.br | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| itau.com.br | direct (0.0003) | scrapfly-basic (0.000525) | zyte-http (0.0006) |
| latamairlines.com | exa-contents (0.0015) | firecrawl-scrape (0.005) | apify-rag-web-browser (1003) |
| livelo.com.br | direct (0.0003) | scrapfly-basic (0.000525) | zyte-http (0.0006) |
| melhoresdestinos.com.br | direct (0.000267) | scrapfly-basic (0.000467) | zyte-http (0.000533) |
| mercadoeconsumo.com.br | direct (0.000233) | scrapfly-basic (0.000408) | zyte-http (0.000467) |
| mobiletime.com.br | direct (0.000225) | scrapfly-basic (0.000394) | zyte-http (0.00045) |
| moneytimes.com.br | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| nu.com | direct (0.000267) | scrapfly-basic (0.000467) | zyte-http (0.000533) |
| olhardigital.com.br | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| onemileatatime.com | direct (0.000267) | scrapfly-basic (0.000467) | zyte-http (0.000533) |
| oneworld.com | direct (0.0003) | scrapfly-basic (0.000525) | zyte-http (0.0006) |
| passageirodeprimeira.com | direct (0.000222) | scrapfly-basic (0.000389) | zyte-http (0.000444) |
| paymentsdive.com | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| pontospravoar.com | direct (0.000333) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| portal.staralliance.com | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| pt.oneworld.com | direct (0.0003) | scrapfly-basic (0.000525) | zyte-http (0.0006) |
| pymnts.com | direct (0.00025) | scrapfly-basic (0.000437) | zyte-http (0.0005) |
| seudinheiro.com | direct (0.00032) | scrapfly-basic (0.0004) | zyte-http (0.000457) |
| simpleflying.com | direct (0.000267) | scrapfly-basic (0.000467) | zyte-http (0.000533) |
| tecnoblog.net | scrapfly-basic (0.000408) | direct (0.000467) | zyte-http (0.000467) |
| thepointsguy.com | direct (0.0006) | scrapfly-basic (0.00105) | zyte-http (0.0012) |
| www12.senado.leg.br | direct (0.000267) | scrapfly-basic (0.000467) | zyte-http (0.000533) |

## Projeção mensal (US$ equivalentes, preço de lista; hoje só cota gratuita)

| Provedor | 1.000 | 10.000 | 50.000 | 100.000 |
|---|---:|---:|---:|---:|
| direct | 0 | 0 | 0 | 0 |
| scrapfly-basic | 0.28 | 2.76 | 13.8 | 27.6 |
| zyte-http | 0.21 | 2.13 | 10.65 | 21.3 |
| exa-contents | 1.14 | 11.36 | 56.8 | 113.6 |
| tavily-extract | 8.75 | 87.53 | 437.65 | 875.3 |
| brightdata-unlocker | 1.58 | 15.84 | 79.2 | 158.4 |
| apify-rag-web-browser | 4.19 | 41.86 | 209.3 | 418.6 |
| firecrawl-scrape | 4 | 40 | 200 | 400 |
