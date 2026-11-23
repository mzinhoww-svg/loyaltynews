/* eslint-disable @typescript-eslint/no-explicit-any -- linhas de resultado do SQL e corpos JSON de resposta são tipados na borda */
import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../db';
import {
  DEFAULT_CONFIG, INGEST_SCHEMA_VERSION, PersonIngestionDisabledError, configFromFlags, createWatchlist, currentPeopleAt, exportPersonData,
  exportSubjectDataHandler, generateAlerts, getCompanyHandler, getExecutiveHandler, getOrgChartHandler, getRoleHistory, graphNeighborsHandler,
  listAlerts, listMoves, listMovesHandler, openSubjectRequest, portalCompanyPage, portalExecutivePage, portalMovesFeed, searchExecutivesHandler,
  sharedHistory, studioEntityOverview, suppressPerson, upsertOrganization, watch, addOrgChartEdge, ingestBatch,
  processObservation, resolveOrCreatePerson,
} from '../index';
import { MOCK_ORGS, MOCK_PEOPLE } from '../../fixtures/mock-entities';
import { ev, ib, newDb, po, rp } from './helpers';

let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });

const batchFor = (host: string, over: { name?: string; url?: string; org?: string; title?: string; at?: string; kind?: 'present' | 'left' } = {}) => {
  const at = over.at ?? '2026-11-10T10:00:00Z';
  return {
    schemaVersion: INGEST_SCHEMA_VERSION,
    evidence: { sourceUrl: `https://${host}/p/${at}`, sourceName: `MOCK ${host}`, retrievedAt: at, isMock: true },
    observations: [{
      personName: over.name ?? MOCK_PEOPLE.ana.name, ...(over.url ? { publicProfileUrl: over.url } : {}), orgName: over.org ?? MOCK_ORGS.alfa,
      title: over.title ?? 'Diretora', kind: over.kind ?? ('present' as const), observedAt: at,
    }],
  };
};

