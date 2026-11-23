import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../db';
import {
  addWatchlistItemHandler, createWatchlistHandler, deleteWatchlistHandler, generateAlerts, getWatchlistHandler, listAlertsHandler, listWatchlistsHandler,
  removeWatchlistItemHandler, reviewAlertHandler, reviewMoveHandler, upsertOrganization,
} from '../index';
import { MOCK_ORGS, MOCK_PEOPLE } from '../../fixtures/mock-entities';
import { ev, newDb, po } from './helpers';

// Contrato da API de watchlists que o Frontend 2 consome (WATCHLISTS_API.md): formas EXATAS das respostas e regras de dono.
let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- corpos JSON de resposta, tipados na borda do teste
type B = Record<string, any>;
const body = (r: { body: unknown }) => r.body as B;
const keys = (o: object) => Object.keys(o).sort();

async function setup() {
  const e0 = await ev(db, 'org0', '2026-10-01T00:00:00Z');
  const org = await upsertOrganization(db, { legalName: MOCK_ORGS.alfa, evidenceId: e0, observedAt: '2026-10-01T00:00:00Z' });
  const base = { personName: MOCK_PEOPLE.ana.name, publicProfileUrl: MOCK_PEOPLE.ana.profile, orgName: MOCK_ORGS.alfa, kind: 'present' as const };
  await po(db, { ...base, title: 'Diretora de Marketing', evidenceId: await ev(db, 'a1', '2026-10-02T00:00:00Z'), observedAt: '2026-10-02T00:00:00Z' });
  const r = await po(db, { ...base, title: 'Diretora de CRM', evidenceId: await ev(db, 'a2', '2026-11-05T00:00:00Z'), observedAt: '2026-11-05T00:00:00Z' });
  if (r.outcome !== 'move') throw new Error('esperava move');
  const person = r.personId;
  return { org, person, move: r.move.id };
}

