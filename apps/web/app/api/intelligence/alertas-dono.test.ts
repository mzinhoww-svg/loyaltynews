/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addEvidence, generateAlerts, ingestBatch, INGEST_SCHEMA_VERSION, upsertOrganization } from '@ln/intelligence';
import { call, makeApp, type Actor } from '../_lib/testkit';
import { dispatchIntelligence as d, intelDb } from '../_lib/intelligence';

// Decisão do PM (23/11): a revisão de alerta é do DONO da lista (alerta é pessoal); o papel revisor (materias:transition) não revisa alerta alheio.
let app: Awaited<ReturnType<typeof makeApp>>;
let dono: Actor;
let chefe: Actor; // editor_chefe: tem materias:transition (revisa Move), mas NÃO é o dono
let outro: Actor;
let leitor: Actor;
let wid: string;
const T = '2026-11-01T00:00:00Z';
const ON = { personIngestion: true, extendedPersonalData: false } as any;
const STU = (p: string) => `/api/studio/intelligence${p}`;
const rev = (id: string, status: string, as: Actor | null) => call(d, 'POST', { path: STU(`/alerts/${id}/review`), body: { status }, as });

beforeAll(async () => {
  app = await makeApp();
  [dono, chefe, outro, leitor] = [await app.actor('editor'), await app.actor('editor_chefe'), await app.actor('admin'), await app.actor('leitor')];
  const db = intelDb(app.db);
  const ev = (nome: string, url: string) => addEvidence(db, { sourceUrl: url, sourceName: nome, retrievedAt: T, isMock: true });
  const alfa = await upsertOrganization(db, { legalName: 'Alfa S.A.', evidenceId: await ev('Alfa', 'https://ri.alfa.example.invalid/'), observedAt: T });
  wid = (await call(d, 'POST', { path: STU('/watchlists'), body: { name: 'Alfa' }, as: dono })).body.id;
  await call(d, 'POST', { path: STU(`/watchlists/${wid}/items`), body: { entityType: 'organization', entityId: alfa }, as: dono });
  const mk = (title: string, at: string) => ({
    schemaVersion: INGEST_SCHEMA_VERSION,
    evidence: { sourceUrl: `https://ri.alfa.example.invalid/eva-${at}`, sourceName: 'MOCK Alfa RI', retrievedAt: at, isMock: true },
    observations: [{ personName: 'MOCK Eva', orgName: 'Alfa S.A.', title, kind: 'present' as const, observedAt: at }],
  });
  await ingestBatch(db, mk('Gerente', '2026-10-01T00:00:00Z'), ON);
  await ingestBatch(db, mk('Diretora', '2026-11-10T00:00:00Z'), ON);
  await generateAlerts(db);
}, 180_000);
afterAll(async () => {
  await app.close();
});

describe('revisão de alerta: só o dono da lista', () => {
  const pendente = async (as: Actor) => (await call(d, 'GET', { path: STU('/alerts'), query: { status: 'pending_review' }, as })).body.items[0];

  it('outro usuário, mesmo com papel revisor (editor_chefe) ou admin, recebe 404 e o alerta continua pendente; leitor 403; sem sessão 401', async () => {
    const a = await pendente(dono);
    expect(a).toMatchObject({ watchlist_id: wid, status: 'pending_review' });
    expect((await rev(a.id, 'approved', chefe)).status).toBe(404);
    expect((await rev(a.id, 'approved', outro)).status).toBe(404);
    expect((await rev(a.id, 'approved', leitor)).status).toBe(403);
    expect((await rev(a.id, 'approved', null)).status).toBe(401);
    expect((await pendente(dono)).status).toBe('pending_review');
  });

  it('id que não existe = 404 igual ao de outro dono (não revela existência); id inválido 400; status inválido 400', async () => {
    const a = await pendente(dono);
    expect((await rev('00000000-0000-4000-8000-000000000000', 'approved', dono)).status).toBe(404);
    expect((await rev('nao-e-uuid', 'approved', dono)).status).toBe(400);
    expect((await rev(a.id, 'talvez', dono)).status).toBe(400);
  });

  it('o dono aprova; a revisão registra quem revisou; repetir = 409; o alerta sai de pendentes', async () => {
    const a = await pendente(dono);
    const r = await rev(a.id, 'approved', dono);
    expect(r).toMatchObject({ status: 200, body: { id: a.id, status: 'approved', reviewed_by: dono.id } });
    expect((await rev(a.id, 'rejected', dono)).status).toBe(409);
    expect((await call(d, 'GET', { path: STU('/alerts'), query: { status: 'pending_review' }, as: dono })).body.items).toEqual([]);
  });
});
