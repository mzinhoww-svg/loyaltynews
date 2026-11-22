/**
 * Benchmark de consultas de grafo com ~100 mil arestas, em PGlite (PostgreSQL em WASM, em memória).
 *
 * ATENÇÃO — NÃO VALE COMO MEDIÇÃO DO POSTGRESQL DA VERTRA: PGlite é single-thread, WASM, sem rede, sem disco, sem concorrência,
 * e outra versão do PostgreSQL. Serve para (1) detectar regressão grosseira de plano/consulta e (2) comparar versões do SQL
 * entre si na mesma máquina. O critério oficial (ADR-009: p95 <= 300 ms com 100 mil arestas) só se confirma no PostgreSQL 18
 * da Vertra em R5-05, com EXPLAIN (ANALYZE, BUFFERS).
 *
 * Dados 100% sintéticos e determinísticos (sem aleatoriedade: mesma carga em toda execução; só os tempos variam).
 * Como rodar (na raiz do monorepo): npm run perf -w @ln/intelligence
 * Resultado gravado em bench/results/latest.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createTestDb } from '@ln/db/testing';
import { neighbors, shortestPath } from '../src/graph';
import type { Db } from '../src/db';

const ORGS = 20_000;
const PEOPLE = 15_000;
const ORG_RELATIONS = 75_000; // alvo bruto; conflitos e autoarestas são descartados
const ROLES = 40_000;
const QUERIES = 60;
const WARMUP = 5;
const AS_OF = '2026-11-22';
const EV = '00000000-0000-4000-8000-000000000001';

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const stats = (xs: number[]) => ({
  n: xs.length,
  p50_ms: +pct(xs, 50).toFixed(1),
  p95_ms: +pct(xs, 95).toFixed(1),
  p99_ms: +pct(xs, 99).toFixed(1),
  max_ms: +Math.max(...xs).toFixed(1),
  mean_ms: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1),
});

describe('perf: grafo com ~100 mil arestas (PGlite — não vale como medição da Vertra)', () => {
  it('mede neighbors e shortestPath (até 3 saltos)', async () => {
    const t = await createTestDb(); // migrações oficiais do @ln/db (0006_intelligence)
    const pg = t.client;
    const db = pg as unknown as Db;

    const t0 = performance.now();
    await pg.exec(`
      INSERT INTO intelligence.evidence (id, source_url, source_name, source_class, retrieved_at, is_mock)
        VALUES ('${EV}','https://bench.invalid/x','MOCK bench','public', now(), true);
      INSERT INTO intelligence.organization (legal_name, normalized_name, evidence_id, observed_at)
        SELECT 'MOCK Org '||g, 'mock org '||g, '${EV}', now() FROM generate_series(1,${ORGS}) g;
      INSERT INTO intelligence.person (full_name, normalized_name, evidence_id, observed_at)
        SELECT 'MOCK Pessoa '||g, 'mock pessoa '||g, '${EV}', now() FROM generate_series(1,${PEOPLE}) g;
    `);
    // arestas pseudoaleatórias determinísticas (hash do índice); grau médio ~7,5 por organização
    await pg.exec(`
      CREATE TEMP TABLE o AS SELECT id, row_number() OVER (ORDER BY normalized_name) rn FROM intelligence.organization;
      CREATE TEMP TABLE p AS SELECT id, row_number() OVER (ORDER BY normalized_name) rn FROM intelligence.person;
      CREATE INDEX ON o(rn); CREATE INDEX ON p(rn);
      INSERT INTO intelligence.org_relation (from_org_id,to_org_id,relation_type,valid_from,evidence_id,observed_at,validated_at)
        SELECT a.id, b.id, 'partner_of', '2025-01-01', '${EV}', now(), now()
          FROM generate_series(1,${ORG_RELATIONS}) g
          JOIN o a ON a.rn = 1 + (abs(hashint4(g*2)) % ${ORGS})
          JOIN o b ON b.rn = 1 + (abs(hashint4(g*2+1)) % ${ORGS})
         WHERE a.id <> b.id
        ON CONFLICT DO NOTHING;
      INSERT INTO intelligence.role_assignment (person_id, organization_id, title, normalized_title, valid_from, evidence_id, observed_at, validated_at)
        SELECT pp.id, oo.id, 'Cargo '||(g % 5), 'cargo '||(g % 5), '2025-01-01', '${EV}', now(), now()
          FROM generate_series(1,${ROLES}) g
          JOIN p pp ON pp.rn = 1 + (abs(hashint4(g*3)) % ${PEOPLE})
          JOIN o oo ON oo.rn = 1 + (abs(hashint4(g*3+1)) % ${ORGS})
        ON CONFLICT DO NOTHING;
      ANALYZE;
    `);
    const loadMs = performance.now() - t0;
    const edges = Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.graph_edge`)).rows[0]!.c);
    expect(edges).toBeGreaterThanOrEqual(100_000);

    const take = QUERIES + WARMUP + 1;
    const orgIds = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization ORDER BY normalized_name LIMIT ${take} OFFSET 100`)).rows.map((r) => r.id);
    const personIds = (await db.query<{ id: string }>(`SELECT id FROM intelligence.person ORDER BY normalized_name LIMIT ${take} OFFSET 100`)).rows.map((r) => r.id);

    const nbOrg: number[] = [];
    const nbPerson: number[] = [];
    const path: number[] = [];
    const reached: number[] = [];
    for (let i = 0; i < QUERIES + WARMUP; i++) {
      let t = performance.now();
      const a = await neighbors(db, { type: 'organization', id: orgIds[i]! }, { asOf: AS_OF });
      const d1 = performance.now() - t;
      t = performance.now();
      await neighbors(db, { type: 'person', id: personIds[i]! }, { asOf: AS_OF });
      const d2 = performance.now() - t;
      t = performance.now();
      await shortestPath(db, { type: 'organization', id: orgIds[i]! }, { type: 'organization', id: orgIds[i + 1]! }, { asOf: AS_OF });
      const d3 = performance.now() - t;
      if (i >= WARMUP) {
        nbOrg.push(d1);
        nbPerson.push(d2);
        path.push(d3);
        reached.push(a.length);
      }
    }

    const worstP95 = Math.max(pct(nbOrg, 95), pct(nbPerson, 95), pct(path, 95));
    const result = {
      disclaimer:
        'NÃO VALE COMO MEDIÇÃO DO POSTGRESQL DA VERTRA. PGlite = PostgreSQL em WASM, single-thread, em memória. Critério oficial (ADR-009, p95 <= 300 ms com 100 mil arestas) só se confirma no PG 18 da Vertra em R5-05.',
      generated_at: new Date().toISOString(),
      environment: {
        node: process.version,
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model ?? 'n/d',
        cpu_count: cpus().length,
        ram_gb: +(totalmem() / 2 ** 30).toFixed(1),
        engine: 'PGlite (PostgreSQL WASM)',
      },
      dataset: { synthetic: true, orgs: ORGS, people: PEOPLE, graph_edges: edges, load_seconds: +(loadMs / 1000).toFixed(1), as_of: AS_OF },
      queries: { per_series: QUERIES, warmup_discarded: WARMUP, max_hops: 3 },
      results: {
        neighbors_from_organization: { ...stats(nbOrg), entities_reached_median: pct(reached, 50), entities_reached_max: Math.max(...reached) },
        neighbors_from_person: stats(nbPerson),
        shortest_path_org_to_org: stats(path),
      },
      proposed_criterion: { p95_ms: 300, edges: 100_000 },
      worst_p95_ms: +worstP95.toFixed(1),
      p95_within_proposed_criterion_on_this_machine: worstP95 <= 300,
    };
    const out = join(dirname(fileURLToPath(import.meta.url)), 'results', 'latest.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
    await t.close();
  });
});
