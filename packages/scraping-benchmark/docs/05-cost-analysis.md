# 05 — Custos

> **Critério v2 (vigente, após a reavaliação do QA 3 de 23/11).** Título recalculado a partir do título gravado, sem atalho pelo corpo, e veredito refeito com a mesma regra para todos os registros (`rejudgeRecord`). É uma estimativa, porque o corpo não é guardado e o título gravado pode estar truncado. As tabelas abaixo desta caixa, quando não marcadas, mostram o **v1 histórico** (`report-v1-historico.*`, `shadow-v1-historico.json`). Os números v2 estão em `report.md` e `shadow.json`.
>
> | Provedor | Editorial v2 | (v1 histórico) | US$/válido v2 |
> |---|---:|---:|---:|
> | firecrawl-scrape | 95 % | 96 % | 0,00400 |
> | zyte-http | 94 % | 95 % | 0,00021 |
> | scrapfly-basic | 93 % | 94 % | 0,00028 |
> | brightdata-unlocker | 89 % | 90 % | 0,00158 |
> | exa-contents | 88 % | 90 % | 0,00114 |
> | direct | 87 % | 88 % | 0 |
> | apify-rag-web-browser | 86 % | 87 % | 0,00419 |
> | tavily-extract | **17 %** | 80 % | 0,00875 |
>
> - **Tavily:** a API não devolve título e a 1ª linha do texto costuma ser um pixel ou um e-mail (u058, u077). A rotulagem confirmou 0 de 5 títulos corretos. O valor v1 estava inflado pelo atalho do corpo.
> - **Ranking v2:** direct, Zyte, Exa, Scrapfly, Bright Data, Firecrawl, Apify, Tavily.
> - **Combinado v2:** 99/100 pelo critério automático; título 97/100 no extrator mais barato com texto; data correta 78/78, com cobertura de 78/99.
> - **Replay v2:**
>   - caminho atual 89/100;
>   - cascata fixa 99/100 a US$ 0,000235 por válido;
>   - adaptativo 99/100 a US$ 0,000206 por válido, 119 tentativas, p95 de 7,6 s contra 10,4 s do atual (após as faixas do roteador, f43922c);
>   - 14 URLs divergem.
>
> **Rotulagem independente (QA 3, 40 pares, `r0-preparacao/qa/ft-scraping-benchmark-m2-label-sample.csv`):**
> - título correto 29/40;
> - fonte confirmável 29/40, sem nenhum "não" (11 indeterminados);
> - texto editorial comprovado pelo trecho 4/40 (10 "não", 26 indeterminados);
> - 4 aprovados no v1 tinham título errado (u041 Exa; u058, u069, u077 Tavily).
>
> **Conclusão honesta:** as metas de precisão da V3 (título e fonte ≥ 95 %; deduplicação ≥ 99 %) **não estão comprovadas**. O trecho de 200 caracteres não basta para provar a presença do texto, e a deduplicação entre URLs distintas exige pares rotulados com o deduplicador. Para fechar, falta rodar o shadow ao vivo em staging guardando um trecho maior para rotulagem, ainda sem texto integral.

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