/** Ana existe em Alfa (fonte a.mock.invalid), com Move, watchlist, alerta e organograma; depois é suprimida. */
async function seedAndSuppress(withUrl: boolean) {
  const url = withUrl ? MOCK_PEOPLE.ana.profile : undefined;
  await ib(db, batchFor('a.mock.invalid', { url, title: 'Gerente', at: '2026-10-01T10:00:00Z' }));
  await ib(db, batchFor('a.mock.invalid', { url, title: 'Diretora', at: '2026-11-01T10:00:00Z' }));
  await ib(db, batchFor('a.mock.invalid', { name: MOCK_PEOPLE.bruno.name, title: 'CEO', at: '2026-10-01T10:00:00Z' }));
  const ana = (await db.query<{ id: string }>(`SELECT id FROM intelligence.person WHERE full_name = $1`, [MOCK_PEOPLE.ana.name])).rows[0]!.id;
  const alfa = (await db.query<{ id: string }>(`SELECT id FROM intelligence.organization LIMIT 1`)).rows[0]!.id;
  const roles = (await db.query<{ id: string; person_id: string }>(`SELECT id, person_id FROM intelligence.role_assignment WHERE valid_to IS NULL`)).rows;
  const rAna = roles.find((r) => r.person_id === ana)!.id, rBruno = roles.find((r) => r.person_id !== ana)!.id;
  const e = await ev(db, 'chart');
  await addOrgChartEdge(db, { organizationId: alfa, superiorRoleId: rBruno, subordinateRoleId: rAna, validFrom: '2026-11-01', certainty: 'declared', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
  const wl = await createWatchlist(db, 'MOCK', 'mock-owner');
  await watch(db, wl, 'organization', alfa);
  await generateAlerts(db);
  const req = await openSubjectRequest(db, ana, 'suppression');
  await suppressPerson(db, req, ana, 'mock-dpo');
  return { ana, alfa, req };
}

describe('supressão: reingestão bloqueada por identificador estável (não só pelo ID interno)', () => {
  it('mesma fonte, sem URL e em OUTRA empresa → bloqueada (nome + domínio da fonte)', async () => {
    await seedAndSuppress(false);
    const r = await ib(db, batchFor('a.mock.invalid', { org: MOCK_ORGS.beta, title: 'CMO', at: '2026-12-01T10:00:00Z' }));
    expect(r.items[0]).toMatchObject({ status: 'processed', result: { outcome: 'ignored', reason: 'subject_suppressed' } });
  });

  it('OUTRA fonte, sem URL, mesma empresa → bloqueada (nome + empresa)', async () => {
    await seedAndSuppress(false);
    const r = await ib(db, batchFor('outra-fonte.mock.invalid', { title: 'CMO', at: '2026-12-01T10:00:00Z' }));
    expect(r.items[0]).toMatchObject({ result: { outcome: 'ignored', reason: 'subject_suppressed' } });
  });

  it('OUTRA fonte e OUTRA empresa, mas com a mesma URL de perfil → bloqueada (URL)', async () => {
    await seedAndSuppress(true);
    const r = await ib(db, batchFor('outra-fonte.mock.invalid', { url: MOCK_PEOPLE.ana.profile, org: MOCK_ORGS.gama, at: '2026-12-01T10:00:00Z' }));
    expect(r.items[0]).toMatchObject({ result: { outcome: 'ignored', reason: 'subject_suppressed' } });
  });

  it('variação de caixa/acentos/pontuação no nome ainda é bloqueada', async () => {
    await seedAndSuppress(false);
    const r = await ib(db, batchFor('x.mock.invalid', { name: '  mock ANA  exemplo ', title: 'CMO', at: '2026-12-01T10:00:00Z' }));
    expect(r.items[0]).toMatchObject({ result: { outcome: 'ignored', reason: 'subject_suppressed' } });
  });

  it('nenhuma linha nova de pessoa, cargo ou Move aparece após as tentativas', async () => {
    await seedAndSuppress(false);
    const count = async (t: string) => Number((await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.${t}`)).rows[0]!.c);
    const before = [await count('person'), await count('role_assignment'), await count('move')];
    await ib(db, batchFor('a.mock.invalid', { org: MOCK_ORGS.beta, at: '2026-12-01T10:00:00Z' }));
    await ib(db, batchFor('b.mock.invalid', { at: '2026-12-02T10:00:00Z' }));
    await ib(db, batchFor('b.mock.invalid', { at: '2026-12-03T10:00:00Z', kind: 'left' }));
    expect([await count('person'), await count('role_assignment'), await count('move')]).toEqual(before);
  });

  it('bloqueio direto em resolveOrCreatePerson (porta de baixo nível) também vale', async () => {
    await seedAndSuppress(false);
    const e = await ev(db, 'a');
    const alfa = await upsertOrganization(db, { legalName: MOCK_ORGS.alfa, evidenceId: e, observedAt: '2026-12-01T00:00:00Z' });
    await expect(rp(db, { fullName: MOCK_PEOPLE.ana.name, organizationId: alfa, evidenceId: e, observedAt: '2026-12-01T00:00:00Z' })).rejects.toThrow(/person_suppressed/);
  });

  it('só hashes ficam guardados: o nome em claro não está nas chaves de bloqueio', async () => {
    await seedAndSuppress(true);
    const t = await db.query<{ key_kind: string; key_hash: string }>(`SELECT key_kind, key_hash FROM intelligence.suppression_tombstone ORDER BY 1,2`);
    expect(t.rows.map((x) => x.key_kind).sort()).toEqual(['name_org', 'name_source', 'profile_url']);
    expect(t.rows.every((x) => /^[0-9a-f]{64}$/.test(x.key_hash))).toBe(true);
    expect(JSON.stringify(t.rows).toLowerCase()).not.toContain('ana');
  });

  it('limite documentado: homônimo em outra empresa, outra fonte e sem URL NÃO é bloqueado (não há identificador comum)', async () => {
    await seedAndSuppress(false);
    const r = await ib(db, batchFor('terceira.mock.invalid', { org: MOCK_ORGS.gama, title: 'Analista', at: '2026-12-01T10:00:00Z' }));
    expect(r.items[0]).toMatchObject({ result: { outcome: 'baseline' } });
  });

  it('outras pessoas não são afetadas', async () => {
    await seedAndSuppress(false);
    const r = await ib(db, batchFor('a.mock.invalid', { name: MOCK_PEOPLE.bruno.name, title: 'CEO', at: '2026-12-01T10:00:00Z' }));
    expect(r.items[0]).toMatchObject({ result: { outcome: 'unchanged' } });
  });
});

describe('supressão: exportação, consultas, grafo e Moves excluem tudo da pessoa', () => {
  it('exportação completa não devolve cargos nem dados da pessoa suprimida (função e handler)', async () => {
    const s = await seedAndSuppress(true);
    expect(await exportPersonData(db, s.ana)).toEqual({ person: null, roles: [] });
    const acc = await openSubjectRequest(db, s.ana, 'access');
    const res = await exportSubjectDataHandler(db, 'mock-dpo', { requestId: acc });
    expect((res.body as any).data).toEqual({ person: null, roles: [] });
  });

  it('antes da supressão a exportação traz cargos (controle do teste)', async () => {
    await ib(db, batchFor('a.mock.invalid', { title: 'Gerente', at: '2026-10-01T10:00:00Z' }));
    const ana = (await db.query<{ id: string }>(`SELECT id FROM intelligence.person`)).rows[0]!.id;
    const out = await exportPersonData(db, ana);
    expect(out.person).not.toBeNull();
    expect(out.roles).toHaveLength(1);
  });

  it('nada vaza em nenhuma leitura: pessoas, cargos, organograma, grafo, Moves, alertas, portal e Studio', async () => {
    const s = await seedAndSuppress(true);
    expect(await getRoleHistory(db, s.ana)).toEqual([]);
    expect((await currentPeopleAt(db, s.alfa, '2026-11-22')).map((p) => p.full_name)).toEqual([MOCK_PEOPLE.bruno.name]);
    expect(await sharedHistory(db, s.ana)).toEqual([]);
    expect(await listMoves(db)).toEqual([]);
    expect(await listAlerts(db)).toEqual([]);
    expect((await getExecutiveHandler(db, 'studio', { id: s.ana, includeInferred: true })).status).toBe(404);
    expect((await searchExecutivesHandler(db, { q: 'ana' })).body).toEqual({ items: [] });
    expect(await portalExecutivePage(db, s.ana)).toBeNull();
    expect(await studioEntityOverview(db, 'person', s.ana)).toBeNull();
    expect(((await listMovesHandler(db, 'studio', {})).body as any).items).toEqual([]);
    expect((await portalMovesFeed(db)).items).toEqual([]);
    const chart = (await getOrgChartHandler(db, 'studio', { organizationId: s.alfa, asOf: '2026-11-22', includeInferred: true })).body as any;
    expect(chart.edges).toEqual([]);
    const nb = (await graphNeighborsHandler(db, 'studio', { type: 'organization', id: s.alfa, asOf: '2026-11-22', includeInferred: true })).body as any;
    expect(nb.items.some((n: any) => n.node_id === s.ana)).toBe(false);
    const company = (await getCompanyHandler(db, 'studio', { id: s.alfa, asOf: '2026-11-22', includeInferred: true })).body as any;
    expect(JSON.stringify(company)).not.toContain(MOCK_PEOPLE.ana.name);
    expect(JSON.stringify(await portalCompanyPage(db, s.alfa, '2026-11-22'))).not.toContain(MOCK_PEOPLE.ana.name);
  });

  it('atributos ampliados (se existissem) são apagados na supressão', async () => {
    const s = await seedAndSuppress(false);
    const n = await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.person_extended WHERE person_id = $1`, [s.ana]);
    expect(n.rows[0]!.c).toBe('0');
  });
});

describe('flag de ingestão de pessoas (intelligencePessoas) — desligada por padrão', () => {
  it('config padrão e derivada das flags do contrato estão desligadas', () => {
    expect(DEFAULT_CONFIG).toEqual({ personIngestion: false, extendedPersonalData: false });
    expect(configFromFlags()).toEqual({ personIngestion: false, extendedPersonalData: false });
    expect(configFromFlags({ intelligencePessoas: true })).toEqual({ personIngestion: true, extendedPersonalData: false });
  });

  it('sem a flag nenhuma pessoa é criada: baixo nível, Moves e lote', async () => {
    const e = await ev(db, 'f');
    await expect(resolveOrCreatePerson(db, { fullName: 'MOCK X', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' })).rejects.toBeInstanceOf(PersonIngestionDisabledError);
    await expect(processObservation(db, { personName: 'MOCK X', orgName: MOCK_ORGS.alfa, title: 'T', kind: 'present', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' })).rejects.toBeInstanceOf(PersonIngestionDisabledError);
    const rep = await ingestBatch(db, batchFor('a.mock.invalid'));
    expect(rep.accepted).toBe(false);
    expect(rep.batchIssues[0]!.message).toMatch(/person_ingestion_disabled/);
    const n = await db.query<{ c: string }>(`SELECT (SELECT count(*) FROM intelligence.person)::text c`);
    expect(n.rows[0]!.c).toBe('0');
    const ev0 = await db.query<{ c: string }>(`SELECT count(*)::text c FROM intelligence.evidence WHERE source_name LIKE 'MOCK a.mock%'`);
    expect(ev0.rows[0]!.c).toBe('0'); // lote recusado antes de gravar evidência
  });

  it('com a flag ligada o fluxo normal funciona (po usa CFG_ON)', async () => {
    const e = await ev(db, 'f2');
    const r = await po(db, { personName: 'MOCK Y', orgName: MOCK_ORGS.alfa, title: 'T', kind: 'present', evidenceId: e, observedAt: '2026-11-01T00:00:00Z' });
    expect(r.outcome).toBe('baseline');
  });
});

