/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON dos handlers são validados pelos schemas zod do contrato */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AddWatchlistItemInput, AlertView, CreateWatchlistInput, GraphNeighborsQuery, GraphNeighborsResponse, GraphPathQuery, GraphPathResponse,
  ListAlertsQuery, OrgChartQuery, OrgChartResponse, ReviewAlertInput, ReviewMoveInput, WatchlistItemView, WatchlistSummary,
} from '@ln/contracts';
import type { Db } from '../db';
import {
  INGEST_SCHEMA_VERSION, addOrgChartEdge, addRole, addWatchlistItemHandler, createWatchlistHandler, generateAlerts, getOrgChartHandler,
  getWatchlistHandler, graphNeighborsHandler, graphPathHandler, listAlertsHandler, listMovesHandler, listWatchlistsHandler,
  reviewAlertHandler, reviewMoveHandler, studioAlertQueue, studioOrgChart, studioWatchlistBoard, upsertOrganization,
} from '../index';
import { MOCK_ORGS, MOCK_PEOPLE } from '../../fixtures/mock-entities';
import { ev, ib, newDb, rp } from './helpers';

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

/** O contrato valida o JSON serializado (datas viram string ISO). */
const wire = <T>(x: T): unknown => JSON.parse(JSON.stringify(x));
const body = (r: { body: unknown }) => wire(r.body) as any;

const batch = (name: string, profile: string, title: string, at: string) => ({
  schemaVersion: INGEST_SCHEMA_VERSION,
  evidence: { sourceUrl: `https://mock.invalid/${encodeURIComponent(name)}/${at}`, sourceName: 'MOCK fonte', retrievedAt: at, isMock: true },
  observations: [{ personName: name, publicProfileUrl: profile, orgName: MOCK_ORGS.alfa, title, kind: 'present' as const, observedAt: at }],
});