describe('API de watchlists — contrato para o Frontend 2', () => {
  it('criar, listar, ler e alterar: formas exatas e só o dono altera (não-dono recebe 404, sem revelar a lista)', async () => {
    const s = await setup();
    const c = await createWatchlistHandler(db, 'ana@editor', { name: '  MOCK Clientes  ' });
    expect(c.status).toBe(201);
    expect(keys(body(c))).toEqual(['id']);
    const id = body(c).id as string;
    expect((await createWatchlistHandler(db, 'ana@editor', { name: '' })).status).toBe(400);
    expect((await createWatchlistHandler(db, '', { name: 'x' })).status).toBe(401);

    const list = body(await listWatchlistsHandler(db, { ownerRef: 'ana@editor' }));
    expect(keys(list)).toEqual(['items']);
    expect(keys(list.items[0])).toEqual(['id', 'items', 'name', 'owner_ref', 'pending_alerts']);
    expect(list.items[0]).toMatchObject({ name: 'MOCK Clientes', owner_ref: 'ana@editor', items: 0, pending_alerts: 0 });
    expect(body(await listWatchlistsHandler(db, { ownerRef: 'outra@pessoa' })).items).toHaveLength(0);

    const add = await addWatchlistItemHandler(db, { watchlistId: id, entityType: 'organization', entityId: s.org }, 'ana@editor');
    expect(add.status).toBe(201);
    expect(keys(body(add))).toEqual(['items', 'watchlistId']);
    expect(keys(body(add).items[0])).toEqual(['entity_id', 'entity_type', 'name']);
    expect((await addWatchlistItemHandler(db, { watchlistId: id, entityType: 'person', entityId: s.person }, 'ana@editor')).status).toBe(201);
    expect((await addWatchlistItemHandler(db, { watchlistId: id, entityType: 'person', entityId: s.person }, 'ana@editor')).status).toBe(201); // idempotente
    expect(body(await getWatchlistHandler(db, { id }, 'ana@editor')).items).toHaveLength(2);
    expect(keys(body(await getWatchlistHandler(db, { id }, 'ana@editor')))).toEqual(['items', 'watchlist']);

    // não-dono: 404 em ler, adicionar, remover, apagar
    expect((await getWatchlistHandler(db, { id }, 'outra@pessoa')).status).toBe(404);
    expect((await addWatchlistItemHandler(db, { watchlistId: id, entityType: 'organization', entityId: s.org }, 'outra@pessoa')).status).toBe(404);
    expect((await removeWatchlistItemHandler(db, 'outra@pessoa', { watchlistId: id, entityType: 'organization', entityId: s.org })).status).toBe(404);
    expect((await deleteWatchlistHandler(db, 'outra@pessoa', { id })).status).toBe(404);

    const rm = await removeWatchlistItemHandler(db, 'ana@editor', { watchlistId: id, entityType: 'person', entityId: s.person });
    expect(rm.status).toBe(200);
    expect(body(rm).items).toHaveLength(1);
    expect((await removeWatchlistItemHandler(db, 'ana@editor', { watchlistId: id, entityType: 'person', entityId: s.person })).status).toBe(404);
    expect((await removeWatchlistItemHandler(db, 'ana@editor', { watchlistId: id, entityType: 'x', entityId: s.person })).status).toBe(400);

    const del = await deleteWatchlistHandler(db, 'ana@editor', { id });
    expect(del.status).toBe(200);
    expect(body(del)).toEqual({ id, deleted: true });
    expect((await getWatchlistHandler(db, { id }, 'ana@editor')).status).toBe(404);
  });

  it('alertas: nascem pendentes, trazem o Move com antes/depois, e só viram aprovados por revisão com identidade', async () => {
    const s = await setup();
    const id = body(await createWatchlistHandler(db, 'ana@editor', { name: 'MOCK' })).id as string;
    await addWatchlistItemHandler(db, { watchlistId: id, entityType: 'organization', entityId: s.org }, 'ana@editor');
    expect((await generateAlerts(db)).length).toBe(1);
    expect(body(await listWatchlistsHandler(db, { ownerRef: 'ana@editor' })).items[0].pending_alerts).toBe(1);

    const list = body(await listAlertsHandler(db, { status: 'pending_review', watchlistId: id }));
    expect(list.items).toHaveLength(1);
    const a = list.items[0];
    expect(keys(a)).toEqual(['basis', 'evidence_id', 'id', 'kind', 'move', 'move_id', 'observed_on', 'person_name', 'reviewed_by', 'status', 'watchlist_id']);
    expect(a).toMatchObject({ status: 'pending_review', kind: 'title_change', move_id: s.move, reviewed_by: null });
    expect(keys(a.move)).toEqual(expect.arrayContaining(['after', 'basis', 'before', 'effective_date', 'evidence', 'id', 'kind', 'observed_on', 'person_id', 'person_name', 'status']));
    expect(keys(a.move.before)).toEqual(['certainty', 'evidence', 'organization', 'role_id', 'title', 'valid_from', 'valid_to', 'validated_at']);
    expect(keys(a.move.before.evidence)).toEqual(['id', 'is_mock', 'retrieved_at', 'source_name', 'source_url']); // sem trecho da página
    expect([a.move.before.title, a.move.after.title]).toEqual(['Diretora de Marketing', 'Diretora de CRM']);

    expect((await reviewAlertHandler(db, '', { id: a.id, status: 'approved' })).status).toBe(401);
    expect((await reviewAlertHandler(db, 'rev', { id: a.id, status: 'talvez' })).status).toBe(400);
    const ok = await reviewAlertHandler(db, 'rev', { id: a.id, status: 'approved' });
    expect([ok.status, body(ok)]).toEqual([200, { id: a.id, status: 'approved', reviewed_by: 'rev' }]);
    expect((await reviewAlertHandler(db, 'rev', { id: a.id, status: 'rejected' })).status).toBe(409);
    expect(body(await listAlertsHandler(db, { status: 'approved' })).items[0]).toMatchObject({ reviewed_by: 'rev' });
    expect(body(await listWatchlistsHandler(db, {})).items[0].pending_alerts).toBe(0);
    // revisão do Move é independente da revisão do alerta
    expect((await reviewMoveHandler(db, 'rev', { id: s.move, status: 'confirmed' })).status).toBe(200);
  });
});
