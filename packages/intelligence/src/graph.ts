import type { Db } from './db';
import type { Certainty, Uuid } from './types';

const S = 'intelligence';
export const MAX_HOPS = 3; // ADR-009: consultas de caminho limitadas a 3 saltos

export type NodeType = 'person' | 'organization';
export interface NodeRef { type: NodeType; id: Uuid }

export interface GraphOptions {
  /** Data de referência (vigência). Padrão: hoje. */
  asOf?: string;
  /** Inclui arestas inferidas — sempre sinalizadas em `all_declared = false`. Padrão: false. */
  includeInferred?: boolean;
  maxHops?: number;
}

export interface Reached {
  node_type: NodeType;
  node_id: Uuid;
  depth: number;
  path: string[]; // "tipo:id" de cada nó, do início ao fim
  edge_ids: Uuid[];
  /** false se alguma aresta do caminho é inferida: o vínculo NÃO pode ser exibido como fato. */
  all_declared: boolean;
}

// Arestas vigentes na data, tornadas não direcionadas para a travessia.
const EDGES_CTE = `
  edges AS NOT MATERIALIZED (
    SELECT src_type AS a_type, src_id AS a_id, dst_type AS b_type, dst_id AS b_id, edge_id, certainty
      FROM ${S}.graph_edge
     WHERE valid_from <= $3::date AND (valid_to IS NULL OR valid_to > $3::date) AND ($4::boolean OR certainty = 'declared')
    UNION ALL
    SELECT dst_type, dst_id, src_type, src_id, edge_id, certainty
      FROM ${S}.graph_edge
     WHERE valid_from <= $3::date AND (valid_to IS NULL OR valid_to > $3::date) AND ($4::boolean OR certainty = 'declared')
  ),
  walk AS (
    SELECT 1 AS depth, e.b_type, e.b_id,
           ARRAY[$1::text || ':' || $2::text, e.b_type || ':' || e.b_id::text] AS path,
           ARRAY[e.edge_id] AS edge_ids,
           (e.certainty = 'declared') AS all_declared
      FROM edges e WHERE e.a_type = $1 AND e.a_id = $2::uuid
    UNION ALL
    SELECT w.depth + 1, e.b_type, e.b_id,
           w.path || (e.b_type || ':' || e.b_id::text),
           w.edge_ids || e.edge_id,
           w.all_declared AND (e.certainty = 'declared')
      FROM walk w
      JOIN edges e ON e.a_type = w.b_type AND e.a_id = w.b_id
     WHERE w.depth < $5::int AND NOT ((e.b_type || ':' || e.b_id::text) = ANY (w.path))
  )`;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function hops(o: GraphOptions): number {
  return Math.max(1, Math.min(o.maxHops ?? MAX_HOPS, MAX_HOPS));
}

// ------------------------------------------------------------------------------------------------
// Busca em LARGURA por salto (ADR-009): uma consulta por salto, para a fronteira INTEIRA, e deduplicação por entidade em memória.
// A versão recursiva enumera todos os CAMINHOS (a contagem explode com o grau: ~grau^3 linhas) e sonda a visão graph_edge (3 ramos com junções)
// uma vez por caminho; aqui cada entidade entra uma vez, na menor profundidade, e a sonda é por lote (`= ANY(ids)` usa os índices por pessoa,
// organização e relação). Mesma semântica: uma linha por entidade, menor profundidade, caminho declarado preferido; arestas vigentes na data;
// inferidas só com includeInferred (e sinalizadas em all_declared = false). Mesmo limite de 3 saltos.
// ------------------------------------------------------------------------------------------------
interface Visit { node_type: NodeType; node_id: Uuid; depth: number; path: string[]; edge_ids: Uuid[]; all_declared: boolean }
interface EdgeRow { dir: 'f' | 'r'; a_type: NodeType; a_id: Uuid; b_type: NodeType; b_id: Uuid; edge_id: Uuid; certainty: Certainty }

const key = (t: NodeType, id: Uuid) => `${t}:${id}`;

