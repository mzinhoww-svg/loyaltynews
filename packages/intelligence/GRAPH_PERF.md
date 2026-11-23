# Desempenho do grafo (ADR-009): diagnóstico, otimização e risco de escala

Critério (ADR-009): **p95 ≤ 300 ms com 100 mil arestas** em `neighbors` e `shortestPath` (até 3 saltos). Código: `src/graph.ts`. Equivalência: `src/tests/graph-equivalence.test.ts`. Medição no PostgreSQL real: `BENCH_PG.md` (`scripts/bench-pg.ts`).

## Diagnóstico (medição de 23/11/2026 no ln-staging-db, PostgreSQL 18.6, shared_buffers 128 MB, work_mem 4 MB; `bench/results/pg-staging.json`)
Dataset sintético: 20 mil organizações, 15 mil pessoas, **114.990 arestas**, 48,7 MB. **Reprovou:**

| Consulta | p50 | p95 | máx |
|---|---|---|---|
| `neighbors` de organização (até 1401 entidades alcançadas) | 782 ms | **1055 ms** | 1342 ms |
| `neighbors` de pessoa | 536 ms | **807 ms** | 1060 ms |
| `shortestPath` organização → organização | 383 ms | **415 ms** | 431 ms |

Causa (nos planos EXPLAIN do arquivo): a consulta recursiva **enumerava todos os CAMINHOS** (o número de linhas cresce como grau³; só depois o `DISTINCT ON` reduzia a uma linha por entidade) e, **para cada caminho**, sondava a visão `graph_edge` (3 ramos com junções a `role_assignment`/`person`/`org_chart_edge`, nas duas direções): milhares de sondas de índice por consulta, cada uma com custo de planejamento e junção. Os planos mostram buffers só em memória (`shared hit`): o gargalo é **trabalho de CPU/sondas**, não disco, e não é `work_mem` (a recursão usa ~150 kB).

## O que mudou
- **Busca em largura por salto** (`bfs` em `src/graph.ts`): **uma consulta por salto** (no máximo 3) para a **fronteira inteira**, com `= ANY(ids)` nos dois sentidos (usa os índices por pessoa, organização e relação), e **deduplicação por entidade em memória** (cada entidade entra uma vez, na menor profundidade; empate: caminho declarado preferido, depois menor `edge_id`). Mesma semântica da versão recursiva: arestas vigentes na data; inferidas só com `includeInferred` e sinalizadas em `all_declared = false`; mesmo teto de 3 saltos; `shortestPath` para no primeiro salto em que acha o destino.
- A versão recursiva ficou como **referência** (`neighborsRecursive`, `shortestPathRecursive`): o teste de equivalência compara as duas em um grafo com arestas dos 3 tipos, inferidas e encerradas (mesmas entidades, profundidades e `all_declared`, com e sem inferidas, `maxHops` 1/2/3/99, origem = destino), e o benchmark mede as duas lado a lado.
- **Nenhuma mudança de esquema nem de API**: mesmas assinaturas e mesmo formato de resposta.

## Resultado em PGlite (mesmo dataset de 115 mil arestas, mesma máquina; `bench/results/latest.json`)
| Consulta | recursiva (antes) p95 | BFS (agora) p95 |
|---|---|---|
| `neighbors` de organização | 486 ms | **83,5 ms** |
| `neighbors` de pessoa | 482 ms | **73,1 ms** |
| `shortestPath` org → org | 485 ms | **81,8 ms** |

(≈ 6× mais rápido.) **PGlite não vale como medição do PostgreSQL da Vertra**: o valor útil é o comparativo e a prova de equivalência. A expectativa para o PG real, se o ganho for proporcional (**estimativa, não medição**), é algo em torno de 150–200 ms de p95 no pior caso; só a medição no staging confirma. O comando está no fim deste arquivo.

## Avaliado e NÃO feito (e por quê)
- **Índices compostos com validade e certeza** (ex.: `org_relation (from_org_id, valid_from, valid_to) WHERE certainty='declared'`, idem `to_org_id`, `role_assignment (person_id)/(organization_id)` parciais): **exigem migração** do schema `intelligence` (que é do `@ln/db`, mantido pelo Chief Architect/DevOps) — não é desta frente. Só valem se, depois do BFS, o PG real ainda passar de 300 ms; o `EXPLAIN` do relatório (maior fronteira de cada série) diz se há `Seq Scan` ou `Filter` caro. Proposta pronta, sem aplicar: `CREATE INDEX CONCURRENTLY org_relation_from_valid ON intelligence.org_relation (from_org_id, valid_from) WHERE valid_to IS NULL;` e o equivalente em `to_org_id` / `role_assignment`.
- **Tabela de adjacência materializada**: a maior economia em escala (uma linha por aresta direcionada, já com vigência e certeza, chave por nó), mas exige manter a tabela (gatilhos ou reconstrução), migração e decisão de consistência. **Fica como próximo passo se o volume real passar de ~1 milhão de arestas** (ver risco).
- **Teto de entidades por salto / poda**: **mudaria o resultado** (cortar entidades em silêncio), contra a regra de "sem vínculo presumido, sem omissão calada"; só com sinalização explícita de truncamento e decisão de produto. O BFS já elimina a explosão por caminhos, que era a causa.
- **`work_mem` da sessão**: irrelevante agora (a recursão usava ~150 kB); sem ganho esperado.
- **Poda de caminho sem concatenação de texto** (ideia do PM): a concatenação de `path` deixou de existir no caminho principal (caminhos são montados em memória só para a entidade escolhida).

## Risco de escala (registrado)
- **Hoje o dado real é pequeno (29 organizações, dezenas de relações, 39 pessoas)**: o ADR-009 não bloqueia a produção de 24/11.
- **Nós de grau muito alto** (uma organização com milhares de vínculos) fazem a fronteira do 2º/3º salto crescer: o custo passa a ser linear no número de arestas tocadas (centenas de milhares de linhas devolvidas ao aplicativo no pior caso). Monitorar `entities_reached_max` e o p95 por série; se um nó concentrar grau, usar paginação/limite **sinalizado** (decisão de produto) ou a adjacência materializada.
- A visão `graph_edge` continua sendo UNION de 3 ramos com junções: com ≥ ~1 milhão de arestas a sonda por lote também cresce; é o gatilho para a adjacência materializada.
- A medição no staging (1 GB, instância pequena, `shared_buffers` 128 MB) não representa produção; repetir na infraestrutura de produção antes de cravar o critério.

## Como medir no PostgreSQL real (o PM roda; o agente de dados não recebe a credencial)
```
# 0) compilar (sem credenciais)
cd C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence
npx esbuild packages/intelligence/scripts/bench-pg.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/bench-pg.mjs

# 1) medição completa COM o comparativo da versão recursiva antiga no mesmo servidor (minutos)
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/bench-pg.mjs --migration C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/db/drizzle/0006_intelligence.sql --with-reference --out C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/bench/results/pg-staging-bfs.json
```
Esperado: `results.*.p95_ms` abaixo de 300 (critério) e `reference_recursive.*` reproduzindo ~1055/807/415 ms; `schema_dropped: true`. Se `meets_criterion` vier `false`, o `explain` traz o plano da maior fronteira de cada série (próximo passo: os índices acima, depois a adjacência materializada).
