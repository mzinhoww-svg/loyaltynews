/**
 * Medição do critério da ADR-009 (p95 <= 300 ms com 100 mil arestas) em PostgreSQL REAL, num schema ISOLADO e DESCARTÁVEL.
 *
 * Garantias de segurança (todas testadas em PGlite, `src/tests/bench-pg.test.ts`):
 *  - Só toca no schema `ln_bench_<AAAAMMDD>[_sufixo]` criado por ESTA execução. Nunca lê nem altera o schema `intelligence` nem qualquer outro.
 *  - Se o schema já existir: recusa (nunca apaga o que não criou). `replace: true` só apaga se o comentário do schema começar por `ln-bench:` (marca deste script).
 *  - `DROP SCHEMA ... CASCADE` no `finally`, também em erro e em SIGINT/SIGTERM (o ponto de entrada liga o sinal a `abort()`); depois confere em `pg_namespace`.
 *  - Dados 100% sintéticos (MOCK), tabelas auxiliares e índices TODOS dentro do próprio schema (nada de tabela temporária fora dele); `statement_timeout` e `lock_timeout` na sessão; nada de DDL fora do schema.
 *  - A migração é a OFICIAL do @ln/db (0006_intelligence.sql) com o nome do schema trocado; as consultas medidas são as MESMAS do produto
 *    (`neighbors`, `shortestPath`): o cliente troca `intelligence.` pelo schema de teste no texto do SQL (as consultas usam nomes qualificados).
 *  - Nunca imprime URL, usuário, senha ou PEM; o relatório traz só tempos, contagens, versão e planos (EXPLAIN) sobre dados sintéticos.
 */
import { neighbors, shortestPath } from './graph';
import type { Db } from './db';

export const BENCH_SCHEMA_RE = /^ln_bench_\d{8}(_[a-z0-9]{1,8})?$/;
const MARK = 'ln-bench:';
const EV = '00000000-0000-4000-8000-000000000001';

export interface BenchClient { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

export interface BenchOptions {
  /** `ln_bench_AAAAMMDD` (ou com sufixo). Padrão: data de hoje (UTC). */
  schema?: string;
  /** Apaga um schema de execução anterior SÓ se ele tiver a marca deste script. */
  replace?: boolean;
  /** SQL da migração oficial 0006_intelligence (texto). */
  migrationSql: string;
  /** Fração do tamanho de referência (1 = ~100 mil arestas). 0.02 serve de fumaça. */
  scale?: number;
  queries?: number;
  warmup?: number;
  asOf?: string;
  /** Teste: lança neste passo para provar que o schema é apagado em erro. */
  failAt?: 'after-create' | 'after-load' | 'during-measure';
  log?: (line: string) => void;
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };
const stats = (xs: number[]) => ({ n: xs.length, p50_ms: +pct(xs, 50).toFixed(1), p95_ms: +pct(xs, 95).toFixed(1), p99_ms: +pct(xs, 99).toFixed(1), max_ms: +Math.max(...xs).toFixed(1), mean_ms: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) });

export const defaultSchemaName = (d = new Date()) => `ln_bench_${d.toISOString().slice(0, 10).replace(/-/g, '')}`;

export interface BenchHandle { schema: string; abort(): Promise<void> }