/** Arestas vigentes que tocam a fronteira, nas duas direções (grafo não direcionado): 'f' = a fronteira é a origem; 'r' = é o destino. */
async function frontierEdges(db: Db, ids: Uuid[], asOf: string, includeInferred: boolean): Promise<EdgeRow[]> {
  const r = await db.query<EdgeRow>(
    `SELECT 'f' AS dir, src_type AS a_type, src_id AS a_id, dst_type AS b_type, dst_id AS b_id, edge_id, certainty
       FROM ${S}.graph_edge
      WHERE src_id = ANY($1::uuid[]) AND valid_from <= $2::date AND (valid_to IS NULL OR valid_to > $2::date) AND ($3::boolean OR certainty = 'declared')
     UNION ALL
     SELECT 'r', dst_type, dst_id, src_type, src_id, edge_id, certainty
       FROM ${S}.graph_edge
      WHERE dst_id = ANY($1::uuid[]) AND valid_from <= $2::date AND (valid_to IS NULL OR valid_to > $2::date) AND ($3::boolean OR certainty = 'declared')`,
    [ids, asOf, includeInferred],
  );
  return r.rows;
}

/** Expande salto a salto. `stopAt`: para no primeiro salto em que a entidade aparece (menor caminho). */
async function bfs(db: Db, from: NodeRef, opts: GraphOptions, stopAt?: NodeRef): Promise<Map<string, Visit>> {
  const asOf = opts.asOf ?? today();
  const inferred = opts.includeInferred ?? false;
  const max = hops(opts);
  const start: Visit = { node_type: from.type, node_id: from.id, depth: 0, path: [key(from.type, from.id)], edge_ids: [], all_declared: true };
  const seen = new Map<string, Visit>([[key(from.type, from.id), start]]);
  let frontier: Visit[] = [start];
  for (let depth = 1; depth <= max && frontier.length; depth++) {
    const byKey = new Map(frontier.map((v) => [key(v.node_type, v.node_id), v]));
    const rows = await frontierEdges(db, frontier.map((v) => v.node_id), asOf, inferred);
    rows.sort((x, y) => (x.edge_id < y.edge_id ? -1 : x.edge_id > y.edge_id ? 1 : x.dir < y.dir ? -1 : 1)); // desempate determinístico
    const found = new Map<string, Visit>();
    for (const e of rows) {
      const parent = byKey.get(key(e.a_type, e.a_id)); // o mesmo uuid em outro tipo não é a fronteira
      if (!parent) continue;
      const k = key(e.b_type, e.b_id);
      if (seen.has(k)) continue; // já alcançada em salto menor (ou é a origem)
      const declared = parent.all_declared && e.certainty === 'declared';
      const cur = found.get(k);
      if (cur && (cur.all_declared || !declared)) continue; // mantém o caminho declarado preferido (empate: o primeiro, por edge_id)
      found.set(k, { node_type: e.b_type, node_id: e.b_id, depth, path: [...parent.path, k], edge_ids: [...parent.edge_ids, e.edge_id], all_declared: declared });
    }
    for (const [k, v] of found) seen.set(k, v);
    if (stopAt && found.has(key(stopAt.type, stopAt.id))) break;
    frontier = [...found.values()];
  }
  return seen;
}

/** Variante EM LOTE (uma consulta por salto, até 3 idas ao banco): referência para teste de equivalência e comparativo. O produto usa `neighbors` (uma ida). */
export async function neighborsBatched(db: Db, from: NodeRef, opts: GraphOptions = {}): Promise<Reached[]> {
  const seen = await bfs(db, from, opts);
  seen.delete(key(from.type, from.id));
  return [...seen.values()].sort((a, b) => a.depth - b.depth || a.path.join().localeCompare(b.path.join()));
}

/** Variante EM LOTE do menor caminho (referência; ver `neighborsBatched`). */
export async function shortestPathBatched(db: Db, from: NodeRef, to: NodeRef, opts: GraphOptions = {}): Promise<Reached | null> {
  if (from.type === to.type && from.id === to.id) return null;
  const seen = await bfs(db, from, opts, to);
  return seen.get(key(to.type, to.id)) ?? null;
}

