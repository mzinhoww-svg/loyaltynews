/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON dos handlers são validados pelos schemas zod do contrato */
import { describe, it, expect, beforeEach } from 'vitest';
import { IntelEvidence, MoveView, OrganizationView, PersonRoleView, PersonView, RelationView, RoleObservation } from '@ln/contracts';
import type { Db } from '../db';
import {
  INGEST_SCHEMA_VERSION, addOrgRelation, getCompanyHandler, getExecutiveHandler, listMovesHandler, portalCompanyPage, portalExecutivePage,
  reviewMoveHandler, studioEntityOverview, studioMoveQueue, upsertOrganization,
} from '../index';
import { MOCK_ORGS, MOCK_PEOPLE } from '../../fixtures/mock-entities';
import { ev, ib, newDb } from './helpers';

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

const T = '2026-11-01T00:00:00Z';
const batch = (title: string, at: string) => ({
  schemaVersion: INGEST_SCHEMA_VERSION,
  evidence: { sourceUrl: `https://mock.invalid/${at}`, sourceName: 'MOCK fonte', retrievedAt: at, isMock: true },
  observations: [{ personName: MOCK_PEOPLE.ana.name, publicProfileUrl: MOCK_PEOPLE.ana.profile, orgName: MOCK_ORGS.alfa, title, kind: 'present' as const, observedAt: at }],
});

async function seed() {
  await ib(db, batch('Gerente', '2026-10-01T10:00:00Z'));
  await ib(db, batch('Diretora', '2026-11-05T10:00:00Z')); // gera um Move
  const e = await ev(db, 'rel');
  const alfa = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization LIMIT 1`)).rows[0]!.id;
  const beta = await upsertOrganization(db, { legalName: MOCK_ORGS.beta, evidenceId: e, observedAt: T });
  await addOrgRelation(db, { fromOrgId: alfa, toOrgId: beta, type: 'partner_of', validFrom: '2025-01-01', evidenceId: e, observedAt: T });
  const ana = (await db.query<{ id: string }>(`SELECT id FROM intelligence.person LIMIT 1`)).rows[0]!.id;
  return { alfa, beta, ana };
}

describe('saídas dos handlers e das views conformam com os schemas de @ln/contracts', () => {
  it('empresa (OrganizationView, RelationView, IntelEvidence)', async () => {
    const s = await seed();
    for (const audience of ['public', 'studio'] as const) {
      const body = (await getCompanyHandler(db, audience, { id: s.alfa, asOf: '2026-11-22' })).body as any;
      expect(OrganizationView.parse(body.organization)).toBeTruthy();
      expect(body.relations.length).toBe(1);
      for (const r of body.relations) expect(RelationView.parse(r)).toBeTruthy();
      expect(IntelEvidence.parse(body.organization.evidence).is_mock).toBe(true);
    }
  });

  it('executivo (PersonView estrito e PersonRoleView) — nada além de nome, cargo e empresa', async () => {
    const s = await seed();
    const body = (await getExecutiveHandler(db, 'public', { id: s.ana })).body as any;
    expect(PersonView.parse(body.person)).toBeTruthy(); // strictObject: campo extra reprovaria
    expect(body.roles.length).toBe(2);
    for (const r of body.roles) expect(PersonRoleView.parse(r)).toBeTruthy();
    expect(() => PersonView.parse({ ...body.person, email: 'x@y.invalid' })).toThrow();
  });

  it('Moves (MoveView) no handler, na fila do Studio e no portal', async () => {
    const s = await seed();
    const studio = (await listMovesHandler(db, 'studio', {})).body as any;
    expect(studio.items.length).toBe(1);
    for (const m of studio.items) expect(MoveView.parse(m)).toBeTruthy();
    const q = await studioMoveQueue(db);
    expect(MoveView.parse(q.pending[0])).toBeTruthy();
    await reviewMoveHandler(db, 'mock-editor', { id: q.pending[0]!.id, status: 'confirmed' });
    const page = await portalCompanyPage(db, s.alfa, '2026-11-22');
    expect(page!.recent_moves.length).toBe(1);
    for (const m of page!.recent_moves) expect(MoveView.parse(m)).toBeTruthy();
    expect(OrganizationView.parse(page!.organization)).toBeTruthy();
    for (const r of page!.relations) expect(RelationView.parse(r)).toBeTruthy();
  });

  it('páginas de portal e Studio usam as mesmas formas', async () => {
    const s = await seed();
    const exec = await portalExecutivePage(db, s.ana);
    expect(PersonView.parse(exec!.person)).toBeTruthy();
    for (const r of [...exec!.current_roles, ...exec!.history]) expect(PersonRoleView.parse(r)).toBeTruthy();
    const ov = await studioEntityOverview(db, 'person', s.ana);
    if (!ov || ov.kind !== 'person') throw new Error('esperado person');
    expect(PersonView.parse(ov.person)).toBeTruthy();
    for (const r of ov.roles) expect(PersonRoleView.parse(r)).toBeTruthy();
  });

  it('RoleObservation do contrato aceita o que o Editorial envia e recusa o que o Intelligence recusa', () => {
    const ok = {
      personName: MOCK_PEOPLE.ana.name, publicProfileUrl: MOCK_PEOPLE.ana.profile, orgName: MOCK_ORGS.alfa, title: 'Diretora',
      evidenceId: '00000000-0000-4000-8000-000000000001', observedAt: '2026-11-22T10:00:00Z', kind: 'present' as const,
      announcement: { effectiveDate: '2026-11-20' },
    };
    expect(RoleObservation.parse(ok)).toBeTruthy();
    expect(() => RoleObservation.parse({ ...ok, kind: 'maybe' })).toThrow();
    expect(() => RoleObservation.parse({ ...ok, observedAt: 'ontem' })).toThrow();
  });
});
