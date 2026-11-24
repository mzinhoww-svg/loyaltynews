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

## 2ª rodada (medição real da BFS em lote, 23/11/2026, `bench/results/pg-staging-bfs.json`): ainda reprovou, e a causa é a IDA E VOLTA
No mesmo servidor e na mesma hora (PostgreSQL 18.6, rodando da máquina do PM, fora da rede da Vertra):

| Consulta | recursiva p95 | BFS em lote p95 | p50 da BFS |
|---|---|---|---|
| `neighbors` organização | 1224,7 ms | **464,6 ms** | 444,8 ms |
| `neighbors` pessoa | 714,4 ms | **453,6 ms** | 415,8 ms |
| `shortestPath` | 424,4 ms | **463,0 ms** | 438,0 ms |

Leitura: os p50 das três séries são quase iguais (~415–445 ms) e os planos do EXPLAIN tocam só ~850 buffers: **o custo dominante é fixo por ida ao banco**, não a consulta. A BFS em lote faz até 3 idas; a recursiva do `shortestPath`, uma só, e mesmo assim tem p50 de 392 ms. A latência de rede entre a máquina do PM e o banco da Vertra entra em cada ida (ADR-009 mede com o aplicativo perto do banco). O EXPLAIN antigo cortava o texto antes das linhas "Planning/Execution Time"; agora o relatório traz o tempo de **servidor** de cada consulta (`server_side`) e a **ida e volta de `SELECT 1`** (`network.select1_roundtrip`) para separar rede de consulta.

### O que mudou na 2ª rodada
1. **Uma ida ao banco por consulta** (`neighbors`/`shortestPath` em `src/graph.ts`): os 3 saltos viram 3 CTEs encadeadas numa única consulta, cada nível buscando suas arestas com `= ANY(ARRAY(SELECT b_id FROM <nível anterior>))`, o que mantém a **sondagem por índice**. **Aprendizado medido em PGlite:** a 1ª versão da consulta única juntava a fronteira com a visão inteira e ficou ~6× mais lenta no servidor (p50 225 ms contra 35 ms); com `ANY(ARRAY(...))` voltou ao nível da BFS em lote. O `shortestPath` ganhou saída antecipada dentro da própria consulta (níveis 2/3 só rodam se o destino não apareceu).
2. A BFS em lote ficou como variante de referência (`neighborsBatched`, `shortestPathBatched`); equivalência das **três** implementações no mesmo teste (`graph-equivalence.test.ts`, 2 variantes × recursiva).
3. `bench-pg` mede e separa: **ida e volta (SELECT 1)**, **idas ao banco por consulta** (`db_roundtrips_median`), **tempo de servidor** (EXPLAIN) e uma **ESTIMATIVA de p95 com o aplicativo na mesma rede** (`estimate_colocated_p95_ms` = p95 − idas × p50 do SELECT 1; é estimativa, não medição). Com `--with-reference` compara BFS em lote e recursiva; com `--with-indexes` mede de novo depois de criar os índices cobrindo propostos **só dentro do schema de teste**.

### Resultado em PGlite desta rodada (sem rede; só compara o trabalho de servidor; p95 em ms)
| Consulta | recursiva | BFS em lote (3 idas) | consulta única (1 ida) |
|---|---|---|---|
| `neighbors` organização | 451 | 48 | 110 |
| `neighbors` pessoa | 376 | 30 | 51 |
| `shortestPath` | 398 | 41 | 30 |

A consulta única custa um pouco mais de servidor (~10–60 ms) e economiza **2 idas** ao banco: com a ida e volta que a medição real sugere (~130 ms por ida, dedução dos p50, **a confirmar pelo `SELECT 1`**), a previsão é ~190–250 ms de p50 e abaixo de 300 ms de p95 de fora da rede da Vertra, e bem menos com o aplicativo colado no banco. **É previsão, não medição.**

### Índices compostos (migração 0030): DESCARTADA na 3ª rodada (pioraram a consulta de organização; ver abaixo). Texto original da proposta:
`proposals/0030_intelligence_graph_indexes.sql`: quatro índices cobrindo (`org_relation` por origem e por destino; `role_assignment` por pessoa e por organização, todos com `INCLUDE (id, extremo, valid_from, valid_to, certainty)`), para a sonda virar varredura só de índice. **Só entram na migração se a medição real mostrar ganho**: `--with-indexes` mede antes e depois no mesmo servidor, sem migração. Se o gargalo for a rede, índice não ajuda.

## 3ª rodada (medição real da consulta única, a2c4255, 23/11/2026, `bench/results/pg-staging-single.json`): critério cumprido por ESTIMATIVA na mesma rede, não por medição
PostgreSQL 18.6 (staging), 114.990 arestas sintéticas, rodando da máquina do PM (fora da rede da Vertra). **Ida e volta de `SELECT 1`: p50 124,8 ms** (p95 127,2). Schema descartável apagado (`schema_dropped: true`). p95 em ms (e p50), com a **estimativa de p95 com o aplicativo na mesma rede** = p95 − idas × 124,8 (**ESTIMATIVA, não medição**):

| Consulta | consulta única (produto) | estimativa mesma rede | BFS em lote (3 idas) | est. mesma rede | recursiva | est. mesma rede |
|---|---|---|---|---|---|---|
| `neighbors` organização | **412,8** (p50 293,6) | **288** | 459,4 | 85 | 1088,8 | 964 |
| `neighbors` pessoa | **276,5** (p50 158,8) | **151,7** | 443,2 | 68,8 | 678,4 | 553,6 |
| `shortestPath` | **173,3** (p50 159,7) | **48,5** | 439,7 | 65,3 | 423,0 | 298,2 |

