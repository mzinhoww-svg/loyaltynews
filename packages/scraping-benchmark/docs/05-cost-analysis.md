# 05 — Custos

## Gasto real do benchmark: US$ 0

Tudo dentro da cota gratuita (DP-33: só corte ao fim da cota). Consumo do benchmark no mês, do livro `checkpoints/ledger.json`:

| Produto (conta) | Créditos usados | Unidade | Cota da conta | % da cota |
|---|---:|---|---:|---:|
| scrapfly-basic (1) | 250 | crédito Scrapfly (real, cabeçalho) | 1.000 | 25 % |
| zyte-http (1) | 254 | US$ 0,0001 (estimado) | 50.000 (US$ 5) | 0,5 % |
| exa-contents + exa-search (1) | 127 + 48 | US$ 0,001 (costDollars) | 10.000 (US$ 10) | 1,8 % |
| tavily-extract (2) | 23,6 | crédito Tavily | 1.000 | 2,4 % |
| brightdata-unlocker (2) | 116 | requisição | 5.000 | 2,3 % |
| firecrawl-scrape (1) | 100 | crédito Firecrawl (1 por scrape) | 1.000/mês (plan_credits em /v1/team/credit-usage, lido pelo PM em 23/11; período 23/11–23/12) | 10 % |
| apify-rag-web-browser (1) | 468 | US$ 0,001 (estimado) | 5.000 (US$ 5) | 9,4 % |

Observação: o Scrapfly custou em média 1,7 crédito por leitura, não 1 (páginas grandes); o teto foi corrigido de 150 para 600 e os pares cortados foram refeitos.

## Custo por artigo válido e projeção mensal (preço de lista; US$)

| Provedor | US$/válido | 1.000 | 10.000 | 50.000 | 100.000 |
|---|---:|---:|---:|---:|---:|
| direct | 0 | 0 | 0 | 0 | 0 |
| zyte-http | 0,00021 | 0,21 | 2,11 | 10,55 | 21,10 |
| scrapfly-basic | 0,00027 | 0,27 | 2,73 | 13,65 | 27,30 |
| exa-contents | 0,00111 | 1,11 | 11,11 | 55,55 | 111,10 |
| brightdata-unlocker | 0,00157 | 1,57 | 15,67 | 78,35 | 156,70 |
| tavily-extract | 0,00186 | 1,86 | 18,60 | 93,00 | 186,00 |
| apify-rag-web-browser | 0,00414 | 4,14 | 41,38 | 206,90 | 413,80 |
| firecrawl-scrape (Hobby mensal US$ 19/5.000) | 0,00396 | 3,96 | 39,58 | 197,90 | 395,80 |
| **roteador adaptativo (shadow)** | **0,000074** | **0,07** | **0,74** | **3,72** | **7,45** |

Roteador: custo médio por artigo válido medido no replay (06), porque ~88 % das URLs são lidas pelo caminho direto (grátis) e só o resto vai a provedor pago.

## Até onde a cota gratuita alcança (estimativa)

Com o roteador, ~12 % das leituras vão a provedor pago. Só na cota gratuita mensal atual (1 conta cada): Zyte ≈ 25.000 leituras no 1º mês (crédito de US$ 5 não recorrente — **a verificar**), Scrapfly ≈ 580, Bright Data 5.000, Exa ≈ 9.000, Tavily ≈ 5.000 extrações, Firecrawl 1.000 scrapes/mês. 10.000 artigos/mês ⇒ ~1.200 leituras pagas: cabem na cota gratuita somando Bright Data + Exa + Tavily. Acima de ~50.000/mês, o volume pago passa da cota gratuita e exige decisão do proprietário (qualquer plano pago).

Preços de lista e cotas: `packages/intelligence/leitores-externos.md` (pesquisa do Data, 23/11). Não verifiquei de novo os preços de lista. Firecrawl: corrigido pelo parecer do QA 3 — tabela oficial (firecrawl.dev/pricing): Hobby US$ 19/mês por 5.000 créditos (US$ 16 no anual); a versão anterior usava US$ 16/3.000, suposição minha errada. Os custos dos registros já gravados são recalculados na análise pelo preço vigente.
