import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { Db } from '../db';
import { neighbors, neighborsBatched, neighborsRecursive, shortestPath, shortestPathBatched, shortestPathRecursive } from '../graph';
import { newDb } from './helpers';

// As DUAS variantes novas — consulta ÚNICA (produto: `neighbors`/`shortestPath`) e BFS em lote (`*Batched`) — têm de dar o MESMO resultado que a implementação
// recursiva de referência (que enumera todos os caminhos):
// mesmas entidades, mesma profundidade, mesmo all_declared, em grafo com arestas inferidas, encerradas, cargos e organograma.
const EV = '00000000-0000-4000-8000-000000000001';
const AS_OF = '2026-11-22';
let pg: PGlite;
let db: Db;
let orgIds: string[] = [];
let personIds: string[] = [];

beforeAll(async () => {
  ({ pg } = await newDb());
  db = pg as unknown as Db;
  await pg.exec(`
    INSERT INTO intelligence.evidence (id, source_url, source_name, source_class, retrieved_at, is_mock) VALUES ('${EV}','https://eq.invalid/x','MOCK eq','public', now(), true);
    INSERT INTO intelligence.organization (legal_name, normalized_name, evidence_id, observed_at) SELECT 'MOCK Org '||g, 'mock org '||lpad(g::text,4,'0'), '${EV}', now() FROM generate_series(1,260) g;
    INSERT INTO intelligence.person (full_name, normalized_name, evidence_id, observed_at) SELECT 'MOCK Pessoa '||g, 'mock pessoa '||lpad(g::text,4,'0'), '${EV}', now() FROM generate_series(1,180) g;
    CREATE TEMP TABLE o AS SELECT id, row_number() OVER (ORDER BY normalized_name) rn FROM intelligence.organization;
    CREATE TEMP TABLE p AS SELECT id, row_number() OVER (ORDER BY normalized_name) rn FROM intelligence.person;
    -- relações: ~1 em 6 inferida; ~1 em 9 já encerrada em 2026-01-01 (fora da data); alguns pares com DUAS relações (paralelas)
    INSERT INTO intelligence.org_relation (from_org_id,to_org_id,relation_type,valid_from,valid_to,certainty,inference_basis,evidence_id,observed_at,validated_at)
      SELECT a.id, b.id, CASE WHEN g % 2 = 0 THEN 'partner_of' ELSE 'other' END, '2025-01-01',
             CASE WHEN g % 9 = 0 THEN '2026-01-01'::date END,
             CASE WHEN g % 6 = 0 THEN 'inferred' ELSE 'declared' END, CASE WHEN g % 6 = 0 THEN 'teste' END, '${EV}', now(), now()
        FROM generate_series(1,520) g
        JOIN o a ON a.rn = 1 + (abs(hashint4(g*2)) % 260)
        JOIN o b ON b.rn = 1 + (abs(hashint4(g*2+1)) % 260)
       WHERE a.id <> b.id
      ON CONFLICT DO NOTHING;
    INSERT INTO intelligence.role_assignment (person_id, organization_id, title, normalized_title, valid_from, valid_to, certainty, inference_basis, evidence_id, observed_at, validated_at)
      SELECT pp.id, oo.id, 'Cargo '||(g % 5), 'cargo '||(g % 5), '2025-01-01',
             CASE WHEN g % 10 = 0 THEN '2026-06-01'::date END,
             CASE WHEN g % 8 = 0 THEN 'inferred' ELSE 'declared' END, CASE WHEN g % 8 = 0 THEN 'teste' END, '${EV}', now(), now()
        FROM generate_series(1,420) g
        JOIN p pp ON pp.rn = 1 + (abs(hashint4(g*3)) % 180)
        JOIN o oo ON oo.rn = 1 + (abs(hashint4(g*3+1)) % 260)
      ON CONFLICT DO NOTHING;
    -- organograma: superior → subordinado entre cargos da MESMA organização (≈ 60 arestas, algumas inferidas)
    INSERT INTO intelligence.org_chart_edge (organization_id, superior_role_id, subordinate_role_id, valid_from, certainty, inference_basis, evidence_id, observed_at, validated_at)
      SELECT sup.organization_id, sup.id, sub.id, '2025-06-01', CASE WHEN sup.id::text < sub.id::text AND (hashtext(sup.id::text) % 3 = 0) THEN 'inferred' ELSE 'declared' END,
             CASE WHEN sup.id::text < sub.id::text AND (hashtext(sup.id::text) % 3 = 0) THEN 'teste' END, '${EV}', now(), now()
        FROM intelligence.role_assignment sup
        JOIN intelligence.role_assignment sub ON sub.organization_id = sup.organization_id AND sub.id <> sup.id AND sub.person_id <> sup.person_id
       WHERE hashtext(sup.id::text || sub.id::text) % 4 = 0
       LIMIT 60
      ON CONFLICT DO NOTHING;
    ANALYZE;
  `);
  orgIds = (await pg.query<{ id: string }>(`SELECT id FROM intelligence.organization ORDER BY normalized_name`)).rows.map((r) => r.id);
  personIds = (await pg.query<{ id: string }>(`SELECT id FROM intelligence.person ORDER BY normalized_name`)).rows.map((r) => r.id);
});

const sig = (r: { node_type: string; node_id: string; depth: number; all_declared: boolean }) => `${r.node_type}:${r.node_id}|${r.depth}|${r.all_declared}`;

