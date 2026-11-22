import type { Db } from './db.ts';
import type { Certainty, Uuid } from './types.ts';

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
  edges AS (
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

/** Entidades alcançáveis em até N (≤3) saltos, uma linha por entidade (menor profundidade; caminho declarado preferido). */
export async function neighbors(db: Db, from: NodeRef, opts: GraphOptions = {}): Promise<Reached[]> {
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

/** Menor caminho entre duas entidades (≤3 saltos). null se não houver caminho com as arestas permitidas. */
export async function shortestPath(db: Db, from: NodeRef, to: NodeRef, opts: GraphOptions = {}): Promise<Reached | null> {
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
