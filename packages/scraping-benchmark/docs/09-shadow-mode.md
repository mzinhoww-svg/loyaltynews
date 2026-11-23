# 09 — Shadow mode

Estado (após parecer QA 3, M2): **replay offline concluído** (06: paradas, disjuntor com relógio simulado, divergência por URL e latência); **comparação ao vivo em staging ainda não executada** — exige staging com a ingestão existente ativa, e isso depende do DevOps e do dono do worker (Backend/Editorial). É o que falta para fechar §§ 14 e 16. Estado anterior: **projetado e com peças testadas; não executado contra o pipeline real** (o pipeline editorial ainda não roda de forma recorrente no ambiente; não há ingestão de produção para comparar).

## Como funciona

1. `SCRAPING_SHADOW_MODE=true` e `SCRAPING_ADAPTIVE_ROUTING_ENABLED=true` (staging apenas).
2. Para cada URL que o coletor atual processa, o `AdaptiveRouter` processa a mesma URL **em paralelo e sem escrever no banco**.
3. Grava-se a comparação: o coletor atual leu? o roteador leu? hash, título e data coincidem? custo e latência de cada um.
4. Nada do caminho shadow é publicado; o feed continua vindo só do coletor atual.
5. Desligamento imediato: flag `false` (sem deploy) ou `SCRAPING_PROVIDER_<NOME>_DISABLED=true` por provedor.

## Ponto de integração proposto (fora da minha pasta: dono decide)

`apps/workers/src/editorial-factory.ts` aceita `reader?: ReaderPort` (coletor). A ponte é `asEditorialReader` do Data, que converte um `ReaderPort` no `ReaderPort` do coletor. Proposta ao Backend/Editorial: injetar um leitor que chame o caminho atual e, em sombra, o roteador, registrando a divergência.

## Critério para sair do shadow

Duas semanas em staging com: sucesso editorial combinado ≥ 90 % nas elegíveis, zero violação de orçamento/autorização, divergência de título < 5 %, nenhum duplicado no portal.