**Veredito (do PM, registrado aqui):** de **fora** da rede, o pior p95 é 412,8 ms (`meets_criterion: false`). **Na mesma rede** (o caso real: web e banco ficam na Vertra), as três séries ficam abaixo de 300 ms **por estimativa**, com a consulta de **organização no limite (288 ms, sem margem)**. **Isto é estimativa, não medição na mesma rede**; o critério ADR-009 só estará medido quando se medir de dentro do web do staging (próximo passo abaixo).

### O que esta rodada também mostrou (para decidir com dados)
1. **A consulta única custa mais trabalho de servidor/transferência nas fronteiras grandes** do que a BFS em lote. Tirando a ida e volta, a estimativa na mesma rede da BFS em lote (85 / 69 / 65 ms) é **melhor** que a da consulta única nas vizinhanças (288 / 152 ms); só no `shortestPath` a única empata ou ganha (48,5 contra 65,3). O tempo de EXPLAIN da amostra (planejamento ~11 ms + execução ~6 ms) é de **uma** chamada de fronteira pequena e **não representa o p95**: o p95 vem das organizações com ~1400 entidades alcançadas. Moral: a consulta única só vence quando a ida e volta é grande (de fora da rede); **com o aplicativo colado no banco a BFS em lote pode ser a melhor** para `neighbors`. A escolha entre as duas deve sair da medição de dentro da rede, não da de fora.
2. **A estimativa é conservadora para a consulta única** em um ponto: o p95 de fora inclui o tempo de **transferir** até ~1400 linhas com caminhos pela rede de longa distância (não só a ida e volta), que some na mesma rede; por outro lado, a estimativa da BFS em lote multiplica por 3 o erro de qualquer desvio da ida e volta mediana. Por isso a faixa real é incerta e **só a medição de dentro da rede confirma**.
3. **Índices cobrindo da 0030 PIORARAM** a consulta de organização (p95 **603,8 ms** contra 412,8 sem índices; estimativa 479 contra 288; execução do plano amostrado 39,5 ms contra 5,8 ms: o planejador escolheu um plano pior com os índices); pessoa e `shortestPath` melhoraram pouco (241,8 e 166,5). **Decisão do PM: não aplicar a 0030.** `proposals/0030_intelligence_graph_indexes.sql` fica marcado como **DESCARTADO**. Não criar índice sem nova medição que mostre ganho no pior caso.

### Próximo passo (se valer o esforço) e gatilho
- **Medir de dentro da rede da Vertra:** uma **rota de diagnóstico só no staging** (atrás de `APP_ENV=staging`, autenticada, desligada por padrão, nunca em produção) no web, que roda as três implementações (`neighbors`/`neighborsBatched`/`neighborsRecursive` e as de menor caminho) sobre os dados SINTÉTICOS de um schema descartável, ou o `bench-pg` como job de uma só execução dentro da rede do staging (DevOps). Critério: p95 ≤ 300 ms **medido** na mesma rede. Com esse número, escolher `neighbors` única ou em lote (a troca é só apontar o produto para outra função; as três são equivalentes e testadas).
- **Gatilho da adjacência materializada** (tabela com uma linha por aresta direcionada, vigência e certeza, chave por nó): qualquer um destes: (a) p95 medido **na mesma rede** acima de 250 ms na consulta de organização (hoje a estimativa é 288); (b) **≥ 500 mil arestas** reais; (c) algum nó com **grau acima de ~2 mil** (a fronteira cresce linearmente); (d) o EXPLAIN do pior caso mostrar a visão `graph_edge` dominando. Exige migração, gatilho/rotina de manutenção e decisão de consistência (dono: `@ln/db`).
- O dado real hoje é pequeno (29 organizações, 40 pessoas): nada disto bloqueia 24/11. A a2c4255 **pode seguir para integração** (decisão do PM): a consulta única é equivalente (QA 3) e cumpre o critério por estimativa; manter a BFS em lote no código como alternativa medida.

## Como medir no PostgreSQL real (o PM roda; o agente de dados não recebe a credencial)
```
# 0) compilar (sem credenciais)
cd C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence
npx esbuild packages/intelligence/scripts/bench-pg.ts --bundle --platform=node --format=esm --packages=external --outfile=node_modules/.cache/ln-intelligence/bench-pg.mjs

# 1) medição completa COM o comparativo da versão recursiva antiga no mesmo servidor (minutos)
node ln-com-credenciais.mjs staging -- node C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/node_modules/.cache/ln-intelligence/bench-pg.mjs --migration C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/db/drizzle/0006_intelligence.sql --with-reference --with-indexes --out C:/Users/mazin/OpenBot/Shared/loyalty-news/code/wt-intelligence/packages/intelligence/bench/results/pg-staging-single.json
```
Como ler (2ª rodada): `network.select1_roundtrip.p50_ms` = custo de cada ida; `results.*` = consulta única (1 ida) com `db_roundtrips_median` e `estimate_colocated_p95_ms`; `reference_batched` e `reference_recursive` = as variantes anteriores no mesmo servidor; `with_indexes.*` = o produto depois dos índices cobrindo; `server_side` = tempo de planejamento+execução no servidor. `schema_dropped: true`. Se `meets_criterion` vier `false`, o `explain` traz o plano da maior fronteira de cada série (próximo passo: os índices acima, depois a adjacência materializada).