/** Roda a medição. `onHandle` recebe o schema e uma função `abort()` para o ponto de entrada ligar a SIGINT/SIGTERM. */
export async function runPgBench(client: BenchClient, opts: BenchOptions, onHandle?: (h: BenchHandle) => void) {
  const log = opts.log ?? (() => undefined);
  const schema = opts.schema ?? defaultSchemaName();
  if (!BENCH_SCHEMA_RE.test(schema)) throw new Error('bench_schema_invalido: use ln_bench_AAAAMMDD[_sufixo]');
  const scale = opts.scale ?? 1;
  if (!(scale > 0 && scale <= 1)) throw new Error('bench_scale_invalida: 0 < scale <= 1');
  const q = (sql: string, params?: unknown[]) => client.query(sql, params);

  // 1) o schema NÃO pode existir (ou só com a marca deste script e replace explícito)
  const exists = await q(`SELECT obj_description(n.oid, 'pg_namespace') AS c FROM pg_namespace n WHERE n.nspname = $1`, [schema]);
  if (exists.rows.length) {
    const comment = String(exists.rows[0]!.c ?? '');
    if (!(opts.replace && comment.startsWith(MARK))) throw new Error(`bench_schema_existe: ${schema} já existe${comment.startsWith(MARK) ? ' (use --replace para apagar o de uma execução anterior)' : ' e NÃO foi criado por este script: nada foi alterado'}`);
    await q(`DROP SCHEMA ${schema} CASCADE`);
    log(`schema anterior ${schema} (marca do script) apagado`);
  }

  let created = false;
  let dropped = false;
  const dropIt = async () => {
    if (!created || dropped) return;
    try { await q(`RESET search_path`); } catch { /* sessão pode estar em erro */ }
    await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    dropped = true;
  };
  onHandle?.({ schema, abort: dropIt });

  const sub = (sql: string) => sql.replace(/\bintelligence\./g, `${schema}.`);
  const db: Db = { query: async <T,>(sql: string, params?: unknown[]) => (await q(sub(sql), params)) as { rows: T[] } };
  const captured: Record<string, { sql: string; params: unknown[] }[]> = {};
  let label = '';
  const recording: Db = {
    query: async <T,>(sql: string, params?: unknown[]) => {
      const list = (captured[label] ??= []);
      if (label && list.length < 2 && !list.some((x) => x.sql === sql)) list.push({ sql: sub(sql), params: params ?? [] });
      return db.query<T>(sql, params);
    },
  };

  try {
    await q(`SET statement_timeout = '180s'`);
    await q(`SET lock_timeout = '5s'`);

    // 2) cria o schema com a migração OFICIAL (nome do schema trocado); marca o schema como deste script
    const migration = opts.migrationSql.replace(/\bintelligence\b/g, schema);
    await q(`CREATE SCHEMA ${schema}`);
    created = true;
    await q(`COMMENT ON SCHEMA ${schema} IS '${MARK}${new Date().toISOString()}'`);
    for (const stmt of migration.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
      if (/^CREATE SCHEMA/i.test(stmt)) continue; // já criado acima (com a marca)
      await q(stmt);
    }
    await q(`SET search_path TO ${schema}, public`);
    log('schema criado com a migração oficial');
    if (opts.failAt === 'after-create') throw new Error('falha simulada (after-create)');

    // 3) carga sintética determinística
    const ORGS = Math.max(40, Math.round(20_000 * scale));
    const PEOPLE = Math.max(30, Math.round(15_000 * scale));
    const RELS = Math.max(150, Math.round(75_000 * scale));
    const ROLES = Math.max(80, Math.round(40_000 * scale));
    const t0 = performance.now();
    await q(`INSERT INTO ${schema}.evidence (id, source_url, source_name, source_class, retrieved_at, is_mock) VALUES ('${EV}','https://bench.invalid/x','MOCK bench','public', now(), true)`);
    await q(`INSERT INTO ${schema}.organization (legal_name, normalized_name, evidence_id, observed_at) SELECT 'MOCK Org '||g, 'mock org '||g, '${EV}', now() FROM generate_series(1,${ORGS}) g`);
    await q(`INSERT INTO ${schema}.person (full_name, normalized_name, evidence_id, observed_at) SELECT 'MOCK Pessoa '||g, 'mock pessoa '||g, '${EV}', now() FROM generate_series(1,${PEOPLE}) g`);
    await q(`CREATE TABLE ${schema}.bench_o AS SELECT id, row_number() OVER (ORDER BY normalized_name) rn FROM ${schema}.organization`);
    await q(`CREATE TABLE ${schema}.bench_p AS SELECT id, row_number() OVER (ORDER BY normalized_name) rn FROM ${schema}.person`);
    await q(`CREATE INDEX ON ${schema}.bench_o(rn)`);
    await q(`CREATE INDEX ON ${schema}.bench_p(rn)`);
    await q(`INSERT INTO ${schema}.org_relation (from_org_id,to_org_id,relation_type,valid_from,evidence_id,observed_at,validated_at)
      SELECT a.id, b.id, 'partner_of', '2025-01-01', '${EV}', now(), now()
        FROM generate_series(1,${RELS}) g
        JOIN ${schema}.bench_o a ON a.rn = 1 + (abs(hashint4(g*2)) % ${ORGS})
        JOIN ${schema}.bench_o b ON b.rn = 1 + (abs(hashint4(g*2+1)) % ${ORGS})
       WHERE a.id <> b.id
      ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO ${schema}.role_assignment (person_id, organization_id, title, normalized_title, valid_from, evidence_id, observed_at, validated_at)
      SELECT pp.id, oo.id, 'Cargo '||(g % 5), 'cargo '||(g % 5), '2025-01-01', '${EV}', now(), now()
        FROM generate_series(1,${ROLES}) g
        JOIN ${schema}.bench_p pp ON pp.rn = 1 + (abs(hashint4(g*3)) % ${PEOPLE})
        JOIN ${schema}.bench_o oo ON oo.rn = 1 + (abs(hashint4(g*3+1)) % ${ORGS})
      ON CONFLICT DO NOTHING`);
    await q(`ANALYZE ${schema}.organization`); await q(`ANALYZE ${schema}.person`); await q(`ANALYZE ${schema}.org_relation`); await q(`ANALYZE ${schema}.role_assignment`);
    const loadMs = performance.now() - t0;
    const edges = Number((await q(`SELECT count(*)::text AS c FROM ${schema}.graph_edge`)).rows[0]!.c);
    log(`carga pronta: ${edges} arestas`);
    if (opts.failAt === 'after-load') throw new Error('falha simulada (after-load)');

    // 4) medição (as consultas do produto)
    const QUERIES = opts.queries ?? 60;
    const WARMUP = opts.warmup ?? 5;
    const AS_OF = opts.asOf ?? '2026-11-22';
    const take = QUERIES + WARMUP + 1;
    const orgIds = (await q(`SELECT id FROM ${schema}.organization ORDER BY normalized_name LIMIT ${take} OFFSET ${Math.min(100, Math.floor(ORGS / 3))}`)).rows.map((r) => String(r.id));
    const personIds = (await q(`SELECT id FROM ${schema}.person ORDER BY normalized_name LIMIT ${take} OFFSET ${Math.min(100, Math.floor(PEOPLE / 3))}`)).rows.map((r) => String(r.id));
    const nbOrg: number[] = [], nbPerson: number[] = [], path: number[] = [], reached: number[] = [];
    for (let i = 0; i < Math.min(QUERIES + WARMUP, orgIds.length - 1, personIds.length); i++) {
      if (opts.failAt === 'during-measure' && i === 2) throw new Error('falha simulada (during-measure)');
      label = i === WARMUP ? 'neighbors_org' : '';
      let t = performance.now();
      const a = await neighbors(i === WARMUP ? recording : db, { type: 'organization', id: orgIds[i]! }, { asOf: AS_OF });
      const d1 = performance.now() - t;
      label = i === WARMUP ? 'neighbors_person' : '';
      t = performance.now();
      await neighbors(i === WARMUP ? recording : db, { type: 'person', id: personIds[i]! }, { asOf: AS_OF });
      const d2 = performance.now() - t;
      label = i === WARMUP ? 'shortest_path' : '';
      t = performance.now();
      await shortestPath(i === WARMUP ? recording : db, { type: 'organization', id: orgIds[i]! }, { type: 'organization', id: orgIds[i + 1]! }, { asOf: AS_OF });
      const d3 = performance.now() - t;
      label = '';
      if (i >= WARMUP) { nbOrg.push(d1); nbPerson.push(d2); path.push(d3); reached.push(a.length); }
    }

    // 5) EXPLAIN (ANALYZE, BUFFERS) das mesmas consultas (dados sintéticos; só o plano)
    const plans: Record<string, string[]> = {};
    for (const [name, list] of Object.entries(captured)) {
      plans[name] = [];
      for (const c of list) {
        try {
          const r = await q(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${c.sql}`, c.params);
          plans[name]!.push(r.rows.map((x) => String(Object.values(x)[0])).join('\n').slice(0, 6000));
        } catch (e) { plans[name]!.push(`explain_indisponivel: ${(e as { code?: string }).code ?? (e as Error).name}`); }
      }
    }

    const settings: Record<string, string> = {};
    for (const k of ['shared_buffers', 'work_mem', 'effective_cache_size', 'max_parallel_workers_per_gather']) {
      try { settings[k] = String((await q(`SELECT current_setting($1) AS v`, [k])).rows[0]?.v); } catch { /* ignora */ }
    }
    const version = String((await q(`SELECT version() AS v`)).rows[0]?.v ?? '').split(' on ')[0];
    const worst = Math.max(pct(nbOrg, 95), pct(nbPerson, 95), pct(path, 95));
    const sizeBytes = Number((await q(`SELECT coalesce(sum(pg_total_relation_size(c.oid)),0)::text AS s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r','m')`, [schema])).rows[0]?.s ?? 0);
    const result = {
      generated_at: new Date().toISOString(),
      schema, version, settings,
      dataset: { synthetic: true, scale, orgs: ORGS, people: PEOPLE, graph_edges: edges, size_mb: +(sizeBytes / 2 ** 20).toFixed(1), load_seconds: +(loadMs / 1000).toFixed(1), as_of: AS_OF },
      queries: { per_series: nbOrg.length, warmup_discarded: WARMUP, max_hops: 3 },
      results: {
        neighbors_from_organization: { ...stats(nbOrg), entities_reached_median: pct(reached, 50), entities_reached_max: Math.max(...reached) },
        neighbors_from_person: stats(nbPerson),
        shortest_path_org_to_org: stats(path),
      },
      proposed_criterion: { p95_ms: 300, edges: 100_000 },
      worst_p95_ms: +worst.toFixed(1),
      meets_criterion: edges >= 100_000 ? worst <= 300 : null, // null = carga abaixo de 100 mil arestas (fumaça): não vale como medição
      explain: plans,
    };
    return { ...result, schema_dropped: await finish() };
  } catch (e) {
    await finish().catch(() => undefined);
    throw e;
  }

  async function finish(): Promise<boolean> {
    await dropIt();
    const left = await q(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [schema]);
    return created ? left.rows.length === 0 : true;
  }
}
