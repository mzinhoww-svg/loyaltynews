import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../src/db.ts';
import {
  addOrgChartEdge, addOrgRelation, addRole, createWatchlist, currentPeopleAt, exportPersonData, generateAlerts, listAlerts, listMoves,
  neighbors, openSubjectRequest, processObservation, resolveOrCreatePerson, shortestPath, sharedHistory, suppressPerson, upsertOrganization,
  watch, getRoleHistory, MAX_HOPS, PersonSuppressedError,
} from '../src/index.ts';
import { MOCK_ORGS, MOCK_PEOPLE } from '../fixtures/mock-entities.ts';
import { ev, newDb } from './helpers.ts';

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const T = '2026-11-01T00:00:00Z';

/**
 * Grafo MOCK:  ana —(CEO)— alfa —parent_of→ beta —partner_of→ gama —partner_of→ delta
 *              bruno —(CRM)— beta ;  carla —(Dados)— delta ; ana —superior_of→ bruno? (declarada em alfa? não: só inferida)
 */
async function seed() {
  const e = await ev(db, 'graph');
  const org = async (n: string) => upsertOrganization(db, { legalName: n, evidenceId: e, observedAt: T });
  const alfa = await org(MOCK_ORGS.alfa), beta = await org(MOCK_ORGS.beta), gama = await org(MOCK_ORGS.gama), delta = await org(MOCK_ORGS.delta);
  const person = async (n: string, o: string) => (await resolveOrCreatePerson(db, { fullName: n, organizationId: o, evidenceId: e, observedAt: T })).id;
  const ana = await person(MOCK_PEOPLE.ana.name, alfa), bruno = await person(MOCK_PEOPLE.bruno.name, beta), carla = await person(MOCK_PEOPLE.carla.name, delta);
  const rAna = await addRole(db, { personId: ana, organizationId: alfa, title: 'CEO', validFrom: '2024-01-01', evidenceId: e, observedAt: T });
  const rBruno = await addRole(db, { personId: bruno, organizationId: beta, title: 'Diretor de CRM', validFrom: '2025-01-01', evidenceId: e, observedAt: T });
  await addRole(db, { personId: carla, organizationId: delta, title: 'Gerente de Dados', validFrom: '2025-01-01', evidenceId: e, observedAt: T });
  const rel = (from: string, to: string, type: 'parent_of' | 'partner_of') => addOrgRelation(db, { fromOrgId: from, toOrgId: to, type, validFrom: '2025-01-01', evidenceId: e, observedAt: T });
  await rel(alfa, beta, 'parent_of');
  await rel(beta, gama, 'partner_of');
  await rel(gama, delta, 'partner_of');
  return { e, alfa, beta, gama, delta, ana, bruno, carla, rAna, rBruno };
}

