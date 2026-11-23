# 11 — Resumo executivo

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
