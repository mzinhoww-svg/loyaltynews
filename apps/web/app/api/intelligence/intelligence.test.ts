/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addEvidence, addRole, ingestBatch, INGEST_SCHEMA_VERSION, resolveOrCreatePerson, upsertOrganization,
} from '@ln/intelligence';
import { call, makeApp } from '../_lib/testkit';
import { dispatchIntelligence as d, intelDb } from '../_lib/intelligence';

let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Awaited<ReturnType<typeof app.actor>>;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let leitor: Awaited<ReturnType<typeof app.actor>>;
let ids: { alfa: string; ana: string; ev: string };

const T = '2026-11-01T00:00:00Z';
const PUB = (p: string) => `/api/intelligence${p}`;
const STU = (p: string) => `/api/studio/intelligence${p}`;
const ON = { personIngestion: true, extendedPersonalData: false };

beforeAll(async () => {
  app = await makeApp();
  [admin, chefe, editor, leitor] = [await app.actor('admin'), await app.actor('editor_chefe'), await app.actor('editor'), await app.actor('leitor')];
  const db = intelDb(app.db);
  const ev = await addEvidence(db, { sourceUrl: 'https://mock.invalid/a', sourceName: 'MOCK', retrievedAt: T, isMock: true });
  const alfa = await upsertOrganization(db, { legalName: 'MOCK Programa Alfa S.A.', evidenceId: ev, observedAt: T });
  const ana = (await resolveOrCreatePerson(db, { fullName: 'MOCK Ana Teste', organizationId: alfa, evidenceId: ev, observedAt: T }, ON)).id;
  await addRole(db, { personId: ana, organizationId: alfa, title: 'CEO', validFrom: '2024-01-01', evidenceId: ev, observedAt: T });
  ids = { alfa, ana, ev };
  // dois instantes do mesmo cargo diferente => Move detectado (pendente de revisão)
  const mk = (title: string, at: string) => ({
    schemaVersion: INGEST_SCHEMA_VERSION,
    evidence: { sourceUrl: `https://mock.invalid/${at}`, sourceName: 'MOCK', retrievedAt: at, isMock: true },
    observations: [{ personName: 'MOCK Carla Teste', orgName: 'MOCK Programa Alfa S.A.', title, kind: 'present' as const, observedAt: at }],
  });
  await ingestBatch(db, mk('Gerente', '2026-10-01T00:00:00Z'), ON);
  await ingestBatch(db, mk('Diretora', '2026-11-10T00:00:00Z'), ON);
}, 180_000);
afterAll(async () => {
  await app.close();
});

describe('Portal: dado de pessoa só com a flag intelligencePessoas', () => {
  it('empresas são públicas; tudo que expõe pessoa responde 403 FEATURE_DISABLED com a flag desligada (padrão)', async () => {
    const s = await call(d, 'GET', { path: PUB('/companies'), query: { q: 'alfa' } });
    expect(s.status).toBe(200);
    expect(s.body.items).toHaveLength(1);
    for (const p of [`/companies/${ids.alfa}`, `/companies/${ids.alfa}/org-chart`, '/executives?q=ana', `/executives/${ids.ana}`, '/moves', '/graph/neighbors']) {
      const r = await call(d, 'GET', { path: PUB(p.split('?')[0]!), query: p.includes('?') ? { q: 'ana' } : {} });
      expect(r.status, p).toBe(403);
      expect(r.body.error.code).toBe('FEATURE_DISABLED');
    }
  });

  it('com a flag ligada o Portal lê pessoas (só campos P4), sem inferidos e só moves confirmados', async () => {
    app.deps.flags.intelligencePessoas = true;
    try {
      const c = await call(d, 'GET', { path: PUB(`/companies/${ids.alfa}`) });
      expect(c.status).toBe(200);
      expect(c.body.people.every((p: any) => p.certainty === 'declared')).toBe(true);
      const e = await call(d, 'GET', { path: PUB(`/executives/${ids.ana}`) });
      expect(Object.keys(e.body.person).sort()).toEqual(['evidence', 'full_name', 'id', 'public_profile_url']);
      const inferred = await call(d, 'GET', { path: PUB(`/companies/${ids.alfa}`), query: { includeInferred: 'true' } });
      expect(JSON.stringify(inferred.body)).not.toContain('"certainty":"inferred"'); // Portal nunca recebe inferido
      const mv = await call(d, 'GET', { path: PUB('/moves'), query: { status: 'detected' } });
      expect(mv.body.items.every((m: any) => m.status === 'confirmed')).toBe(true);
      expect((await call(d, 'GET', { path: PUB('/executives/nao-e-uuid') })).status).toBe(400);
    } finally {
      app.deps.flags.intelligencePessoas = false;
    }
  });
});

