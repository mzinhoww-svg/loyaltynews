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
import { neighbors, neighborsBatched, neighborsRecursive, shortestPath, shortestPathBatched, shortestPathRecursive } from './graph';
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
  /** Mede também a implementação recursiva de REFERÊNCIA (antes da otimização) nas mesmas entidades: comparativo no mesmo servidor. Mais lento (minutos). */
  compareReference?: boolean;
  /** Mede o produto de novo DEPOIS de criar os índices cobrindo propostos (só no schema de teste; nenhuma migração): comparativo antes/depois no mesmo servidor. */
  withIndexes?: boolean;
  failAt?: 'after-create' | 'after-load' | 'during-measure';
  log?: (line: string) => void;
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };
const stats = (xs: number[]) => ({ n: xs.length, p50_ms: +pct(xs, 50).toFixed(1), p95_ms: +pct(xs, 95).toFixed(1), p99_ms: +pct(xs, 99).toFixed(1), max_ms: +Math.max(...xs).toFixed(1), mean_ms: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) });

/** Índices cobrindo propostos para a visão graph_edge (candidatos à migração; aqui só dentro do schema de teste). `id` entra no INCLUDE porque a visão devolve edge_id. */
export const proposedIndexes = (schema: string) => [
  `CREATE INDEX bench_rel_from_cov ON ${schema}.org_relation (from_org_id) INCLUDE (id, to_org_id, valid_from, valid_to, certainty)`,
  `CREATE INDEX bench_rel_to_cov ON ${schema}.org_relation (to_org_id) INCLUDE (id, from_org_id, valid_from, valid_to, certainty)`,
  `CREATE INDEX bench_role_person_cov ON ${schema}.role_assignment (person_id) INCLUDE (id, organization_id, valid_from, valid_to, certainty)`,
  `CREATE INDEX bench_role_org_cov ON ${schema}.role_assignment (organization_id) INCLUDE (id, person_id, valid_from, valid_to, certainty)`,
];

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
  const counted = { n: 0 };
  const counting: Db = { query: async <T,>(sql: string, params?: unknown[]) => { counted.n++; return db.query<T>(sql, params); } };
  const recording: Db = {
    query: async <T,>(sql: string, params?: unknown[]) => {
      const list = (captured[label] ??= []);
      if (label) {
        // guarda, por texto de SQL, a chamada de MAIOR fronteira (a que mais pesa) para o EXPLAIN
        const size = (x: unknown[]) => (Array.isArray(x[0]) ? (x[0] as unknown[]).length : 0);
        const at = list.findIndex((x) => x.sql === sub(sql));
        if (at < 0 && list.length < 3) list.push({ sql: sub(sql), params: params ?? [] });
        else if (at >= 0 && size(params ?? []) > size(list[at]!.params)) list[at] = { sql: sub(sql), params: params ?? [] };
      }
      return counting.query<T>(sql, params);
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
    const rounds = Math.min(QUERIES + WARMUP, orgIds.length - 1, personIds.length);

    // 4a) ida e volta (SELECT 1): separa REDE de consulta. Quem roda de fora da rede da Vertra paga isto em cada ida ao banco.
    const rttSamples: number[] = [];
    for (let i = 0; i < 45; i++) { const t = performance.now(); await q('SELECT 1'); if (i >= 5) rttSamples.push(performance.now() - t); }
    const rtt = stats(rttSamples);
    log(`ida e volta (SELECT 1): p50 ${rtt.p50_ms} ms`);

    type Impl = { nb: typeof neighbors; sp: typeof shortestPath };
    const median = (xs: number[]) => pct(xs, 50);
    async function measure(impl: Impl, withPlans: boolean) {
      const nbOrg: number[] = [], nbPerson: number[] = [], path: number[] = [], reached: number[] = [];
      const cOrg: number[] = [], cPerson: number[] = [], cPath: number[] = [];
      for (let i = 0; i < rounds; i++) {
        if (opts.failAt === 'during-measure' && i === 2) throw new Error('falha simulada (during-measure)');
        const rec = withPlans && i === WARMUP;
        label = rec ? 'neighbors_org' : '';
        let c0 = counted.n;
        let t = performance.now();
        const a1 = await impl.nb(rec ? recording : counting, { type: 'organization', id: orgIds[i]! }, { asOf: AS_OF });
        const d1 = performance.now() - t; const k1 = counted.n - c0;
        label = rec ? 'neighbors_person' : '';
        c0 = counted.n; t = performance.now();
        await impl.nb(rec ? recording : counting, { type: 'person', id: personIds[i]! }, { asOf: AS_OF });
        const d2 = performance.now() - t; const k2 = counted.n - c0;
        label = rec ? 'shortest_path' : '';
        c0 = counted.n; t = performance.now();
        await impl.sp(rec ? recording : counting, { type: 'organization', id: orgIds[i]! }, { type: 'organization', id: orgIds[i + 1]! }, { asOf: AS_OF });
        const d3 = performance.now() - t; const k3 = counted.n - c0;
        label = '';
        if (i >= WARMUP) { nbOrg.push(d1); nbPerson.push(d2); path.push(d3); reached.push(a1.length); cOrg.push(k1); cPerson.push(k2); cPath.push(k3); }
      }
      // ESTIMATIVA: tempo se o aplicativo estivesse na mesma rede do banco = p95 medido − (idas ao banco × ida e volta mediana do SELECT 1)
      const series = (xs: number[], ks: number[]) => ({ ...stats(xs), db_roundtrips_median: median(ks), estimate_colocated_p95_ms: +Math.max(0, pct(xs, 95) - median(ks) * rtt.p50_ms).toFixed(1) });
      return {
        neighbors_from_organization: { ...series(nbOrg, cOrg), entities_reached_median: pct(reached, 50), entities_reached_max: Math.max(...reached) },
        neighbors_from_person: series(nbPerson, cPerson),
        shortest_path_org_to_org: series(path, cPath),
      };
    }
    const worstOf = (r: Awaited<ReturnType<typeof measure>>) => Math.max(r.neighbors_from_organization.p95_ms, r.neighbors_from_person.p95_ms, r.shortest_path_org_to_org.p95_ms);
    const worstEstOf = (r: Awaited<ReturnType<typeof measure>>) => Math.max(r.neighbors_from_organization.estimate_colocated_p95_ms, r.neighbors_from_person.estimate_colocated_p95_ms, r.shortest_path_org_to_org.estimate_colocated_p95_ms);

    const product = await measure({ nb: neighbors, sp: shortestPath }, true);

    // 4b) comparativos no MESMO servidor e na mesma hora (opcional): BFS em lote (variante anterior) e recursiva (referência original)
    let referenceBatched: Awaited<ReturnType<typeof measure>> | undefined;
    let referenceRecursive: Awaited<ReturnType<typeof measure>> | undefined;
    if (opts.compareReference) {
      referenceBatched = await measure({ nb: neighborsBatched, sp: shortestPathBatched }, false);
      referenceRecursive = await measure({ nb: neighborsRecursive, sp: shortestPathRecursive }, false);
    }

    // 5) EXPLAIN (ANALYZE, BUFFERS) das mesmas consultas (dados sintéticos; só o plano) + tempo de SERVIDOR (planejamento e execução)
    const explainAll = async () => {
      const plans: Record<string, string[]> = {};
      const server: Record<string, { planning_ms: number | null; execution_ms: number | null }[]> = {};
      for (const [name, list] of Object.entries(captured)) {
        plans[name] = []; server[name] = [];
        for (const c of list) {
          try {
            const r = await q(`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF) ${c.sql}`, c.params);
            const text = r.rows.map((x) => String(Object.values(x)[0])).join('\n');
            const num = (re: RegExp) => { const m = re.exec(text); return m ? +Number(m[1]).toFixed(2) : null; };
            const t = { planning_ms: num(/Planning Time: ([\d.]+) ms/), execution_ms: num(/Execution Time: ([\d.]+) ms/) };
            server[name]!.push(t);
            plans[name]!.push(`-- planning_ms=${t.planning_ms} execution_ms=${t.execution_ms}\n${text.slice(0, 6000)}`);
          } catch (e) { plans[name]!.push(`explain_indisponivel: ${(e as { code?: string }).code ?? (e as Error).name}`); server[name]!.push({ planning_ms: null, execution_ms: null }); }
        }
      }
      return { plans, server };
    };
    const base = await explainAll();

    // 5b) índices cobrindo propostos, SÓ no schema de teste: mede de novo no mesmo servidor (antes/depois)
    let withIndexes: { results: Awaited<ReturnType<typeof measure>>; server_side: Awaited<ReturnType<typeof explainAll>>['server']; indexes: string[] } | undefined;
    if (opts.withIndexes) {
      const idx = proposedIndexes(schema);
      for (const stmt of idx) await q(stmt);
      for (const t of ['org_relation', 'role_assignment', 'person', 'organization']) await q(`VACUUM (ANALYZE) ${schema}.${t}`);
      for (const k of Object.keys(captured)) delete captured[k];
      const res = await measure({ nb: neighbors, sp: shortestPath }, true);
      withIndexes = { results: res, server_side: (await explainAll()).server, indexes: idx.map((x) => x.replace(`${schema}.`, '')) };
    }

    const settings: Record<string, string> = {};
    for (const k of ['shared_buffers', 'work_mem', 'effective_cache_size', 'max_parallel_workers_per_gather']) {
      try { settings[k] = String((await q(`SELECT current_setting($1) AS v`, [k])).rows[0]?.v); } catch { /* ignora */ }
    }
    const version = String((await q(`SELECT version() AS v`)).rows[0]?.v ?? '').split(' on ')[0];
    const worst = worstOf(product);
    const sizeBytes = Number((await q(`SELECT coalesce(sum(pg_total_relation_size(c.oid)),0)::text AS s FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r','m')`, [schema])).rows[0]?.s ?? 0);
    const result = {
      generated_at: new Date().toISOString(),
      schema, version, settings,
      dataset: { synthetic: true, scale, orgs: ORGS, people: PEOPLE, graph_edges: edges, size_mb: +(sizeBytes / 2 ** 20).toFixed(1), load_seconds: +(loadMs / 1000).toFixed(1), as_of: AS_OF },
      queries: { per_series: QUERIES, warmup_discarded: WARMUP, max_hops: 3 },
      network: { select1_roundtrip: rtt, note: 'ida e volta de SELECT 1 a partir de onde o script roda; ESTIMATE_* = p95 − (idas ao banco × p50 do SELECT 1): estimativa, não medição' },
      results: product,
      reference_batched: referenceBatched,
      reference_recursive: referenceRecursive,
      with_indexes: withIndexes,
      proposed_criterion: { p95_ms: 300, edges: 100_000 },
      worst_p95_ms: +worst.toFixed(1),
      meets_criterion: edges >= 100_000 ? worst <= 300 : null, // null = carga abaixo de 100 mil arestas (fumaça): não vale como medição
      estimate_worst_p95_colocated_ms: +worstEstOf(product).toFixed(1),
      server_side: base.server,
      explain: base.plans,
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
