# @loyaltynews/intelligence (Frente 08) — Entity Intelligence

Modelo relacional temporal em PostgreSQL (ADR-009, **proposta**, não aceita). Sem pgvector, sem extensão de grafo.
Implementado em fast-track; **não homologado** (QA) nem operacional (DevOps).

## O que há
- `migrations/001_intelligence.sql`: schema `intelligence` — evidência, organizações, pessoas, cargos com vigência, relações corporativas, organograma (linha de reporte), Moves, watchlists, alertas, pedidos de titular, views `graph_edge` e `org_chart_view`.
- `src/repo.ts`: escrita/leitura (evidência, organização, pessoa, cargo, relação, organograma).
- `src/moves.ts`: Loyalty Moves — `processObservation` (baseline, unchanged, appointment, departure, title_change, org_change).
- `src/watchlists.ts`: watchlists, alertas `pending_review`, revisão com revisor registrado.
- `src/graph.ts`: consultas de grafo em SQL (CTE recursiva, ≤ 3 saltos, temporal por data): `neighbors`, `shortestPath`, `currentPeopleAt`, `sharedHistory`.
- `src/subject-requests.ts`: acesso, retificação e supressão a pedido do titular (WF19).
- `fixtures/mock-entities.ts`: dados **MOCK** (fictícios, domínio `.invalid`).

## Regras codificadas (e testadas)
1. Todo cargo, relação, aresta de organograma, pessoa e organização tem `evidence_id` e `observed_at` NOT NULL; cargos/relações/arestas também `validated_at`.
2. Evidência só de fonte pública (`source_class='public'`), trecho ≤ 500 caracteres.
3. Vínculo `inferred` exige `inference_basis`, fica fora das consultas por padrão e, quando incluído, o caminho vem com `all_declared=false`; o organograma rotula "inferido — não confirmado". Nunca como fato.
4. Pessoa = nome (+ URL pública de perfil) + cargos/empresa (DP-11 P4). Qualquer outro campo é recusado com `extendedPersonalData=false` (aplicação) e por gatilho no banco (`intel_settings.extended_personal_data=false`). Ligar a flag exige mudança de migração/ADR, fora desta entrega (J-01 aberto).
5. Primeira observação de uma pessoa é linha de base, não Move. Move nasce `detected`; alerta nasce `pending_review`; nada é publicado sem revisão.
6. Homônimos não são fundidos só pelo nome. Pessoa suprimida some do grafo/Moves/alertas e não é recriada por reingestão.

## Uso
```ts
import { PGlite } from '@electric-sql/pglite'; // testes; em produção, um cliente `pg` com a mesma interface Db
import { applyMigrations, processObservation } from '@loyaltynews/intelligence';
```
`npm test` (vitest + PGlite = PostgreSQL real em memória), `npm run typecheck`.

## Não verificado / pendências
- Desempenho com 100 mil arestas (critério ADR-009: p95 ≤ 300 ms, a fixar em R5-05): só smoke com ~5 mil arestas em PGlite/WASM.
- Testado em PGlite (PostgreSQL 17 WASM), não em PostgreSQL 18 da Vertra.
- Sem coleta real: nenhuma fonte, nenhum crawler. A ingestão virá de `packages/editorial` via `RoleObservation`.
- Flag oficial em `packages/contracts/flags.ts` (Chief Architect) ainda não existe; aqui há `IntelligenceConfig`. Integração com `packages/db` (executor de migrações) e API pelo Backend.
- Base legal LGPD/controlador (J-01/R1-01) não resolvida: a flag ampliada continua desligada.
