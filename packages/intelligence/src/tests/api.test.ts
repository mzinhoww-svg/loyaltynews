/* eslint-disable @typescript-eslint/no-explicit-any -- linhas de resultado do SQL e corpos JSON de resposta são tipados na borda */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../db';
import { addOrgChartEdge, addOrgRelation, addRole, addWatchlistItemHandler, createWatchlistHandler, exportSubjectDataHandler, generateAlerts, getCompanyHandler, getExecutiveHandler, getOrgChartHandler, getWatchlistHandler, graphNeighborsHandler, graphPathHandler, INGEST_SCHEMA_VERSION, listAlertsHandler, listMovesHandler, listWatchlistsHandler, openSubjectRequestHandler, portalCompanyPage, portalExecutivePage, portalMovesFeed, rectifySubjectHandler, reviewAlertHandler, reviewMoveHandler, searchCompaniesHandler, searchExecutivesHandler, studioAlertQueue, studioEntityOverview, studioMoveQueue, studioOrgChart, studioWatchlistBoard, suppressSubjectHandler, upsertOrganization, type ApiResult } from '../index';
import { MOCK_ORGS, MOCK_PEOPLE } from '../../fixtures/mock-entities';
import { ev, newDb, rp, ib } from './helpers';

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
const T = '2026-11-01T00:00:00Z';
const body = <X = any>(r: ApiResult): X => r.body as X;
const errCode = (r: ApiResult) => (r.body as any).error?.code;

async function seed() {
  const e = await ev(db, 'api');
  const alfa = await upsertOrganization(db, { legalName: MOCK_ORGS.alfa, evidenceId: e, observedAt: T });
  const beta = await upsertOrganization(db, { legalName: MOCK_ORGS.beta, evidenceId: e, observedAt: T });
  const mk = async (n: string, o: string) => (await rp(db, { fullName: n, organizationId: o, evidenceId: e, observedAt: T })).id;
  const ana = await mk(MOCK_PEOPLE.ana.name, alfa), bruno = await mk(MOCK_PEOPLE.bruno.name, alfa);
  const rAna = await addRole(db, { personId: ana, organizationId: alfa, title: 'CEO', validFrom: '2024-01-01', evidenceId: e, observedAt: T });
  const rBruno = await addRole(db, { personId: bruno, organizationId: alfa, title: 'Diretor', validFrom: '2025-01-01', evidenceId: e, observedAt: T });
  await addOrgRelation(db, { fromOrgId: alfa, toOrgId: beta, type: 'partner_of', validFrom: '2025-01-01', evidenceId: e, observedAt: T });
  await addOrgRelation(db, { fromOrgId: beta, toOrgId: alfa, type: 'other', validFrom: '2025-01-01', certainty: 'inferred', inferenceBasis: 'presumido', evidenceId: e, observedAt: T });
  await addOrgChartEdge(db, { organizationId: alfa, superiorRoleId: rAna, subordinateRoleId: rBruno, validFrom: '2025-01-01', certainty: 'declared', evidenceId: e, observedAt: T });
  return { e, alfa, beta, ana, bruno, rAna, rBruno };
}
const moveOf = async (title2: string) => {
  const mk = (title: string, at: string) => ({
    schemaVersion: INGEST_SCHEMA_VERSION as typeof INGEST_SCHEMA_VERSION,
    evidence: { sourceUrl: `https://mock.invalid/${at}`, sourceName: 'MOCK', retrievedAt: at, isMock: true },
    observations: [{ personName: MOCK_PEOPLE.carla.name, publicProfileUrl: MOCK_PEOPLE.carla.profile, orgName: MOCK_ORGS.alfa, title, kind: 'present' as const, observedAt: at }],
  });
  await ib(db, mk('Gerente', '2026-10-01T00:00:00Z'));
  await ib(db, mk(title2, '2026-11-10T00:00:00Z'));
};

