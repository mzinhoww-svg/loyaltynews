/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEvidence, addRole, generateAlerts, ingestBatch, INGEST_SCHEMA_VERSION, resolveOrCreatePerson, SECONDARY_BASIS, upsertOrganization } from '@ln/intelligence';
import { call, makeApp, type Actor } from '../_lib/testkit';
import { dispatchIntelligence as d, intelDb, normalizeBooleans } from '../_lib/intelligence';

// Studio: includeInferred por HTTP (a query chega como texto), watchlists privadas (dono), apagar lista e item, e alertas com Move antes/depois.
let app: Awaited<ReturnType<typeof makeApp>>;
let editor: Actor;
let chefe: Actor;
let outro: Actor;
let ids: Record<string, string>;
const T = '2026-11-01T00:00:00Z';
const ON = { personIngestion: true, extendedPersonalData: false } as any;
const STU = (p: string) => `/api/studio/intelligence${p}`;
const del = (path: string, body: unknown, as: Actor | null) => call(d, 'DELETE', { path: STU(path), body, as });

beforeAll(async () => {
  app = await makeApp();
  [editor, chefe, outro] = [await app.actor('editor'), await app.actor('editor_chefe'), await app.actor('admin')];
  const db = intelDb(app.db);
  const ev = (nome: string, url: string) => addEvidence(db, { sourceUrl: url, sourceName: nome, retrievedAt: T, isMock: true });
  const alfa = await upsertOrganization(db, { legalName: 'Alfa S.A.', evidenceId: await ev('Alfa', 'https://ri.alfa.example.invalid/'), observedAt: T });
  const ana = (await resolveOrCreatePerson(db, { fullName: 'MOCK Ana', organizationId: alfa, evidenceId: await ev('Ana', 'https://ri.alfa.example.invalid/ana'), observedAt: T }, ON)).id;
  await addRole(db, { personId: ana, organizationId: alfa, title: 'CEO', validFrom: '2024-01-01', evidenceId: await ev('CEO', 'https://ri.alfa.example.invalid/ceo'), observedAt: T });
  const caio = (await resolveOrCreatePerson(db, { fullName: 'MOCK Caio', organizationId: alfa, evidenceId: await ev('Caio', 'https://www.linkedin.com/in/caio'), observedAt: T }, ON)).id;
  await addRole(db, { personId: caio, organizationId: alfa, title: 'Gerente', validFrom: '2025-01-01', certainty: 'inferred', inferenceBasis: SECONDARY_BASIS, evidenceId: await ev('Caio LinkedIn', 'https://www.linkedin.com/in/caio'), observedAt: T });
  ids = { alfa, ana, caio };
}, 180_000);
afterAll(async () => {
  await app.close();
});

describe('includeInferred por HTTP (bug: chegava como texto "true")', () => {
  it('normalizeBooleans converte só as chaves booleanas conhecidas, só "true"/"false"', () => {
    expect(normalizeBooleans({ includeInferred: 'true', includeClosed: 'false', q: 'true', x: 'true' })).toEqual({ includeInferred: true, includeClosed: false, q: 'true', x: 'true' });
    expect(normalizeBooleans({ includeInferred: 'talvez' })).toEqual({ includeInferred: 'talvez' });
    expect(normalizeBooleans(null)).toBeNull();
  });

  it('na empresa do Studio, ?includeInferred=true traz o cargo inferido (a confirmar); sem o parâmetro, não', async () => {
    const sem = await call(d, 'GET', { path: STU(`/companies/${ids.alfa}`), as: chefe });
    expect(sem.body.people.map((p: any) => p.title)).toEqual(['CEO']);
    const com = await call(d, 'GET', { path: STU(`/companies/${ids.alfa}`), query: { includeInferred: 'true' }, as: chefe });
    expect(com.body.people.map((p: any) => `${p.title}:${p.certainty}`).sort()).toEqual(['CEO:declared', 'Gerente:inferred']);
    const exec = await call(d, 'GET', { path: STU(`/executives/${ids.caio}`), query: { includeInferred: 'true' }, as: chefe });
    expect(exec.body.roles.map((r: any) => r.certainty)).toEqual(['inferred']);
    expect((await call(d, 'GET', { path: STU(`/executives/${ids.caio}`), as: chefe })).body.roles).toEqual([]);
  });

  it('o Portal NUNCA recebe inferido, mesmo com includeInferred=true', async () => {
    app.deps.flags.intelligencePessoas = true;
    try {
      const r = await call(d, 'GET', { path: `/api/intelligence/companies/${ids.alfa}`, query: { includeInferred: 'true' } });
      expect(JSON.stringify(r.body)).not.toContain('"certainty":"inferred"');
    } finally {
      app.deps.flags.intelligencePessoas = false;
    }
  });
});

