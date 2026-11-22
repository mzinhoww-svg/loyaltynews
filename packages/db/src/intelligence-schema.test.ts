import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './testing';

let t: Awaited<ReturnType<typeof createTestDb>>;
const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => t.client.query<T>(sql, params);
let ev = '';
let org = '';

beforeAll(async () => {
  t = await createTestDb();
  ev = (await q<{ id: string }>(
    "INSERT INTO intelligence.evidence (source_url, source_name, source_class, retrieved_at) VALUES ('https://example.org/a', 'Fonte', 'public', now()) RETURNING id",
  )).rows[0]!.id;
  org = (await q<{ id: string }>(
    'INSERT INTO intelligence.organization (legal_name, normalized_name, evidence_id, observed_at) VALUES ($1, $2, $3, now()) RETURNING id',
    ['Empresa Alfa', 'empresa alfa', ev],
  )).rows[0]!.id;
});
afterAll(async () => {
  await t.close();
});

const person = async (name: string) =>
  (await q<{ id: string }>('INSERT INTO intelligence.person (full_name, normalized_name, evidence_id, observed_at) VALUES ($1, lower($1), $2, now()) RETURNING id', [name, ev])).rows[0]!.id;

describe('Entity Intelligence (0006_intelligence)', () => {
  it('search_path volta ao padrão depois das migrações; tabelas do produto ficam em public', async () => {
    const s = await q<{ s: string[] }>('SELECT current_schemas(false) s');
    expect(s.rows[0]!.s).not.toContain('intelligence');
    const r = await q<{ table_schema: string }>("SELECT table_schema FROM information_schema.tables WHERE table_name = 'meeting_runs'");
    expect(r.rows.map((x) => x.table_schema)).toEqual(['public']);
  });

  it('dado pessoal ampliado é recusado com a chave desligada (P4)', async () => {
    const flag = await q<{ v: boolean }>("SELECT bool_value v FROM intelligence.intel_settings WHERE key = 'extended_personal_data'");
    expect(flag.rows[0]!.v).toBe(false);
    const p = await person('Ana Teste');
    await expect(
      q("INSERT INTO intelligence.person_extended (person_id, attributes, evidence_id, observed_at) VALUES ($1, '{}'::jsonb, $2, now())", [p, ev]),
    ).rejects.toThrow(/extended_personal_data_disabled/);
  });

  it('evidência só de fonte pública', async () => {
    await expect(
      q("INSERT INTO intelligence.evidence (source_url, source_name, source_class, retrieved_at) VALUES ('https://x.org', 'X', 'private', now())"),
    ).rejects.toThrow();
  });

  it('cargo inferido exige base de inferência', async () => {
    const p = await person('Bruno Teste');
    const base = [p, org, 'Diretor', 'diretor', ev];
    await expect(
      q("INSERT INTO intelligence.role_assignment (person_id, organization_id, title, normalized_title, valid_from, certainty, evidence_id, observed_at, validated_at) VALUES ($1,$2,$3,$4,'2026-01-01','inferred',$5,now(),now())", base),
    ).rejects.toThrow();
    await q("INSERT INTO intelligence.role_assignment (person_id, organization_id, title, normalized_title, valid_from, certainty, evidence_id, observed_at, validated_at) VALUES ($1,$2,$3,$4,'2026-01-01','declared',$5,now(),now())", base);
  });

  it('pessoa suprimida some do grafo', async () => {
    const p = await person('Carla Teste');
    await q("INSERT INTO intelligence.role_assignment (person_id, organization_id, title, normalized_title, valid_from, evidence_id, observed_at, validated_at) VALUES ($1,$2,'CEO','ceo','2026-01-01',$3,now(),now())", [p, org, ev]);
    const before = await q<{ n: number }>('SELECT count(*)::int n FROM intelligence.graph_edge WHERE src_id = $1', [p]);
    expect(before.rows[0]!.n).toBe(1);
    await q('UPDATE intelligence.person SET suppressed_at = now() WHERE id = $1', [p]);
    const after = await q<{ n: number }>('SELECT count(*)::int n FROM intelligence.graph_edge WHERE src_id = $1', [p]);
    expect(after.rows[0]!.n).toBe(0);
  });

  it('tombstone guarda só hash determinístico', async () => {
    const h = await q<{ a: string; b: string }>("SELECT intelligence.tombstone_hash('name_org', 'Ana', 'Alfa') a, intelligence.tombstone_hash('name_org', 'ANA', 'alfa') b");
    expect(h.rows[0]!.a).toMatch(/^[0-9a-f]{64}$/);
    expect(h.rows[0]!.a).toBe(h.rows[0]!.b);
    await expect(q("INSERT INTO intelligence.suppression_tombstone (key_kind, key_hash) VALUES ('name_org', 'Ana Teste')")).rejects.toThrow();
  });
});