// ------------------------------------------------------------------------------------------------
// UMA ida ao banco por consulta (ADR-009, 2ª rodada). No PostgreSQL do staging, medido de fora da rede da Vertra, os p50 de TODAS as variantes
// ficaram em ~415–445 ms mesmo com planos que tocam só ~850 buffers: o custo dominante é a ida e volta (a BFS em lote faz até 3). Aqui os (no máximo)
// 3 saltos viram 3 CTEs NÃO recursivas encadeadas, cada uma com DISTINCT ON por entidade (menor profundidade; caminho declarado preferido; empate pelo
// menor edge_id), excluindo as entidades já vistas nos níveis anteriores. Mesma semântica das outras duas implementações (teste de equivalência).
// ------------------------------------------------------------------------------------------------
const EDGES_ONLY = EDGES_CTE.slice(0, EDGES_CTE.indexOf('  walk AS ('));

/**
 * Arestas vigentes que tocam a fronteira do nível anterior, nas duas direções, buscadas com `= ANY(<array da fronteira>)`: o array vem de um InitPlan
 * (`ARRAY(SELECT b_id FROM lN)`), então o planejador sonda os ÍNDICES por pessoa/organização/relação em vez de juntar a fronteira com a visão inteira
 * (a 1ª versão da consulta única juntava com a visão e ficou ~6× mais lenta no servidor). `gate`: condição que faz o nível nem rodar.
 */
function frontierEdgesSql(prev: string, gate: string): string {
  const valid = `valid_from <= $3::date AND (valid_to IS NULL OR valid_to > $3::date) AND ($4::boolean OR certainty = 'declared')`;
  return `
    SELECT src_type AS a_type, src_id AS a_id, dst_type AS b_type, dst_id AS b_id, edge_id, certainty
      FROM ${S}.graph_edge
     WHERE ${gate} AND src_id = ANY(ARRAY(SELECT b_id FROM ${prev})) AND ${valid}
    UNION ALL
    SELECT dst_type, dst_id, src_type, src_id, edge_id, certainty
      FROM ${S}.graph_edge
     WHERE ${gate} AND dst_id = ANY(ARRAY(SELECT b_id FROM ${prev})) AND ${valid}`;
}