async function seed() {
  await ib(db, batch(MOCK_PEOPLE.ana.name, MOCK_PEOPLE.ana.profile, 'Gerente', '2026-10-01T10:00:00Z'));
  await ib(db, batch(MOCK_PEOPLE.ana.name, MOCK_PEOPLE.ana.profile, 'Diretora', '2026-11-05T10:00:00Z')); // Move
  await ib(db, batch(MOCK_PEOPLE.bruno.name, MOCK_PEOPLE.bruno.profile, 'CEO', '2026-10-01T10:00:00Z'));
  const e = await ev(db, 'chart');
  const alfa = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization LIMIT 1`)).rows[0]!.id;
  const beta = await upsertOrganization(db, { legalName: MOCK_ORGS.beta, evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
  const people = (await db.query<{ id: string; full_name: string }>(`SELECT id, full_name FROM intelligence.person`)).rows;
  const ana = people.find((p) => p.full_name === MOCK_PEOPLE.ana.name)!.id;
  const bruno = people.find((p) => p.full_name === MOCK_PEOPLE.bruno.name)!.id;
  const roles = (await db.query<{ id: string; person_id: string }>(`SELECT id, person_id FROM intelligence.role_assignment WHERE valid_to IS NULL`)).rows;
  const rAna = roles.find((r) => r.person_id === ana)!.id, rBruno = roles.find((r) => r.person_id === bruno)!.id;
  await addOrgChartEdge(db, { organizationId: alfa, superiorRoleId: rBruno, subordinateRoleId: rAna, validFrom: '2026-11-01', certainty: 'declared', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
  // terceira pessoa com vínculo apenas inferido
  // diego trabalha em OUTRA empresa: só o vínculo inferido com Ana o liga ao restante do grafo
  const diego = (await rp(db, { fullName: MOCK_PEOPLE.diego.name, organizationId: beta, evidenceId: e, observedAt: '2026-11-01T00:00:00Z' })).id;
  const rDiego = await addRole(db, { personId: diego, organizationId: beta, title: 'Analista', validFrom: '2026-11-01', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
  await addOrgChartEdge(db, { organizationId: alfa, superiorRoleId: rAna, subordinateRoleId: rDiego, validFrom: '2026-11-01', certainty: 'inferred', inferenceBasis: 'MOCK base', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
  return { alfa, beta, ana, bruno, diego };
}

describe('watchlists e alertas conformam com @ln/contracts', () => {
  it('entradas aceitas pelos handlers são aceitas pelos schemas e vice-versa; saídas validam', async () => {
    const s = await seed();
    expect(CreateWatchlistInput.safeParse({ name: 'MOCK acompanhadas' }).success).toBe(true);
    expect(CreateWatchlistInput.safeParse({ name: '  ' }).success).toBe(false);
    const w = await createWatchlistHandler(db, 'mock-editor', { name: 'MOCK acompanhadas' });
    expect(w.status).toBe(201);
    const wid = body(w).id as string;

    const add = { watchlistId: wid, entityType: 'organization' as const, entityId: s.alfa };
    expect(AddWatchlistItemInput.safeParse(add).success).toBe(true);
    const added = body(await addWatchlistItemHandler(db, add));
    for (const i of added.items) expect(WatchlistItemView.parse(i)).toBeTruthy();
    const addPerson = body(await addWatchlistItemHandler(db, { watchlistId: wid, entityType: 'person', entityId: s.ana }));
    expect(addPerson.items).toHaveLength(2);
    for (const i of addPerson.items) expect(WatchlistItemView.parse(i)).toBeTruthy();

    const lists = body(await listWatchlistsHandler(db, {}));
    for (const l of lists.items) expect(WatchlistSummary.parse(l)).toBeTruthy();
    const one = body(await getWatchlistHandler(db, { id: wid }));
    expect(WatchlistSummary.parse(one.watchlist)).toBeTruthy();
    for (const l of (await studioWatchlistBoard(db)).map(wire) as any[]) {
      expect(WatchlistSummary.parse({ id: l.id, name: l.name, owner_ref: l.owner_ref, items: l.items, pending_alerts: l.pending_alerts })).toBeTruthy();
      for (const e of l.entities) expect(WatchlistItemView.parse(e)).toBeTruthy();
    }

    await generateAlerts(db);
    const q = { status: 'pending_review' as const, watchlistId: wid };
    expect(ListAlertsQuery.safeParse(q).success).toBe(true);
    const alerts = body(await listAlertsHandler(db, q));
    expect(alerts.items.length).toBeGreaterThan(0);
    for (const a of alerts.items) expect(AlertView.parse(a).status).toBe('pending_review');
    for (const a of wire((await studioAlertQueue(db)).pending) as any[]) expect(AlertView.parse(a)).toBeTruthy();

    const rv = { id: alerts.items[0].id, status: 'approved' as const };
    expect(ReviewAlertInput.safeParse(rv).success).toBe(true);
    expect((await reviewAlertHandler(db, 'mock-reviewer', rv)).status).toBe(200);
    const approved = body(await listAlertsHandler(db, { status: 'approved' }));
    expect(AlertView.parse(approved.items[0])).toMatchObject({ status: 'approved', reviewed_by: 'mock-reviewer' });
  });

  it('revisão de Move: entrada do contrato e regra "só a partir de detected"', async () => {
    await seed();
    const pend = body(await listMovesHandler(db, 'studio', { status: 'detected' })).items[0];
    const input = { id: pend.id, status: 'confirmed' as const };
    expect(ReviewMoveInput.safeParse(input).success).toBe(true);
    expect(ReviewMoveInput.safeParse({ id: pend.id, status: 'detected' }).success).toBe(false);
    expect((await reviewMoveHandler(db, 'mock-editor', input)).status).toBe(200);
    expect((await reviewMoveHandler(db, 'mock-editor', { id: pend.id, status: 'rejected' })).status).toBe(409);
  });
});

describe('organograma e grafo conformam com @ln/contracts', () => {
  it('organograma: portal só declarado; Studio com inferido rotulado (nunca como fato)', async () => {
    const s = await seed();
    const q = { organizationId: s.alfa, asOf: '2026-11-22', includeInferred: true };
    expect(OrgChartQuery.safeParse(q).success).toBe(true);

    const pub = OrgChartResponse.parse(body(await getOrgChartHandler(db, 'public', q)));
    expect(pub.edges.every((e) => e.certainty === 'declared')).toBe(true);

    const studio = OrgChartResponse.parse(body(await getOrgChartHandler(db, 'studio', q)));
    expect(studio.edges.map((e) => e.certainty).sort()).toEqual(['declared', 'inferred']);
    const inf = studio.edges.find((e) => e.certainty === 'inferred')!;
    expect(inf.display_label.startsWith('fato')).toBe(false);

    const view = await studioOrgChart(db, s.alfa, '2026-11-22');
    for (const e of view.edges) expect(OrgChartResponse.shape.edges.element.parse(wire(e))).toBeTruthy();
    // a refinação do contrato reprova rótulo de fato numa aresta inferida
    expect(() => OrgChartResponse.shape.edges.element.parse({ ...wire(inf) as object, display_label: 'fato (fonte declara)' })).toThrow();
  });

  it('grafo: vizinhos e caminho; profundidade coerente com o caminho; all_declared=false com inferido', async () => {
    const s = await seed();
    const q = { type: 'person' as const, id: s.bruno, asOf: '2026-11-22', includeInferred: true };
    expect(GraphNeighborsQuery.safeParse(q).success).toBe(true);
    expect(GraphNeighborsQuery.safeParse({ ...q, maxHops: 4 }).success).toBe(false);
    expect(GraphNeighborsQuery.parse({ type: 'person', id: s.bruno }).maxHops).toBe(3); // default do contrato

    const n = GraphNeighborsResponse.parse(body(await graphNeighborsHandler(db, 'studio', q)));
    expect(n.max_hops).toBe(3);
    expect(n.items.length).toBeGreaterThan(0);
    expect(n.items.some((i) => i.node_id === s.diego && !i.all_declared)).toBe(true);
    const publicN = GraphNeighborsResponse.parse(body(await graphNeighborsHandler(db, 'public', q)));
    expect(publicN.items.every((i) => i.all_declared)).toBe(true);
    expect(publicN.items.some((i) => i.node_id === s.diego)).toBe(false);

    const pq = { from: { type: 'person' as const, id: s.bruno }, to: { type: 'person' as const, id: s.diego }, asOf: '2026-11-22', includeInferred: true };
    expect(GraphPathQuery.safeParse(pq).success).toBe(true);
    const p = GraphPathResponse.parse(body(await graphPathHandler(db, 'studio', pq)));
    expect(p.path).not.toBeNull();
    expect(p.path!.path.length).toBe(p.path!.depth + 1);
    expect(p.path!.all_declared).toBe(false);
    const none = GraphPathResponse.parse(body(await graphPathHandler(db, 'public', pq)));
    expect(none.path).toBeNull();
  });
});
