import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { BENCH_SCHEMA_RE, defaultSchemaName, runPgBench, type BenchClient, type BenchOptions } from '../bench-pg';
import { newDb } from './helpers';

const MIGRATION = readFileSync(fileURLToPath(new URL('../../../db/drizzle/0006_intelligence.sql', import.meta.url)), 'utf8');
const SCHEMA = 'ln_bench_20261123';
const base = (over: Partial<BenchOptions> = {}): BenchOptions => ({ migrationSql: MIGRATION, schema: SCHEMA, scale: 0.02, queries: 4, warmup: 1, ...over });

let pg: PGlite;
let client: BenchClient;
beforeEach(async () => {
  ({ pg } = await newDb());
  client = { query: async (sql, params) => ({ rows: (await pg.query(sql, params)).rows as Record<string, unknown>[] }) };
});
const schemas = async () => (await pg.query<{ nspname: string }>(`SELECT nspname FROM pg_namespace WHERE nspname LIKE 'ln_bench%'`)).rows.map((r) => r.nspname);
const snapshot = async () => (await pg.query<{ t: string; c: string }>(
  `SELECT 'org' t, count(*)::text c FROM intelligence.organization UNION ALL SELECT 'person', count(*)::text FROM intelligence.person UNION ALL SELECT 'rel', count(*)::text FROM intelligence.org_relation UNION ALL SELECT 'ev', count(*)::text FROM intelligence.evidence`)).rows;

