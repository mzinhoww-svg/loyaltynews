# 04 — Resultados do benchmark (rodada real `run-20261123-01`, 23/11/2026)

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

Tabelas completas e reproduzíveis: `data/runs/run-20261123-01/report.md` e `report.json` (gerados por `scripts/analyze.ts` a partir de `attempts.jsonl`). **Nenhum resultado abaixo é simulado** (mock: 0). Firecrawl: rodada própria nas mesmas 100 URLs depois que a chave chegou (delta, sem repetir os outros provedores).

- Amostra: dataset v1.2, 100 URLs × 8 caminhos = **800 pares medidos, todos com resultado** (1.112 registros brutos: 800 medições + 130 bloqueios por teto do Scrapfly sem chamada, depois refeitos + 182 de URLs trocadas na v1.1/v1.2, fora da análise). Revisão pós-parecer QA 3 (M2) aplicada abaixo.
- Rastreamento: 100 % das tentativas com correlationId, provedor, duração, erro e custo.

## Por provedor

| Provedor | Técnico | Editorial | Título¹ | Data² | p50 / p95 ms | US$/artigo válido³ |
|---|---:|---:|---:|---:|---|---:|
| firecrawl-scrape | 100 % | **96 %** | 99,0 % | 100 % (60) | 5.668⁴ / 9.425 | 0,00396 (1 crédito real/scrape × Hobby mensal US$ 19/5.000; anual US$ 16/5.000 = 0,00333) |
| zyte-http | 100 % | 95 % | 98,0 % | 100 % (79) | 1.249 / 7.578 | 0,00021 (estimado) |
| scrapfly-basic | 99 % | 94 % | 98,0 % | 100 % (78) | 2.377 / 6.010 | 0,00027 (custo real do cabeçalho) |
| exa-contents | 100 % | 90 % | 95,0 % | — | **238** / 940 | 0,00111 (costDollars real) |
| brightdata-unlocker | 94 % | 90 % | 98,9 % | 100 % (76) | 2.360 / 17.375 | 0,00157 |
| direct | 93 % | 88 % | 97,8 % | 100 % (72) | 400 / 3.461 | **0** |
| apify-rag-web-browser | 90 % | 87 % | 100 % | — | 7.957 / 17.820 | 0,00414 |
| tavily-extract | 93 % | 80 % | 89,2 % | — | 934 / 9.797 | 0,00186 |

¹ Sobre as extrações com texto, contra o título do feed/busca (≥ 0,5). ² Só onde há data na página (Exa, Apify e Tavily devolvem texto sem metadados: "—"). ³ Preço de lista (leitores-externos.md; Firecrawl: firecrawl.dev/pricing, conferido pelo QA 3); hoje tudo saiu da cota gratuita: **gasto real US$ 0** (evidência: ledger + DP-33; os campos de custo efetivo do JSONL são nulos). ⁴ Inclui a espera do espaçamento de 6,5 s entre chamadas.

**Fonte**: só verificável quando o provedor devolve a URL final (direct, Zyte, Exa, Tavily, Apify, Firecrawl: 100 % dos verificáveis). Scrapfly e Bright Data não devolvem URL final: fonte **não verificável** (antes contada como correta — corrigido).

## Ranking ponderado (V3: qualidade 35, sucesso 25, custo 20, latência 15, frescor 5)

1. direct 0,887 · 2. zyte-http 0,851 · 3. exa-contents 0,797 · 4. scrapfly-basic 0,788 · 5. brightdata-unlocker 0,647 · 6. firecrawl-scrape 0,641 · 7. tavily-extract 0,636 · 8. apify 0,605. Firecrawl: maior taxa automática, mas 2º mais caro por artigo válido (abaixo só do Apify) e lento. Todos com n = 100. Elegibilidade legal: todos elegíveis sob a DP-32 (nenhuma leitura com login/paywall).

## Por recência e categoria (editorial)

| | direct | zyte | scrapfly | exa | brightdata | tavily | apify |
|---|---:|---:|---:|---:|---:|---:|---:|
| recente (60) | 91,7 | 98,3 | 98,3 | 88,3 | 95,0 | 85,0 | 86,7 |
| histórico (20) | 90 | 100 | 100 | 100 | 95 | 100 | 100 |
| **problema (20)** | 75 | 80 | 75 | **85** | 70 | 45 | 75 |

Categoria "restritivo" (15): melhor Exa 80 %; Tavily 40 %. "Tecnologia": Zyte, Scrapfly, Bright Data e Tavily 100 %; Exa 73 %, Apify 67 %.

## Pipeline combinado

**100/100 URLs elegíveis passaram no critério automático** em pelo menos um caminho (meta ≥ 90 %); sucesso técnico combinado 100 % (meta ≥ 95 %). **Título** (medida não circular: extrator mais barato com texto, sem filtro de título): 98/100. **Data**: cobertura 79/100, correta 79/79. **Deduplicação**: medida só como repetição de hash por provedor; a meta ≥ 99 % exige pares rotulados — **pendente**. **Precisão rotulada de título, fonte e presença de texto editorial: pendente** (amostra de 40 pares em `data/runs/run-20261123-01/label-sample.csv`, para rotulagem independente). As metas de precisão da V3 **não estão comprovadas** até essa rotulagem. Caso mais difícil: `latamairlines.com` — só Exa e Firecrawl leram (3/3); todos os demais 0/3. Firecrawl nas 20 'problema': 85 % (empata com a Exa); restritivo 80 %.

## Limitações (não esconder)

- Título/data de referência vêm do feed ou da busca, não de revisão humana; a revisão independente da qualidade fica com o QA 3.
- Uma rodada só, num dia; latência inclui a carga da máquina compartilhada.
- Zyte e Apify: custo por resposta não informado; Zyte estimado em 2 créditos/leitura (Apify medido 4 = ~US$ 0,004 pelo usageTotalUsd do Data).
- n = 1–5 por domínio: a matriz por domínio é indicativa, não conclusiva.
- Firecrawl: 4 reprovações — u207, u213, u218 (Star Alliance, 229–252 caracteres: ficha com link externo) e u098 (The Points Guy, 18.514 caracteres, título divergente 0,222: **título divergente, não conteúdo curto**; a classe `title_mismatch` foi criada e os registros antigos são reclassificados na análise).
- Achado do QA 3: corpo de 945 caracteres só com navegação e título idêntico passa no critério automático; u207/u213/u218 começam com navegação em direct/Zyte. O critério automático superestima a qualidade; só a rotulagem resolve.
- Atalho de título pelo corpo (score 0,8, usado em u035/u041) **removido** do critério para rodadas futuras; os registros desta rodada mantêm o valor gravado (o texto não é guardado, não dá para recalcular).
- Domínios: 34, com 1 a 8 URLs cada — indicativo, não conclusivo.
- Scrapfly `asp` e Zyte `browser` não foram rodados (o modo básico já leu quase tudo).
