import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '../db';
import { confirmRoleHandler, discardRoleHandler, getExecutiveHandler, listRolesHandler, loadSeed, type SeedDataset, type VerificationReport } from '../index';
import { newDb } from './helpers';

const ON = { personIngestion: true, extendedPersonalData: false };
let db: Db;
beforeEach(async () => { ({ db } = await newDb()); });
type Row = { role_id: string; certainty: string; source_level: string; status: string; person_name: string; evidence: { source_url: string } };
const items = async (input: object = {}) => ((await listRolesHandler(db, input)).body as { items: Row[] }).items;

// Conjunto de TESTE (fictício): 1 cargo oficial e 1 de fonte secundária ("a confirmar").
const ds: SeedDataset = {
  schemaVersion: 'intelligence-seed/2', datasetId: 'seed.teste.roles',
  sources: [
    { id: 'ofc', name: 'MOCK RI oficial', url: 'https://ri.mock.invalid/diretoria', method: 'capture' },
    { id: 'org', name: 'MOCK organograma público', url: 'https://theorg.com/org/mock-exemplo', method: 'capture' },
  ],
  organizations: [{ key: 'x', legalName: 'MOCK Exemplo S.A.', kind: 'company', sourceId: 'ofc', quote: 'MOCK Exemplo S.A. relações com investidores' }],
  relations: [],
  roles: [
    { personName: 'MOCK Oficial Exemplo', orgKey: 'x', title: 'Diretor Presidente', sourceId: 'ofc', sourceLevel: 'oficial', quote: 'MOCK Oficial Exemplo Diretor Presidente' },
    { personName: 'MOCK Pendente Exemplo', orgKey: 'x', title: 'Diretora Comercial', sourceId: 'org', sourceLevel: 'secundaria', quote: 'MOCK Pendente Exemplo Diretora Comercial' },
  ],
};
const ver: VerificationReport = {
  datasetId: ds.datasetId, verifiedAt: '2026-11-23T12:00:00Z',
  sources: ds.sources.map((s) => ({ id: s.id, url: s.url, status: 'verified', http_status: 200, fetched_at: '2026-11-23T12:00:00Z', content_sha256: 'a'.repeat(64) })),
  records: [
    { ref: 'organization:x', source_id: 'ofc', quote_found: true },
    { ref: 'role:x>MOCK Oficial Exemplo>Diretor Presidente', source_id: 'ofc', quote_found: true },
    { ref: 'role:x>MOCK Pendente Exemplo>Diretora Comercial', source_id: 'org', quote_found: true },
  ],
};

describe('cargos no Studio: nível da fonte e fila "a confirmar"', () => {
  it('lista todos com source_level e status; filtra por certainty; a fila vem primeiro', async () => {
    await loadSeed(db, ds, ver, ON);
    const all = await items();
    expect(all.map((r) => [r.person_name, r.certainty, r.source_level, r.status])).toEqual([
      ['MOCK Pendente Exemplo', 'inferred', 'secondary', 'to_confirm'],
      ['MOCK Oficial Exemplo', 'declared', 'official', 'confirmed'],
    ]);
    expect((await items({ certainty: 'inferred' })).map((r) => r.person_name)).toEqual(['MOCK Pendente Exemplo']);
    expect((await items({ q: 'oficial' })).map((r) => r.person_name)).toEqual(['MOCK Oficial Exemplo']);
    expect((await listRolesHandler(db, { certainty: 'talvez' })).status).toBe(400);
    expect((await listRolesHandler(db, { organizationId: 'x' })).status).toBe(400);
    // forma da evidência: fonte + link + data, sem o trecho
    expect(JSON.stringify(all)).not.toMatch(/excerpt/);
  });

  it('confirmar com página oficial: vira declarado/official com a nova evidência; LinkedIn/The Org, http e a mesma fonte são recusados', async () => {
    await loadSeed(db, ds, ver, ON);
    const pend = (await items({ certainty: 'inferred' }))[0]!;
    const c = (url: string, actor = 'editor@ln') => confirmRoleHandler(db, actor, { id: pend.role_id, officialUrl: url });
    expect((await c('https://theorg.com/org/mock-exemplo')).status).toBe(400); // a própria fonte secundária
    expect((await c('https://www.linkedin.com/company/mock-exemplo/people')).status).toBe(400);
    expect((await c('http://ri.mock.invalid/diretoria')).status).toBe(400);
    expect((await c('https://ri.mock.invalid/diretoria', '')).status).toBe(401);
    expect((await confirmRoleHandler(db, 'e', { id: '00000000-0000-4000-8000-000000000000', officialUrl: 'https://ri.mock.invalid/x' })).status).toBe(404);
    expect(await items({ certainty: 'inferred' })).toHaveLength(1); // nada mudou nas recusas
    const ok = await c('https://ri.mock.invalid/diretoria');
    expect([ok.status, ok.body]).toEqual([200, { id: pend.role_id, certainty: 'declared', source_level: 'official', confirmed_by: 'editor@ln' }]);
    const after = (await items()).find((r) => r.role_id === pend.role_id)!;
    expect([after.certainty, after.source_level, after.status, after.evidence.source_url]).toEqual(['declared', 'official', 'confirmed', 'https://ri.mock.invalid/diretoria']);
    expect((await c('https://ri.mock.invalid/outra')).status).toBe(409); // já declarado
    // o portal passa a ver a pessoa (antes não via)
    const pid = (await db.query<{ id: string }>(`SELECT id FROM intelligence.person WHERE full_name = 'MOCK Pendente Exemplo'`)).rows[0]!.id;
    expect(JSON.stringify((await getExecutiveHandler(db, 'public', { id: pid })).body)).toContain('Diretora Comercial');
  });

  it('descartar: só cargo inferido, com motivo; some da fila e do portal; declarado não se descarta por aqui', async () => {
    await loadSeed(db, ds, ver, ON);
    const pend = (await items({ certainty: 'inferred' }))[0]!;
    const off = (await items({ certainty: 'declared' }))[0]!;
    expect((await discardRoleHandler(db, 'ed', { id: pend.role_id })).status).toBe(400); // motivo obrigatório
    expect((await discardRoleHandler(db, '', { id: pend.role_id, motivo: 'homônimo' })).status).toBe(401);
    expect((await discardRoleHandler(db, 'ed', { id: off.role_id, motivo: 'x' })).status).toBe(409);
    const r = await discardRoleHandler(db, 'ed', { id: pend.role_id, motivo: 'homônimo, outra pessoa' });
    expect([r.status, r.body]).toEqual([200, { id: pend.role_id, discarded: true, discarded_by: 'ed' }]);
    expect(await items({ certainty: 'inferred' })).toHaveLength(0);
    const row = (await db.query<{ valid_to: string; inference_basis: string }>(`SELECT valid_to::text, inference_basis FROM intelligence.role_assignment WHERE id = $1`, [pend.role_id])).rows[0]!;
    expect(row.inference_basis).toMatch(/^descartado: homônimo, outra pessoa/);
    expect(row.valid_to).not.toBeNull();
  });
});
