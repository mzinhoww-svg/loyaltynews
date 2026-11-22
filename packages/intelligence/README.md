# @ln/intelligence (Frente 08) — Entity Intelligence

Modelo relacional temporal em PostgreSQL (ADR-009, **proposta**, não aceita), sem pgvector e sem extensão de grafo.
Estado: implementado em fast-track; **não homologado** (QA) nem operacional (DevOps). Dados de teste: só MOCK.

## Mapa
| Parte | Onde |
|---|---|
| Migrações SQL (schema `intelligence`) | `migrations/001_intelligence.sql` (modelo), `002_suppression_tombstone.sql` (bloqueio de reingestão), `003_graph_indexes.sql` |
| Escrita/leitura básicas (evidência, empresa, pessoa, cargo, relação, organograma) | `src/repo.ts`, `src/queries.ts` |
| Loyalty Moves (`processObservation`) | `src/moves.ts` |
| Watchlists e alertas | `src/watchlists.ts` |
| Grafo em SQL, ≤ 3 saltos, temporal | `src/graph.ts` (`neighbors`, `shortestPath`, `currentPeopleAt`, `sharedHistory`) |
| Pedido do titular (acesso, retificação, supressão) | `src/subject-requests.ts` |
| **Handlers de API** (funções puras para o Backend montar em `apps/web/app/api`) | `src/api.ts` — rotas sugeridas no cabeçalho do arquivo |
| **Dados das telas** — Portal (público) e Studio | `src/views.ts` (`portal*`, `studio*`) |
| **Contrato de ingestão** Editorial → Intelligence | `src/ingest.ts` + `INGESTION_CONTRACT.md` (`role-observation/1`) |
| Benchmark de 100 mil arestas | `bench/perf.perf.ts` → `bench/results/latest.json` |
| Fixtures MOCK | `fixtures/mock-entities.ts` |

## Regras codificadas (e testadas)
1. Todo cargo, relação, aresta de organograma, pessoa e organização tem `evidence_id` e `observed_at` NOT NULL; cargos/relações/arestas também `validated_at`. Evidência só de fonte pública, trecho ≤ 500 caracteres.
2. Vínculo `inferred` exige `inference_basis`. Fica fora de consultas por padrão; no Studio, quando pedido, vem rotulado ("inferido — não confirmado"); em caminhos do grafo, `all_declared=false`. O portal **nunca** recebe inferido.
3. **Flags desligadas por padrão** (`DEFAULT_CONFIG`): `personIngestion` (espelha `intelligencePessoas` de `@ln/contracts`; use `configFromFlags()`) e `extendedPersonalData` (trava também por gatilho no banco). Sem `personIngestion`, nenhuma pessoa é criada: `resolveOrCreatePerson`, `processObservation` e `ingestBatch` recusam.
4. Pessoa = nome (+ URL pública de perfil opcional) + cargos/empresa (DP-11 P4). Qualquer outro campo é recusado.
5. Primeira observação de uma pessoa é linha de base, não Move. Move nasce `detected`; alerta nasce `pending_review`; o portal só mostra Move `confirmed`.
6. Homônimos não são fundidos só pelo nome; só por URL de perfil ou nome + mesma empresa.
7. **Supressão (WF19)**: a pessoa some de exportação, consultas, grafo, organograma, Moves, alertas, watchlists, portal e Studio. A reingestão é bloqueada por **tombstones de hash** (sha256, sem nome em claro) de: URL de perfil; nome+empresa de cada cargo (qualquer fonte); nome+domínio de cada fonte (qualquer empresa). Limite conhecido: um homônimo sem URL, em outra empresa e outra fonte não é distinguível e entra como pessoa nova.

## Uso
`npm test` na raiz (Vitest + PGlite = PostgreSQL real em memória), `npm run typecheck`, `npm run lint`; benchmark: `npm run perf -w @ln/intelligence`.
Em produção, passe um cliente com `query(sql, params) -> {rows}` (interface `Db`) e aplique `migrationFiles()` com o executor de migrações do `@ln/db`.

## Desempenho (ADR-009: p95 ≤ 300 ms com 100 mil arestas) — NÃO VERIFICADO na Vertra
`bench/results/latest.json`: 114.990 arestas sintéticas, 3 saltos, PGlite (WASM, em memória) nesta máquina: p95 ≈ 425 ms (neighbors de organização), 385 ms (de pessoa), 355 ms (caminho) — **acima** do critério proposto. Antes dos índices: p95 ≈ 444 ms (`bench/results/v1-sem-indices.json`). **Isto não vale como medição do PostgreSQL da Vertra** (WASM, single-thread, sem disco/rede); o critério só se confirma em R5-05 no PostgreSQL 18, com `EXPLAIN (ANALYZE, BUFFERS)`. Se estourar lá, caminhos: materializar vizinhança por entidade, limitar grau por salto, ou migrar para grafo (critérios de 03 §7).

## Não verificado / pendências
- PostgreSQL 18 da Vertra; volume e latência reais; concorrência.
- Integração com `@ln/db` (Drizzle): as migrações do Intelligence ainda são SQL próprio; o Chief Architect decide se entram em `packages/db`.
- Contratos compartilhados: `@ln/contracts/intelligence` (Company/Person/Role/Move, em português) ainda não é produzido pelos handlers, que devolvem formas em inglês com evidência e `validated_at`. Proposta ao Chief Architect: um adaptador no Backend, ou alinhar os schemas (incluir `validated_at`, `certainty`, `status` do Move).
- Base legal LGPD/controlador (J-01/R1-01): as duas chaves de dado pessoal permanecem desligadas.
- Sem coleta real: nenhuma fonte, nenhum crawler.
