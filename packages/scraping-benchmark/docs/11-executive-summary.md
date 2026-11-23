# 11 — Resumo executivo

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
>   - adaptativo 99/100 a US$ 0,000199 por válido, p95 de 10,1 s contra 10,4 s do atual;
>   - 14 URLs divergem.
>
> **Rotulagem independente (QA 3, 40 pares, `r0-preparacao/qa/ft-scraping-benchmark-m2-label-sample.csv`):**
> - título correto 29/40;
> - fonte confirmável 29/40, sem nenhum "não" (11 indeterminados);
> - texto editorial comprovado pelo trecho 4/40 (10 "não", 26 indeterminados);
> - 4 aprovados no v1 tinham título errado (u041 Exa; u058, u069, u077 Tavily).
>
> **Conclusão honesta:** as metas de precisão da V3 (título e fonte ≥ 95 %; deduplicação ≥ 99 %) **não estão comprovadas**. O trecho de 200 caracteres não basta para provar a presença do texto, e a deduplicação entre URLs distintas exige pares rotulados com o deduplicador. Para fechar, falta rodar o shadow ao vivo em staging guardando um trecho maior para rotulagem, ainda sem texto integral.

**Estado**: benchmark real executado (23/11/2026), 100 URLs × 8 caminhos (Firecrawl em rodada delta), **gasto real US$ 0** (cota gratuita). M1 homologado pelo QA 3; M2 (este) aguarda parecer. Nada em produção; flags desligadas.

## Resultado

- **Pipeline combinado: 100/100 URLs elegíveis pelo critério automático** (meta ≥ 90 %); sucesso técnico 100 % (meta ≥ 95 %); título 98/100 (automático); data 79/79 (cobertura 79 %); rastreamento 100 %. As metas de **precisão** só valem depois da rotulagem independente.
- **Firecrawl** (rodada delta): maior taxa automática (96 %) e lê LATAM, mas o 2º mais caro (~US$ 4 por mil válidos, preço oficial Hobby) e lento; fallback de qualidade.
- **Parecer QA 3 (M2): não homologado.** Corrigido: 404 no replay, disjuntor por domínio, título não circular (98/100), fonte só onde verificável, custos e denominadores, preço Firecrawl. **Pendente**: precisão rotulada (amostra de 40 pares pronta) e deduplicação rotulada; shadow ao vivo em staging.
- **Melhor extrator pago custo-benefício: Zyte** (95 % editorial, ~US$ 0,21 por mil artigos válidos, custo estimado). Scrapfly logo atrás (94 %, custo real). Leitura direta grátis resolve 88 %.
- **Fontes difíceis** (20 sem feed ou bloqueadas): Exa 85 %, Firecrawl 85 %, Zyte 80 %, Bright Data 70 %, Tavily 45 %. LATAM só foi lida por Exa e Firecrawl.
- **Caminho atual (direct → Tavily)** perde 4 de 100; o roteador adaptativo recupera os 4 e custa ~US$ 0,07 por mil artigos (shadow por replay).

## Recomendação de produção

1. Adotar o `AdaptiveRouter` com ordem global **direct → Zyte → Scrapfly → Exa → Bright Data → Firecrawl → Tavily → Apify**, refinada por domínio.
2. Rebaixar o Tavily de leitor único para fallback tardio; manter Apify só como último recurso (lento e caro).
3. Ligar primeiro em staging, em shadow (09), por 2 semanas; depois fallback real nas fontes `via-provedor`; produção só com o proprietário (10).
4. Até ~10.000 artigos/mês cabe na cota gratuita atual; acima disso, decisão de plano pago é do proprietário.

## Riscos remanescentes

- Referência de qualidade vem do feed, não de revisão humana (QA 3 deve amostrar).
- Uma rodada só; n por domínio pequeno; Scrapfly `asp` e Zyte `browser` não testados.
- Ledger em arquivo local e só com o consumo do benchmark; em produção precisa ir para banco compartilhado.
- Custo de Zyte e Apify estimado (as APIs não informam por resposta).

Detalhes: 04 (resultados), 05 (custos), 06 (roteamento), 07 (conformidade), 09 (shadow), 10 (rollout).