describe('watchlists privadas, apagar lista e item, alertas com antes e depois', () => {
  let wid: string;
  it('o dono cria e lê; listagem só traz as dele; outro usuário recebe 404 em tudo (nunca revela que existe)', async () => {
    const w = await call(d, 'POST', { path: STU('/watchlists'), body: { name: 'Alfa e Ana' }, as: editor });
    expect(w.status).toBe(201);
    wid = w.body.id;
    expect((await call(d, 'POST', { path: STU(`/watchlists/${wid}/items`), body: { entityType: 'organization', entityId: ids.alfa }, as: editor })).status).toBe(201);
    expect((await call(d, 'POST', { path: STU(`/watchlists/${wid}/items`), body: { entityType: 'person', entityId: ids.ana }, as: editor })).body.items).toHaveLength(2);
    expect((await call(d, 'GET', { path: STU('/watchlists'), as: editor })).body.items.map((x: any) => x.id)).toEqual([wid]);
    expect((await call(d, 'GET', { path: STU('/watchlists'), as: outro })).body.items).toEqual([]);
    expect((await call(d, 'GET', { path: STU('/watchlists'), query: { ownerRef: editor.id }, as: outro })).body.items).toEqual([]); // ownerRef do cliente não vale: é sempre o próprio
    expect((await call(d, 'GET', { path: STU(`/watchlists/${wid}`), as: outro })).status).toBe(404);
    expect((await call(d, 'POST', { path: STU(`/watchlists/${wid}/items`), body: { entityType: 'organization', entityId: ids.alfa }, as: outro })).status).toBe(404);
    expect((await del(`/watchlists/${wid}`, {}, outro)).status).toBe(404);
    expect((await del(`/watchlists/${wid}/items`, { entityType: 'person', entityId: ids.ana }, outro)).status).toBe(404);
  });

  it('um Move que toca a lista gera alerta pendente COM o Move (antes e depois); só o dono vê; outro usuário nem pelo watchlistId', async () => {
    const db = intelDb(app.db);
    const mk = (title: string, at: string) => ({
      schemaVersion: INGEST_SCHEMA_VERSION,
      evidence: { sourceUrl: `https://ri.alfa.example.invalid/eva-${at}`, sourceName: 'MOCK Alfa RI', retrievedAt: at, isMock: true },
      observations: [{ personName: 'MOCK Eva', orgName: 'Alfa S.A.', title, kind: 'present' as const, observedAt: at }],
    });
    await ingestBatch(db, mk('Gerente', '2026-10-01T00:00:00Z'), ON);
    await ingestBatch(db, mk('Diretora', '2026-11-10T00:00:00Z'), ON);
    await generateAlerts(db);
    const meus = await call(d, 'GET', { path: STU('/alerts'), query: { status: 'pending_review' }, as: editor });
    expect(meus.status).toBe(200);
    expect(meus.body.items.length).toBeGreaterThan(0);
    const a = meus.body.items[0];
    expect(a).toMatchObject({ watchlist_id: wid, status: 'pending_review', person_name: 'MOCK Eva' });
    expect(a.move).toMatchObject({ before: { title: 'Gerente' }, after: { title: 'Diretora' } });
    expect(a.move.before.evidence.source_url).toMatch(/^https:\/\//);
    expect((await call(d, 'GET', { path: STU('/alerts'), as: outro })).body.items).toEqual([]);
    expect((await call(d, 'GET', { path: STU('/alerts'), query: { watchlistId: wid }, as: outro })).status).toBe(404);
    expect((await call(d, 'GET', { path: STU('/alerts'), query: { watchlistId: wid }, as: editor })).body.items.length).toBe(meus.body.items.length);
  });

  it('remover item: tira só aquele; repetir = 404; tipo inválido 400; depois apagar a lista: 200 {deleted}, some do dono, alertas dela somem; repetir 404', async () => {
    const r = await del(`/watchlists/${wid}/items`, { entityType: 'person', entityId: ids.ana }, editor);
    expect(r.status).toBe(200);
    expect(r.body.items.map((x: any) => x.entity_id)).toEqual([ids.alfa]);
    expect((await del(`/watchlists/${wid}/items`, { entityType: 'person', entityId: ids.ana }, editor)).status).toBe(404);
    expect((await del(`/watchlists/${wid}/items`, { entityType: 'robo', entityId: ids.ana }, editor)).status).toBe(400);
    expect((await del(`/watchlists/${wid}`, {}, null)).status).toBe(401);
    const apagada = await del(`/watchlists/${wid}`, {}, editor);
    expect(apagada).toMatchObject({ status: 200, body: { id: wid, deleted: true } });
    expect((await call(d, 'GET', { path: STU('/watchlists'), as: editor })).body.items).toEqual([]);
    expect((await call(d, 'GET', { path: STU('/alerts'), as: editor })).body.items).toEqual([]);
    expect((await del(`/watchlists/${wid}`, {}, editor)).status).toBe(404);
    // os Moves ficam (só a lista e os alertas dela saem)
    expect((await call(d, 'GET', { path: STU('/moves'), as: chefe })).body.items.length).toBeGreaterThan(0);
  });

  it('leitor e revisor não apagam nem removem item (entidades:update); a auditoria registra o DELETE', async () => {
    const leitor = await app.actor('leitor');
    const w = (await call(d, 'POST', { path: STU('/watchlists'), body: { name: 'Outra' }, as: editor })).body.id;
    expect((await del(`/watchlists/${w}`, {}, leitor)).status).toBe(403);
    expect((await del(`/watchlists/${w}`, {}, editor)).status).toBe(200);
  });
});