const IMPLS = [
  { nome: 'consulta única (produto)', nb: neighbors, sp: shortestPath },
  { nome: 'BFS em lote', nb: neighborsBatched, sp: shortestPathBatched },
] as const;

describe.each(IMPLS)('grafo: $nome = recursiva (referência)', ({ nb, sp }) => {
  it('o grafo de teste é rico o bastante (arestas de 3 tipos, inferidas e encerradas)', async () => {
    const k = await pg.query<{ k: string; c: string }>(`SELECT edge_kind k, count(*)::text c FROM intelligence.graph_edge GROUP BY 1 ORDER BY 1`);
    const kinds = new Set(k.rows.map((r) => r.k));
    expect(kinds.has('holds_role')).toBe(true);
    expect(kinds.has('reports_line')).toBe(true);
    expect(kinds.has('partner_of') || kinds.has('other')).toBe(true);
    expect(Number((await pg.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.graph_edge WHERE certainty = 'inferred'`)).rows[0]!.c)).toBeGreaterThan(20);
    expect(Number((await pg.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.graph_edge WHERE valid_to IS NOT NULL`)).rows[0]!.c)).toBeGreaterThan(20);
  });

  it('neighbors: mesmas entidades, profundidades e all_declared, com e sem inferidas, de organizações e de pessoas', async () => {
    let compared = 0;
    for (const includeInferred of [false, true]) {
      for (const [type, ids] of [['organization', orgIds], ['person', personIds]] as const) {
        for (let i = 0; i < 12; i++) {
          const from = { type, id: ids[(i * 17) % ids.length]! };
          const fast = await nb(db, from, { asOf: AS_OF, includeInferred });
          const ref = await neighborsRecursive(db, from, { asOf: AS_OF, includeInferred });
          expect(new Set(fast.map(sig)), `${type}#${i} inferred=${includeInferred}`).toEqual(new Set(ref.map(sig)));
          expect(fast.length).toBe(ref.length);
          // cada caminho é coerente: tem depth+1 nós e depth arestas, começa na origem e termina na entidade
          for (const r of fast) {
            expect(r.path).toHaveLength(r.depth + 1);
            expect(r.edge_ids).toHaveLength(r.depth);
            expect(r.path[0]).toBe(`${from.type}:${from.id}`);
            expect(r.path[r.depth]).toBe(`${r.node_type}:${r.node_id}`);
            expect(new Set(r.path).size).toBe(r.path.length); // sem ciclo
          }
          compared += fast.length;
        }
      }
    }
    expect(compared).toBeGreaterThan(500); // o teste exercita de fato (não é vazio)
  });

  it('shortestPath: mesma profundidade e all_declared (ou ambos nulos) para pares de organizações e de pessoas; mesma origem/destino devolve null', async () => {
    let hits = 0, nulls = 0;
    for (const includeInferred of [false, true]) {
      for (let i = 0; i < 25; i++) {
        for (const [type, ids] of [['organization', orgIds], ['person', personIds]] as const) {
          const a = { type, id: ids[(i * 7) % ids.length]! };
          const b = { type, id: ids[(i * 13 + 5) % ids.length]! };
          const fast = await sp(db, a, b, { asOf: AS_OF, includeInferred });
          const ref = await shortestPathRecursive(db, a, b, { asOf: AS_OF, includeInferred });
          if (!ref) { expect(fast, `${type}#${i}`).toBeNull(); nulls++; continue; }
          expect(fast, `${type}#${i}`).not.toBeNull();
          expect([fast!.depth, fast!.all_declared]).toEqual([ref.depth, ref.all_declared]);
          expect(fast!.edge_ids).toHaveLength(fast!.depth);
          hits++;
        }
      }
    }
    expect(hits).toBeGreaterThan(10);
    expect(nulls).toBeGreaterThan(0);
    const same = { type: 'organization' as const, id: orgIds[0]! };
    expect(await sp(db, same, same, { asOf: AS_OF })).toBeNull();
    expect(await shortestPathRecursive(db, same, same, { asOf: AS_OF })).toBeNull();
  });

  it('respeita maxHops (1 e 2) e o teto de 3', async () => {
    const from = { type: 'organization' as const, id: orgIds[3]! };
    for (const maxHops of [1, 2, 3, 99]) {
      const fast = await nb(db, from, { asOf: AS_OF, maxHops });
      const ref = await neighborsRecursive(db, from, { asOf: AS_OF, maxHops });
      expect(new Set(fast.map(sig))).toEqual(new Set(ref.map(sig)));
      expect(Math.max(0, ...fast.map((r) => r.depth))).toBeLessThanOrEqual(Math.min(maxHops, 3));
    }
  });

  it('número de idas ao banco: consulta única = 1; em lote ≤ 3', async () => {
    let calls = 0;
    const counting: Db = { query: async (sql, params) => { calls++; return db.query(sql, params); } };
    await nb(counting, { type: 'organization', id: orgIds[5]! }, { asOf: AS_OF });
    await sp(counting, { type: 'organization', id: orgIds[5]! }, { type: 'organization', id: orgIds[9]! }, { asOf: AS_OF });
    expect(calls).toBeLessThanOrEqual(nb === neighbors ? 2 : 6);
    if (nb === neighbors) expect(calls).toBe(2); // 1 por chamada
  });
});