describe('medição ADR-009 em PostgreSQL real: schema isolado e descartável (testada em PGlite)', () => {
  it('nome do schema: só ln_bench_AAAAMMDD[_sufixo]; o padrão é a data de hoje', () => {
    expect(defaultSchemaName(new Date('2026-11-23T10:00:00Z'))).toBe('ln_bench_20261123');
    for (const ok of ['ln_bench_20261123', 'ln_bench_20261123_a1']) expect(BENCH_SCHEMA_RE.test(ok)).toBe(true);
    for (const bad of ['intelligence', 'public', 'ln_bench_x', 'ln_bench_20261123; DROP SCHEMA intelligence', 'LN_BENCH_20261123', 'ln_bench_20261123_ABCDEFGHI', '']) expect(BENCH_SCHEMA_RE.test(bad)).toBe(false);
  });

  it('nome inválido é recusado ANTES de qualquer comando (nada criado, nada apagado)', async () => {
    const before = await snapshot();
    for (const schema of ['intelligence', 'public', 'ln_bench_20261123; DROP SCHEMA intelligence CASCADE']) {
      await expect(runPgBench(client, base({ schema }))).rejects.toThrow(/bench_schema_invalido/);
    }
    expect(await schemas()).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('fumaça: cria, carrega, mede com as consultas do produto, traz EXPLAIN e APAGA o schema; o schema intelligence não é tocado', async () => {
    const before = await snapshot();
    const logs: string[] = [];
    const r = await runPgBench(client, base({ log: (l) => logs.push(l) }));
    expect(r.schema).toBe(SCHEMA);
    expect(r.schema_dropped).toBe(true);
    expect(await schemas()).toEqual([]);
    expect(await snapshot()).toEqual(before); // intelligence intacto
    expect(r.dataset.synthetic).toBe(true);
    expect(r.dataset.graph_edges).toBeGreaterThan(100);
    expect(r.meets_criterion).toBeNull(); // abaixo de 100 mil arestas não vale como medição
    for (const s of [r.results.neighbors_from_organization, r.results.neighbors_from_person, r.results.shortest_path_org_to_org]) {
      expect(s.n).toBeGreaterThan(0);
      expect(s.p95_ms).toBeGreaterThanOrEqual(0);
    }
    expect(Object.keys(r.explain).sort()).toEqual(['neighbors_org', 'neighbors_person', 'shortest_path']);
    expect(r.explain.neighbors_org![0]).toMatch(/Execution|Planning|Scan|CTE|Recursive/i);
    expect(logs.some((l) => /schema criado com a migração oficial/.test(l))).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/postgres(ql)?:\/\/|BEGIN (CERT|PRIVATE)/i);
  });

  it('separa REDE de consulta: ida e volta (SELECT 1), idas ao banco por consulta (produto = 1), tempo de SERVIDOR do EXPLAIN e estimativa na mesma rede', async () => {
    const r = await runPgBench(client, base());
    expect(r.network.select1_roundtrip.n).toBe(40);
    expect(r.network.select1_roundtrip.p50_ms).toBeGreaterThanOrEqual(0);
    for (const s of [r.results.neighbors_from_organization, r.results.neighbors_from_person, r.results.shortest_path_org_to_org]) {
      expect(s.db_roundtrips_median).toBe(1); // o produto faz UMA ida ao banco por consulta
      expect(s.estimate_colocated_p95_ms).toBeLessThanOrEqual(s.p95_ms);
    }
    expect(r.estimate_worst_p95_colocated_ms).toBeLessThanOrEqual(r.worst_p95_ms);
    for (const name of ['neighbors_org', 'neighbors_person', 'shortest_path']) {
      expect(r.server_side[name]![0]!.execution_ms).not.toBeNull(); // tempo de servidor lido do EXPLAIN (antes do corte do texto)
      expect(r.explain[name]![0]).toMatch(/^-- planning_ms=\d+(\.\d+)? execution_ms=\d+(\.\d+)?/);
    }
    expect(r.schema_dropped).toBe(true);
  });

  it('comparativos no mesmo servidor (--with-reference) e índices cobrindo propostos SÓ no schema de teste (--with-indexes); tudo apagado no fim', async () => {
    const before = await snapshot();
    const r = await runPgBench(client, base({ compareReference: true, withIndexes: true }));
    expect(r.reference_batched!.neighbors_from_organization.db_roundtrips_median).toBeGreaterThanOrEqual(1);
    expect(r.reference_batched!.neighbors_from_organization.db_roundtrips_median).toBeLessThanOrEqual(3);
    expect(r.reference_recursive!.neighbors_from_organization.db_roundtrips_median).toBe(1);
    expect(r.with_indexes!.indexes).toHaveLength(4);
    expect(r.with_indexes!.indexes.every((x) => /^CREATE INDEX bench_/.test(x) && !x.includes(SCHEMA))).toBe(true); // nada com o nome do schema real/de teste vazado no relatório de índices
    expect(r.with_indexes!.results.neighbors_from_person.n).toBeGreaterThan(0);
    expect(r.with_indexes!.server_side.neighbors_org![0]!.execution_ms).not.toBeNull();
    expect(r.schema_dropped).toBe(true);
    expect(await schemas()).toEqual([]);
    expect(await snapshot()).toEqual(before); // o schema intelligence continua sem nenhum índice novo nem dado novo
    const idx = await pg.query<{ c: string }>(`SELECT count(*)::text c FROM pg_indexes WHERE indexname LIKE 'bench_%'`);
    expect(idx.rows[0]!.c).toBe('0');
  });

  it('em ERRO (depois de criar, depois de carregar, durante a medição) o schema é apagado e o erro continua', async () => {
    const before = await snapshot();
    for (const failAt of ['after-create', 'after-load', 'during-measure'] as const) {
      await expect(runPgBench(client, base({ failAt }))).rejects.toThrow(/falha simulada/);
      expect(await schemas(), failAt).toEqual([]);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('schema que já existe e NÃO é deste script: recusa e não altera nada, nem com replace', async () => {
    await pg.exec(`CREATE SCHEMA ${SCHEMA}; CREATE TABLE ${SCHEMA}.alheia (x int); INSERT INTO ${SCHEMA}.alheia VALUES (1);`);
    for (const replace of [false, true]) {
      await expect(runPgBench(client, base({ replace }))).rejects.toThrow(/bench_schema_existe.*NÃO foi criado por este script/);
    }
    expect((await pg.query<{ x: number }>(`SELECT x FROM ${SCHEMA}.alheia`)).rows).toEqual([{ x: 1 }]);
  });

  it('schema de uma execução anterior (com a marca): só é apagado com replace explícito', async () => {
    await pg.exec(`CREATE SCHEMA ${SCHEMA}; COMMENT ON SCHEMA ${SCHEMA} IS 'ln-bench:2026-11-23T00:00:00Z'; CREATE TABLE ${SCHEMA}.velha (x int);`);
    await expect(runPgBench(client, base())).rejects.toThrow(/use --replace/);
    expect(await schemas()).toEqual([SCHEMA]);
    const r = await runPgBench(client, base({ replace: true }));
    expect(r.schema_dropped).toBe(true);
    expect(await schemas()).toEqual([]);
  });

  it('abort() (SIGINT/SIGTERM do ponto de entrada) apaga o schema criado e é idempotente', async () => {
    let abort: (() => Promise<void>) | undefined;
    const p = runPgBench(client, base({ failAt: 'during-measure' }), (h) => { abort = h.abort; });
    await expect(p).rejects.toThrow(/falha simulada/);
    await abort!();
    await abort!();
    expect(await schemas()).toEqual([]);
  });
});