/** `stopL2`/`stopL3`: condições extras (terminadas em AND) que fazem os níveis 2/3 nem rodarem (saída antecipada do menor caminho). */
function levelsSql(stopL2: string, stopL3: string): string {
  return `
  l1 AS (
    SELECT DISTINCT ON (e.b_type, e.b_id) 1 AS depth, e.b_type, e.b_id,
           ARRAY[$1::text || ':' || $2::text, e.b_type || ':' || e.b_id::text] AS path, ARRAY[e.edge_id] AS edge_ids,
           (e.certainty = 'declared') AS all_declared
      FROM edges e
     WHERE e.a_type = $1 AND e.a_id = $2::uuid AND NOT (e.b_type = $1 AND e.b_id = $2::uuid)
     ORDER BY e.b_type, e.b_id, (e.certainty = 'declared') DESC, e.edge_id
  ),
  e2 AS (${frontierEdgesSql('l1', `$5::int >= 2 AND ${stopL2}`)}
  ),
  l2 AS (
    SELECT DISTINCT ON (e.b_type, e.b_id) 2 AS depth, e.b_type, e.b_id,
           l.path || (e.b_type || ':' || e.b_id::text) AS path, l.edge_ids || e.edge_id AS edge_ids,
           (l.all_declared AND e.certainty = 'declared') AS all_declared
      FROM l1 l JOIN e2 e ON e.a_type = l.b_type AND e.a_id = l.b_id
     WHERE NOT (e.b_type = $1 AND e.b_id = $2::uuid)
       AND NOT EXISTS (SELECT 1 FROM l1 x WHERE x.b_type = e.b_type AND x.b_id = e.b_id)
     ORDER BY e.b_type, e.b_id, (l.all_declared AND e.certainty = 'declared') DESC, e.edge_id
  ),
  e3 AS (${frontierEdgesSql('l2', `$5::int >= 3 AND ${stopL3}`)}
  ),
  l3 AS (
    SELECT DISTINCT ON (e.b_type, e.b_id) 3 AS depth, e.b_type, e.b_id,
           l.path || (e.b_type || ':' || e.b_id::text) AS path, l.edge_ids || e.edge_id AS edge_ids,
           (l.all_declared AND e.certainty = 'declared') AS all_declared
      FROM l2 l JOIN e3 e ON e.a_type = l.b_type AND e.a_id = l.b_id
     WHERE NOT (e.b_type = $1 AND e.b_id = $2::uuid)
       AND NOT EXISTS (SELECT 1 FROM l1 x WHERE x.b_type = e.b_type AND x.b_id = e.b_id)
       AND NOT EXISTS (SELECT 1 FROM l2 x WHERE x.b_type = e.b_type AND x.b_id = e.b_id)
     ORDER BY e.b_type, e.b_id, (l.all_declared AND e.certainty = 'declared') DESC, e.edge_id
  )`;
}
const ALL_LEVELS = `SELECT node_type, node_id, depth, path, edge_ids, all_declared FROM (
    SELECT b_type AS node_type, b_id AS node_id, depth, path, edge_ids, all_declared FROM l1
    UNION ALL SELECT b_type, b_id, depth, path, edge_ids, all_declared FROM l2
    UNION ALL SELECT b_type, b_id, depth, path, edge_ids, all_declared FROM l3) r`;
// Menor caminho: os níveis 2 e 3 só rodam se o destino ainda não apareceu (InitPlan avaliado uma vez: saída antecipada dentro de UMA consulta).
const SP_STOP_L2 = 'NOT EXISTS (SELECT 1 FROM l1 t WHERE t.b_type = $6 AND t.b_id = $7::uuid)';
const SP_STOP_L3 = `${SP_STOP_L2} AND NOT EXISTS (SELECT 1 FROM l2 t WHERE t.b_type = $6 AND t.b_id = $7::uuid)`;
const WITH_EDGES = EDGES_ONLY.trimEnd().replace(/,$/, '');

/** Entidades alcançáveis em até N (≤3) saltos, uma linha por entidade (menor profundidade; caminho declarado preferido). UMA ida ao banco. */
export async function neighbors(db: Db, from: NodeRef, opts: GraphOptions = {}): Promise<Reached[]> {
  const r = await db.query<Reached>(
    `WITH ${WITH_EDGES},${levelsSql('TRUE', 'TRUE')}
     ${ALL_LEVELS}`,
    [from.type, from.id, opts.asOf ?? today(), opts.includeInferred ?? false, hops(opts)],
  );
  return r.rows.sort((a, b) => a.depth - b.depth || a.path.join().localeCompare(b.path.join()));
}

/** Menor caminho entre duas entidades (≤3 saltos). null se não houver caminho com as arestas permitidas. UMA ida ao banco. */
export async function shortestPath(db: Db, from: NodeRef, to: NodeRef, opts: GraphOptions = {}): Promise<Reached | null> {
  if (from.type === to.type && from.id === to.id) return null;
  const r = await db.query<Reached>(
    `WITH ${WITH_EDGES},${levelsSql(SP_STOP_L2, SP_STOP_L3)}
     ${ALL_LEVELS} WHERE node_type = $6 AND node_id = $7::uuid ORDER BY depth, all_declared DESC LIMIT 1`,
    [from.type, from.id, opts.asOf ?? today(), opts.includeInferred ?? false, hops(opts), to.type, to.id],
  );
  return r.rows[0] ?? null;
}