describe('handlers: consultas', () => {
  it('empresas: busca, ficha (portal sem inferidas; Studio com) e 404/400', async () => {
    const s = await seed();
    expect(body(await searchCompaniesHandler(db, { q: 'alfa' })).items).toHaveLength(1);
    expect((await searchCompaniesHandler(db, {})).status).toBe(400);
    expect(body(await searchCompaniesHandler(db, { q: '%' })).items).toHaveLength(0); // curinga escapado

    const pub = await getCompanyHandler(db, 'public', { id: s.alfa, asOf: '2026-11-22', includeInferred: true });
    expect(pub.status).toBe(200);
    expect(body(pub).relations.every((r: any) => r.certainty === 'declared')).toBe(true); // portal ignora includeInferred
    expect(body(pub).people.map((p: any) => p.full_name).sort()).toEqual([MOCK_PEOPLE.ana.name, MOCK_PEOPLE.bruno.name]);
    expect(body(pub).organization.evidence.is_mock).toBe(true);

    const studio = await getCompanyHandler(db, 'studio', { id: s.alfa, asOf: '2026-11-22', includeInferred: true });
    expect(body(studio).relations.map((r: any) => r.certainty).sort()).toEqual(['declared', 'inferred']);

    expect((await getCompanyHandler(db, 'public', { id: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect(errCode(await getCompanyHandler(db, 'public', { id: 'x' }))).toBe('invalid_input');
    expect(errCode(await getCompanyHandler(db, 'public', { id: s.alfa, asOf: '22/11/2026' }))).toBe('invalid_input');
  });

  it('executivo: só nome, cargos e empresas; suprimido = 404', async () => {
    const s = await seed();
    expect(body(await searchExecutivesHandler(db, { q: 'ana' })).items).toHaveLength(1);
    const r = await getExecutiveHandler(db, 'public', { id: s.ana });
    expect(Object.keys(body(r).person).sort()).toEqual(['evidence', 'full_name', 'id', 'public_profile_url']);
    expect(body(r).roles[0]).toMatchObject({ title: 'CEO', organization: MOCK_ORGS.alfa, certainty: 'declared' });
    expect(body(r).roles[0].evidence.source_url).toMatch(/^https?:\/\//);
    await db.query(`UPDATE intelligence.person SET suppressed_at = now() WHERE id = $1`, [s.ana]);
    expect((await getExecutiveHandler(db, 'studio', { id: s.ana })).status).toBe(404);
    expect(body(await searchExecutivesHandler(db, { q: 'ana' })).items).toHaveLength(0);
  });

  it('organograma com grau de certeza e rótulo', async () => {
    const s = await seed();
    const e2 = await ev(db, 'inf');
    const p = await rp(db, { fullName: MOCK_PEOPLE.diego.name, organizationId: s.alfa, evidenceId: e2, observedAt: T });
    const rD = await addRole(db, { personId: p.id, organizationId: s.alfa, title: 'Gerente', validFrom: '2025-06-01', evidenceId: e2, observedAt: T });
    await addOrgChartEdge(db, { organizationId: s.alfa, superiorRoleId: s.rBruno, subordinateRoleId: rD, validFrom: '2025-06-01', certainty: 'inferred', inferenceBasis: 'MOCK base', evidenceId: e2, observedAt: T });
    const pub = body(await getOrgChartHandler(db, 'public', { organizationId: s.alfa, asOf: '2026-11-22', includeInferred: true }));
    expect(pub.edges.map((x: any) => x.certainty)).toEqual(['declared']);
    const studio = body(await getOrgChartHandler(db, 'studio', { organizationId: s.alfa, asOf: '2026-11-22', includeInferred: true }));
    expect(studio.edges).toHaveLength(2);
    expect(studio.edges.find((x: any) => x.certainty === 'inferred').display_label).toMatch(/inferido/);
  });

  it('grafo: vizinhos e caminho validam entrada e respeitam 3 saltos', async () => {
    const s = await seed();
    const n = body(await graphNeighborsHandler(db, 'public', { type: 'person', id: s.ana, asOf: '2026-11-22', maxHops: 50 }));
    expect(n.max_hops).toBe(3);
    expect(n.items.map((x: any) => x.node_id)).toContain(s.alfa);
    expect((await graphNeighborsHandler(db, 'public', { type: 'robot', id: s.ana })).status).toBe(400);
    const p = body(await graphPathHandler(db, 'public', { from: { type: 'person', id: s.ana }, to: { type: 'person', id: s.bruno }, asOf: '2026-11-22' }));
    expect(p.path.depth).toBeLessThanOrEqual(3);
    expect((await graphPathHandler(db, 'public', { from: { type: 'person' }, to: {} })).status).toBe(400);
  });
});

describe('handlers: Moves, watchlists, alertas, titular', () => {
  it('Moves: portal só vê confirmados; Studio vê pendentes; revisão exige ator e só vale uma vez', async () => {
    await moveOf('Diretora');
    expect(body(await listMovesHandler(db, 'public', {})).items).toHaveLength(0);
    expect(body(await listMovesHandler(db, 'public', { status: 'detected' })).items).toHaveLength(0); // portal ignora o filtro
    const pend = body(await listMovesHandler(db, 'studio', { status: 'detected' })).items;
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ kind: 'title_change', from_title: 'Gerente', to_title: 'Diretora', basis: 'observed_diff' });

    expect((await reviewMoveHandler(db, ' ', { id: pend[0].id, status: 'confirmed' })).status).toBe(401);
    expect((await reviewMoveHandler(db, 'mock-editor', { id: pend[0].id, status: 'maybe' })).status).toBe(400);
    expect((await reviewMoveHandler(db, 'mock-editor', { id: pend[0].id, status: 'confirmed' })).status).toBe(200);
    expect((await reviewMoveHandler(db, 'mock-editor', { id: pend[0].id, status: 'rejected' })).status).toBe(409);
    expect(body(await listMovesHandler(db, 'public', {})).items).toHaveLength(1);
    expect((await listMovesHandler(db, 'studio', { status: 'zzz' })).status).toBe(400);
  });

  it('watchlist → alerta → revisão, tudo por handlers', async () => {
    const s = await seed();
    await moveOf('Diretora');
    const w = await createWatchlistHandler(db, 'mock-editor', { name: 'MOCK acompanhadas' });
    expect(w.status).toBe(201);
    const wid = body(w).id;
    expect((await createWatchlistHandler(db, '', { name: 'x' })).status).toBe(401);
    expect((await addWatchlistItemHandler(db, { watchlistId: wid, entityType: 'organization', entityId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await addWatchlistItemHandler(db, { watchlistId: wid, entityType: 'organization', entityId: s.alfa })).status).toBe(201);
    expect(body(await getWatchlistHandler(db, { id: wid })).items).toHaveLength(1);
    expect(body(await listWatchlistsHandler(db, { ownerRef: 'mock-editor' })).items[0]).toMatchObject({ items: 1, pending_alerts: 0 });

    await generateAlerts(db);
    const pend = body(await listAlertsHandler(db, { status: 'pending_review' })).items;
    expect(pend).toHaveLength(1);
    expect((await reviewAlertHandler(db, '', { id: pend[0].id, status: 'approved' })).status).toBe(401);
    expect((await reviewAlertHandler(db, 'mock-reviewer', { id: pend[0].id, status: 'approved' })).status).toBe(200);
    expect((await reviewAlertHandler(db, 'mock-reviewer', { id: pend[0].id, status: 'rejected' })).status).toBe(409);
    expect((await listAlertsHandler(db, { status: 'x' })).status).toBe(400);
    expect(body(await listWatchlistsHandler(db, {})).items[0].pending_alerts).toBe(0);
  });

  it('pedido do titular: acesso, retificação e supressão com validação de tipo e estado', async () => {
    const s = await seed();
    expect((await openSubjectRequestHandler(db, 'dpo', { personId: s.ana, kind: 'delete-all' })).status).toBe(400);
    expect((await openSubjectRequestHandler(db, '', { personId: s.ana, kind: 'access' })).status).toBe(401);

    const acc = body(await openSubjectRequestHandler(db, 'dpo', { personId: s.ana, kind: 'access' })).id;
    const exp = await exportSubjectDataHandler(db, 'dpo', { requestId: acc });
    expect(body(exp).data.person.full_name).toBe(MOCK_PEOPLE.ana.name);
    expect(body(exp).data.roles).toHaveLength(1);
    expect(errCode(await suppressSubjectHandler(db, 'dpo', { requestId: acc }))).toBe('wrong_kind');

    const rect = body(await openSubjectRequestHandler(db, 'dpo', { personId: s.bruno, kind: 'rectification' })).id;
    expect((await rectifySubjectHandler(db, 'dpo', { requestId: rect, fullName: 'MOCK Bruno Corrigido' })).status).toBe(200);
    expect(body(await getExecutiveHandler(db, 'public', { id: s.bruno })).person.full_name).toBe('MOCK Bruno Corrigido');
    expect(errCode(await rectifySubjectHandler(db, 'dpo', { requestId: rect, fullName: 'Outro' }))).toBe('already_closed');

    const sup = body(await openSubjectRequestHandler(db, 'dpo', { personId: s.ana, kind: 'suppression' })).id;
    expect((await suppressSubjectHandler(db, 'dpo', { requestId: sup })).status).toBe(200);
    expect((await getExecutiveHandler(db, 'public', { id: s.ana })).status).toBe(404);
    expect(errCode(await suppressSubjectHandler(db, 'dpo', { requestId: sup }))).toBe('already_closed');
    expect((await openSubjectRequestHandler(db, 'dpo', { personId: '00000000-0000-4000-8000-000000000000', kind: 'access' })).status).toBe(404);
  });
});

describe('funções de dados das telas', () => {
  it('portal: página de empresa só com fato declarado e Move confirmado; MOCK sinalizado; estado vazio honesto', async () => {
    const s = await seed();
    await moveOf('Diretora');
    const before = await portalCompanyPage(db, s.alfa, '2026-11-22');
    expect(before!.recent_moves).toHaveLength(0); // Move ainda detectado
    expect(before!.has_mock).toBe(true);
    expect(before!.notice).toMatch(/fonte pública/);
    const pend = await studioMoveQueue(db);
    expect(pend.count).toBe(1);
    await reviewMoveHandler(db, 'mock-editor', { id: pend.pending[0]!.id, status: 'confirmed' });
    expect((await portalCompanyPage(db, s.alfa, '2026-11-22'))!.recent_moves).toHaveLength(1);
    expect((await portalMovesFeed(db)).items).toHaveLength(1);

    const e = await ev(db, 'vazia');
    const lonely = await upsertOrganization(db, { legalName: 'MOCK Vazia S.A.', evidenceId: e, observedAt: T });
    const empty = await portalCompanyPage(db, lonely, '2026-11-22');
    expect(empty).toMatchObject({ empty: true, people: [], relations: [], org_chart: [] });
    expect(await portalCompanyPage(db, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('portal: página de executivo separa cargo atual e histórico, sem campos além de nome/cargo/empresa', async () => {
    const s = await seed();
    await addRole(db, { personId: s.ana, organizationId: s.beta, title: 'Conselheira', validFrom: '2020-01-01', validTo: '2023-12-31', evidenceId: s.e, observedAt: T });
    const page = await portalExecutivePage(db, s.ana);
    expect(page!.current_roles.map((r) => r.title)).toEqual(['CEO']);
    expect(page!.history.map((r) => r.title)).toEqual(['Conselheira']);
    expect(Object.keys(page!.person).sort()).toEqual(['evidence', 'full_name', 'id']);
  });

  it('Studio: visão de entidade inclui inferidas rotuladas, fila de Moves e de alertas, quadro de watchlists, organograma completo', async () => {
    const s = await seed();
    await moveOf('Diretora');
    const org = await studioEntityOverview(db, 'organization', s.alfa, '2026-11-22');
    if (!org || org.kind !== 'organization') throw new Error('esperado organization');
    expect(org.relations.map((r) => r.certainty).sort()).toEqual(['declared', 'inferred']);
    const per = await studioEntityOverview(db, 'person', s.ana);
    if (!per || per.kind !== 'person') throw new Error('esperado person');
    expect(per.roles).toHaveLength(1);
    expect(await studioEntityOverview(db, 'person', '00000000-0000-4000-8000-000000000000')).toBeNull();

    const chart = await studioOrgChart(db, s.alfa, '2026-11-22');
    expect(chart).toMatchObject({ declared: 1, inferred: 0 });

    const w = body(await createWatchlistHandler(db, 'mock-editor', { name: 'MOCK' })).id;
    await addWatchlistItemHandler(db, { watchlistId: w, entityType: 'organization', entityId: s.alfa });
    await generateAlerts(db);
    const board = await studioWatchlistBoard(db, 'mock-editor');
    expect(board[0]).toMatchObject({ items: 1, pending_alerts: 1 });
    expect(board[0]!.entities[0]!.name).toBe(MOCK_ORGS.alfa);
    expect((await studioAlertQueue(db)).count).toBe(1);
  });
});