describe('knowledge graph em SQL (consultas de caminho ≤ 3 saltos)', () => {
  it('limita a 3 saltos: alcança até 3, não 4; maxHops maior que 3 é truncado', async () => {
    const s = await seed();
    const n = await neighbors(db, { type: 'person', id: s.ana }, { asOf: '2026-11-22', maxHops: 99 });
    const byId = new Map(n.map((x) => [x.node_id, x]));
    expect(MAX_HOPS).toBe(3);
    expect(byId.get(s.alfa)!.depth).toBe(1);
    expect(byId.get(s.beta)!.depth).toBe(2);
    expect(byId.get(s.bruno)!.depth).toBe(3); // ana→alfa→beta→bruno
    expect(byId.get(s.gama)!.depth).toBe(3);
    expect(byId.has(s.delta)).toBe(false); // 4 saltos
    expect(byId.has(s.carla)).toBe(false);
  });

  it('menor caminho com evidências; sem caminho dentro do limite devolve null', async () => {
    const s = await seed();
    const p = await shortestPath(db, { type: 'person', id: s.ana }, { type: 'person', id: s.bruno }, { asOf: '2026-11-22' });
    expect(p!.depth).toBe(3);
    expect(p!.all_declared).toBe(true);
    expect(p!.edge_ids).toHaveLength(3);
    expect(await shortestPath(db, { type: 'person', id: s.ana }, { type: 'person', id: s.carla }, { asOf: '2026-11-22' })).toBeNull(); // 5 saltos
  });

  it('é temporal: relação ainda não vigente (ou já encerrada) não conecta', async () => {
    const s = await seed();
    const before = await shortestPath(db, { type: 'organization', id: s.alfa }, { type: 'organization', id: s.beta }, { asOf: '2024-06-01' });
    expect(before).toBeNull();
    await db.query(`UPDATE intelligence.org_relation SET valid_to='2026-06-30' WHERE from_org_id=$1`, [s.alfa]);
    expect(await shortestPath(db, { type: 'organization', id: s.alfa }, { type: 'organization', id: s.beta }, { asOf: '2026-11-22' })).toBeNull();
    expect(await shortestPath(db, { type: 'organization', id: s.alfa }, { type: 'organization', id: s.beta }, { asOf: '2026-05-01' })).not.toBeNull();
  });

  it('aresta inferida fica fora por padrão; quando incluída, o caminho é marcado como não declarado', async () => {
    const s = await seed();
    await addOrgChartEdge(db, {
      organizationId: s.beta, superiorRoleId: s.rAna, subordinateRoleId: s.rBruno, validFrom: '2025-01-01', certainty: 'inferred',
      inferenceBasis: 'presumido pelo grupo', evidenceId: s.e, observedAt: T,
    });
    const asOf = '2026-11-22';
    const direct = await shortestPath(db, { type: 'person', id: s.ana }, { type: 'person', id: s.bruno }, { asOf, includeInferred: false });
    expect(direct!.depth).toBe(3); // não usa o atalho presumido
    const withInf = await shortestPath(db, { type: 'person', id: s.ana }, { type: 'person', id: s.bruno }, { asOf, includeInferred: true });
    expect(withInf!.depth).toBe(1);
    expect(withInf!.all_declared).toBe(false); // nunca exibir como fato
  });

  it('pessoa suprimida some do grafo', async () => {
    const s = await seed();
    const req = await openSubjectRequest(db, s.bruno, 'suppression');
    await suppressPerson(db, req, s.bruno, 'mock-reviewer');
    const n = await neighbors(db, { type: 'organization', id: s.beta }, { asOf: '2026-11-22' });
    expect(n.some((x) => x.node_id === s.bruno)).toBe(false);
  });

  it('desempenho: 3 saltos num grafo gerado de ~5 mil arestas (smoke; limite oficial é de R5-05)', async () => {
    const s = await seed();
    // MOCK: 1.000 organizações em cadeia ramificada + relações; apenas para detectar regressão grosseira.
    await db.query(
      `INSERT INTO intelligence.organization (legal_name, normalized_name, evidence_id, observed_at)
       SELECT 'MOCK Org '||g, 'mock org '||g, $1, now() FROM generate_series(1,1000) g`,
      [s.e],
    );
    await db.query(
      `INSERT INTO intelligence.org_relation (from_org_id,to_org_id,relation_type,valid_from,evidence_id,observed_at,validated_at)
       SELECT a.id, b.id, 'partner_of', '2025-01-01', $1, now(), now()
         FROM (SELECT id, row_number() over (order by normalized_name) rn FROM intelligence.organization WHERE normalized_name LIKE 'mock org %') a
         JOIN (SELECT id, row_number() over (order by normalized_name) rn FROM intelligence.organization WHERE normalized_name LIKE 'mock org %') b
           ON b.rn IN (a.rn + 1, a.rn + 7, a.rn + 13, a.rn + 101, a.rn + 211)`,
      [s.e],
    );
    const cnt = await db.query<{ n: string }>(`SELECT count(*)::text n FROM intelligence.org_relation`);
    expect(Number(cnt.rows[0]!.n)).toBeGreaterThan(4000);
    const start = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization WHERE normalized_name='mock org 1'`)).rows[0]!.id;
    const t0 = performance.now();
    const n = await neighbors(db, { type: 'organization', id: start }, { asOf: '2026-11-22' });
    const ms = performance.now() - t0;
    expect(n.length).toBeGreaterThan(0);
    expect(Math.max(...n.map((x) => x.depth))).toBeLessThanOrEqual(3);
    console.log(`[perf smoke] neighbors 3 saltos: ${n.length} entidades em ${ms.toFixed(0)} ms (WASM em memória; não é medição de produção)`);
  });
});

describe('consultas de vigência e histórico', () => {
  it('currentPeopleAt respeita vigência', async () => {
    const s = await seed();
    expect((await currentPeopleAt(db, s.alfa, '2026-11-22')).map((p) => p.full_name)).toEqual([MOCK_PEOPLE.ana.name]);
    expect(await currentPeopleAt(db, s.alfa, '2023-01-01')).toEqual([]);
  });

  it('sharedHistory encontra sobreposição de cargos declarados na mesma organização', async () => {
    const s = await seed();
    const e = s.e;
    await addRole(db, { personId: s.carla, organizationId: s.alfa, title: 'Gerente', validFrom: '2024-06-01', validTo: '2025-01-01', evidenceId: e, observedAt: T });
    const r = await sharedHistory(db, s.ana);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ other_name: MOCK_PEOPLE.carla.name, overlap_from: '2024-06-01', overlap_to: '2025-01-01' });
  });
});

describe('pedido de titular (supressão)', () => {
  it('suprime: some de consultas, Moves e alertas; alertas pendentes são rejeitados; itens de watchlist de pessoa removidos', async () => {
    const e = await ev(db, 'dsr');
    const mk = (title: string, at: string, slug: string) => ({
      personName: MOCK_PEOPLE.ana.name, publicProfileUrl: MOCK_PEOPLE.ana.profile, orgName: MOCK_ORGS.alfa, title, kind: 'present' as const, evidenceId: e, observedAt: at,
    });
    await processObservation(db, mk('Diretora', '2026-10-01T00:00:00Z', 'a'));
    const r = await processObservation(db, mk('CMO', '2026-11-01T00:00:00Z', 'b'));
    if (r.outcome !== 'move') throw new Error('esperado move');
    const wl = await createWatchlist(db, 'MOCK', 'mock-owner');
    await watch(db, wl, 'person', r.personId);
    await generateAlerts(db);
    expect(await listAlerts(db, { status: 'pending_review' })).toHaveLength(1);

    const before = await exportPersonData(db, r.personId);
    expect(before.person).not.toBeNull();
    expect(before.roles).toHaveLength(2);

    const req = await openSubjectRequest(db, r.personId, 'suppression', 'MOCK pedido');
    await suppressPerson(db, req, r.personId, 'mock-reviewer');

    expect(await listMoves(db)).toHaveLength(0);
    expect(await listAlerts(db, { status: 'pending_review' })).toHaveLength(0);
    expect(await getRoleHistory(db, r.personId)).toEqual([]);
    expect((await exportPersonData(db, r.personId)).person).toBeNull();
    const reqRow = await db.query<{ status: string }>(`SELECT status FROM intelligence.data_subject_request WHERE id=$1`, [req]);
    expect(reqRow.rows[0]!.status).toBe('done');
    const wi = await db.query(`SELECT 1 FROM intelligence.watchlist_item WHERE entity_type='person'`);
    expect(wi.rows).toHaveLength(0);
    // reingestão da mesma pessoa pública não ressuscita o registro suprimido como pessoa visível
    await expect(resolveOrCreatePerson(db, { fullName: MOCK_PEOPLE.ana.name, publicProfileUrl: MOCK_PEOPLE.ana.profile, evidenceId: e, observedAt: T })).rejects.toBeInstanceOf(PersonSuppressedError);
    // sem URL, mas mesma organização e nome: também bloqueado
    const sameOrg = await processObservation(db, mk('CMO', '2026-11-20T00:00:00Z', 'c'));
    expect(sameOrg).toEqual({ outcome: 'ignored', reason: 'subject_suppressed' });
    const noUrl = await processObservation(db, { ...mk('CMO', '2026-11-20T00:00:00Z', 'd'), publicProfileUrl: undefined });
    expect(noUrl).toEqual({ outcome: 'ignored', reason: 'subject_suppressed' });
    expect((await db.query(`SELECT 1 FROM intelligence.person WHERE normalized_name='mock ana exemplo'`)).rows).toHaveLength(1);
  });
});