/**
 * IMPLEMENTAÇÃO DE REFERÊNCIA (recursiva, enumera TODOS os caminhos): mantida para os testes de equivalência e para o comparativo do benchmark.
 * No PostgreSQL real (18.6, staging, 115 mil arestas) levou p95 de 1055 ms em `neighbors` e 415 ms em `shortestPath`: ver bench/results/pg-staging.json.
 * O produto usa `neighbors`/`shortestPath` abaixo (busca em largura por salto).
 */
export async function neighborsRecursive(db: Db, from: NodeRef, opts: GraphOptions = {}): Promise<Reached[]> {
  const r = await db.query<Reached>(
    `WITH RECURSIVE ${EDGES_CTE}
     SELECT DISTINCT ON (b_type, b_id) b_type AS node_type, b_id AS node_id, depth, path, edge_ids, all_declared
       FROM walk
      WHERE NOT (b_type = $1 AND b_id = $2::uuid)
      ORDER BY b_type, b_id, depth, all_declared DESC`,
    [from.type, from.id, opts.asOf ?? today(), opts.includeInferred ?? false, hops(opts)],
  );
  return r.rows.sort((a, b) => a.depth - b.depth || a.path.join().localeCompare(b.path.join()));
}

export async function shortestPathRecursive(db: Db, from: NodeRef, to: NodeRef, opts: GraphOptions = {}): Promise<Reached | null> {
  const r = await db.query<Reached>(
    `WITH RECURSIVE ${EDGES_CTE}
     SELECT b_type AS node_type, b_id AS node_id, depth, path, edge_ids, all_declared
       FROM walk WHERE b_type = $6 AND b_id = $7::uuid
      ORDER BY depth, all_declared DESC LIMIT 1`,
    [from.type, from.id, opts.asOf ?? today(), opts.includeInferred ?? false, hops(opts), to.type, to.id],
  );
  return r.rows[0] ?? null;
}

/** Pessoas com cargo vigente numa organização (e nas coligadas até `hops` saltos de relação corporativa, opcional). */
export async function currentPeopleAt(db: Db, organizationId: Uuid, asOf: string = today()) {
  const r = await db.query<{ person_id: Uuid; full_name: string; title: string; certainty: Certainty; evidence_id: Uuid; validated_at: string }>(
    `SELECT p.id AS person_id, p.full_name, r.title, r.certainty, r.evidence_id, r.validated_at
       FROM ${S}.role_assignment r JOIN ${S}.person p ON p.id = r.person_id AND p.suppressed_at IS NULL
      WHERE r.organization_id = $1 AND r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to > $2::date)
      ORDER BY p.full_name`,
    [organizationId, asOf],
  );
  return r.rows;
}

/** Ex-colegas: pessoas que dividiram a mesma organização com a pessoa em períodos sobrepostos (só cargos declarados). */
export async function sharedHistory(db: Db, personId: Uuid) {
  const r = await db.query<{ other_person_id: Uuid; other_name: string; organization: string; overlap_from: string; overlap_to: string | null }>(
    `SELECT b.person_id AS other_person_id, pb.full_name AS other_name, o.legal_name AS organization,
            GREATEST(a.valid_from, b.valid_from)::text AS overlap_from,
            CASE WHEN a.valid_to IS NULL THEN b.valid_to WHEN b.valid_to IS NULL THEN a.valid_to ELSE LEAST(a.valid_to, b.valid_to) END::text AS overlap_to
       FROM ${S}.role_assignment a
       JOIN ${S}.role_assignment b ON b.organization_id = a.organization_id AND b.person_id <> a.person_id
       JOIN ${S}.person pa ON pa.id = a.person_id AND pa.suppressed_at IS NULL
       JOIN ${S}.person pb ON pb.id = b.person_id AND pb.suppressed_at IS NULL
       JOIN ${S}.organization o ON o.id = a.organization_id
      WHERE a.person_id = $1 AND a.certainty = 'declared' AND b.certainty = 'declared'
        AND a.valid_from <= COALESCE(b.valid_to, 'infinity'::date) AND b.valid_from <= COALESCE(a.valid_to, 'infinity'::date)
      ORDER BY overlap_from, other_name`,
    [personId],
  );
  return r.rows;
}
