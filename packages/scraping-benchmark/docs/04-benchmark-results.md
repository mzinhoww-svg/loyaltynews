# 04 — Resultados do benchmark (rodada real `run-20261123-01`, 23/11/2026)

Tabelas completas e reproduzíveis: `data/runs/run-20261123-01/report.md` e `report.json` (gerados por `scripts/analyze.ts` a partir de `attempts.jsonl`). **Nenhum resultado abaixo é simulado** (mock: 0). Firecrawl: rodada própria nas mesmas 100 URLs depois que a chave chegou (delta, sem repetir os outros provedores).

- Amostra: dataset v1.2, 100 URLs × 7 caminhos = **700 pares, todos com resultado** (830 registros no dataset vigente, contando os cortes por teto do Scrapfly refeitos depois; 182 registros de URLs trocadas na v1.1/v1.2 ficam fora da análise).
- Rastreamento: 100 % das tentativas com correlationId, provedor, duração, erro e custo.

## Por provedor

| Provedor | Técnico | Editorial | Título¹ | Data² | p50 / p95 ms | US$/artigo válido³ |
|---|---:|---:|---:|---:|---|---:|
| firecrawl-scrape | 100 % | **96 %** | 99,0 % | 100 % (60) | 5.668 / 9.425 | 0,00556 (1 crédito real/scrape; preço de lista não verificado) |
| zyte-http | 100 % | 95 % | 98,0 % | 100 % (79) | 1.249 / 7.578 | 0,00021 (estimado) |
| scrapfly-basic | 99 % | 94 % | 98,0 % | 100 % (78) | 2.377 / 6.010 | 0,00027 (custo real do cabeçalho) |
| exa-contents | 100 % | 90 % | 95,0 % | — | **238** / 940 | 0,00111 (costDollars real) |
| brightdata-unlocker | 94 % | 90 % | 98,9 % | 100 % (76) | 2.360 / 17.375 | 0,00157 |
| direct | 93 % | 88 % | 97,8 % | 100 % (72) | 400 / 3.461 | **0** |
| apify-rag-web-browser | 90 % | 87 % | 100 % | — | 7.957 / 17.820 | 0,00414 |
| tavily-extract | 93 % | 80 % | 89,2 % | — | 934 / 9.797 | 0,00186 |

¹ Sobre as extrações com texto, contra o título do feed/busca (≥ 0,5). ² Só onde há data na página (Exa, Apify e Tavily devolvem texto sem metadados: "—"). ³ Preço de lista (leitores-externos.md); hoje tudo saiu da cota gratuita: **gasto real US$ 0**.

## Ranking ponderado (V3: qualidade 35, sucesso 25, custo 20, latência 15, frescor 5)

1. direct 0,887 · 2. zyte-http 0,851 · 3. exa-contents 0,797 · 4. scrapfly-basic 0,788 · 5. brightdata-unlocker 0,647 · 6. firecrawl-scrape 0,638 · 7. tavily-extract 0,636 · 8. apify 0,605. Firecrawl: melhor qualidade e sucesso, mas o mais caro por artigo válido e lento (p50 5,7 s). Todos com n = 100. Elegibilidade legal: todos elegíveis sob a DP-32 (nenhuma leitura com login/paywall).

## Por recência e categoria (editorial)

| | direct | zyte | scrapfly | exa | brightdata | tavily | apify |
|---|---:|---:|---:|---:|---:|---:|---:|
| recente (60) | 91,7 | 98,3 | 98,3 | 88,3 | 95,0 | 85,0 | 86,7 |
| histórico (20) | 90 | 100 | 100 | 100 | 95 | 100 | 100 |
| **problema (20)** | 75 | 80 | 75 | **85** | 70 | 45 | 75 |

Categoria "restritivo" (15): melhor Exa 80 %; Tavily 40 %. "Tecnologia": Zyte, Scrapfly, Bright Data e Tavily 100 %; Exa 73 %, Apify 67 %.

## Pipeline combinado

**100/100 URLs elegíveis com extração editorial válida** em pelo menos um caminho (meta ≥ 90 %); sucesso técnico combinado 100 % (meta ≥ 95 %); título correto no extrator mais barato com sucesso 100/100; data correta 79/79 verificáveis. Caso mais difícil: `latamairlines.com` — só Exa e Firecrawl leram (3/3); todos os demais 0/3. Firecrawl nas 20 'problema': 85 % (empata com a Exa); restritivo 80 %.

## Limitações (não esconder)

- Título/data de referência vêm do feed ou da busca, não de revisão humana; a revisão independente da qualidade fica com o QA 3.
- Uma rodada só, num dia; latência inclui a carga da máquina compartilhada.
- Zyte e Apify: custo por resposta não informado; Zyte estimado em 2 créditos/leitura (Apify medido 4 = ~US$ 0,004 pelo usageTotalUsd do Data).
- n = 1–5 por domínio: a matriz por domínio é indicativa, não conclusiva.
- Firecrawl falhou em portal.staralliance.com (0/3) e thepointsguy.com (0/1); 4 falhas, todas 'conteúdo curto'.
- Scrapfly `asp` e Zyte `browser` não foram rodados (o modo básico já leu quase tudo).