describe('Studio: sessão, RBAC e parâmetros de caminho', () => {
  it('sem sessão 401; leitor lê; id do caminho vence o da query; UUID inválido 400; 404/405', async () => {
    expect((await call(d, 'GET', { path: STU('/companies'), query: { q: 'alfa' } })).status).toBe(401);
    expect((await call(d, 'GET', { path: STU('/companies'), query: { q: 'alfa' }, as: leitor })).status).toBe(200);
    const r = await call(d, 'GET', { path: STU(`/companies/${ids.alfa}`), query: { id: '00000000-0000-0000-0000-000000000000' }, as: leitor });
    expect(r.status).toBe(200);
    expect(r.body.organization.id).toBe(ids.alfa);
    expect((await call(d, 'GET', { path: STU('/companies/xyz'), as: leitor })).status).toBe(400);
    expect((await call(d, 'GET', { path: STU('/nada'), as: leitor })).status).toBe(404);
    expect((await call(d, 'GET', { path: STU('/moves/abc/review'), as: leitor })).status).toBe(405);
    const org = await call(d, 'GET', { path: STU(`/executives/${ids.ana}`), as: leitor });
    expect(org.body.person.full_name).toBe('MOCK Ana Teste');
  });

  it('revisão de move: leitor 403; revisor/editor-chefe confirma; segunda revisão 409; registra ator', async () => {
    const list = await call(d, 'GET', { path: STU('/moves'), query: { status: 'detected' }, as: chefe });
    expect(list.body.items.length).toBeGreaterThan(0);
    const id = list.body.items[0].id as string;
    expect((await call(d, 'POST', { path: STU(`/moves/${id}/review`), body: { status: 'confirmed' }, as: leitor })).status).toBe(403);
    expect((await call(d, 'POST', { path: STU(`/moves/${id}/review`), body: { status: 'talvez' }, as: chefe })).status).toBe(400);
    const ok = await call(d, 'POST', { path: STU(`/moves/${id}/review`), body: { status: 'confirmed' }, as: chefe });
    expect(ok.body).toMatchObject({ status: 'confirmed', reviewed_by: chefe.id });
    expect((await call(d, 'POST', { path: STU(`/moves/${id}/review`), body: { status: 'confirmed' }, as: chefe })).status).toBe(409);
    app.deps.flags.intelligencePessoas = true;
    try {
      const pub = await call(d, 'GET', { path: PUB('/moves') });
      expect(pub.body.items.map((m: any) => m.id)).toContain(id);
    } finally {
      app.deps.flags.intelligencePessoas = false;
    }
  });

  it('watchlists: criar (papel com create), adicionar item e ler; entidade inexistente 404; leitor não cria', async () => {
    expect((await call(d, 'POST', { path: STU('/watchlists'), body: { name: 'Minha lista' }, as: leitor })).status).toBe(403);
    const w = await call(d, 'POST', { path: STU('/watchlists'), body: { name: 'Minha lista' }, as: editor });
    expect(w.status).toBe(201);
    const wid = w.body.id as string;
    const add = await call(d, 'POST', { path: STU(`/watchlists/${wid}/items`), body: { entityType: 'organization', entityId: ids.alfa }, as: editor });
    expect(add.status).toBe(201);
    expect((await call(d, 'POST', { path: STU(`/watchlists/${wid}/items`), body: { entityType: 'organization', entityId: '00000000-0000-0000-0000-000000000000' }, as: editor })).status).toBe(404);
    // watchlist é PRIVADA: o dono lê; quem não é o dono recebe 404 (nunca revela que a lista existe)
    const get = await call(d, 'GET', { path: STU(`/watchlists/${wid}`), as: editor });
    expect(get.body.items).toHaveLength(1);
    expect((await call(d, 'GET', { path: STU(`/watchlists/${wid}`), as: leitor })).status).toBe(404);
    expect((await call(d, 'GET', { path: STU('/alerts'), as: leitor })).status).toBe(200);
    expect((await call(d, 'GET', { path: STU('/alerts'), query: { status: 'x' }, as: leitor })).status).toBe(400);
  });
});

describe('pedidos do titular (LGPD): só admin', () => {
  it('editor-chefe 403; admin abre, exporta e suprime; pessoa suprimida some do Studio e do Portal', async () => {
    const body = { personId: ids.ana, kind: 'suppression' };
    expect((await call(d, 'POST', { path: STU('/subject-requests'), body, as: chefe })).status).toBe(403);
    const open = await call(d, 'POST', { path: STU('/subject-requests'), body, as: admin });
    expect(open.status).toBe(201);
    const rid = open.body.id as string;
    expect((await call(d, 'POST', { path: STU(`/subject-requests/${rid}/export`), as: admin })).status).toBe(409); // pedido não é de acesso
    expect((await call(d, 'POST', { path: STU(`/subject-requests/${rid}/suppress`), as: chefe })).status).toBe(403);
    const sup = await call(d, 'POST', { path: STU(`/subject-requests/${rid}/suppress`), as: admin });
    expect(sup.body).toMatchObject({ status: 'done' });
    expect((await call(d, 'GET', { path: STU(`/executives/${ids.ana}`), as: chefe })).status).toBe(404);
    app.deps.flags.intelligencePessoas = true;
    try {
      expect((await call(d, 'GET', { path: PUB(`/executives/${ids.ana}`) })).status).toBe(404);
    } finally {
      app.deps.flags.intelligencePessoas = false;
    }
  });
});

describe('porta SQL', () => {
  it('intelDb recusa driver sem cliente', () => {
    expect(() => intelDb({} as never)).toThrow(/\$client/);
  });
});
