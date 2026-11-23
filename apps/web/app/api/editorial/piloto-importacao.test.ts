/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleArticle } from '@ln/editorial/testing';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp } from '../_lib/testkit';
import { dispatchEditorial as d } from '../_lib/editorial';

// Importação auditada da leitura do leitor 2 pelas rotas oficiais (sessão + MFA + RBAC).
let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let admin: Awaited<ReturnType<typeof app.actor>>;
let revisor: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
const S = (p: string) => `/api/studio/editorial${p}`;
const OK = { fatosNasEvidencias: true, tom: true, nadaInventado: true };
const SHA = 'c'.repeat(64);
const arquivo = { nome: 'folha-qa3.csv', sha256: SHA, linhas: 4 };

beforeAll(async () => {
  app = await makeApp();
  store = new PgEditorialStore(app.db);
  [admin, revisor, editor] = [await app.actor('admin'), await app.actor('revisor'), await app.actor('editor')];
  await store.putArticle(sampleArticle('art-a1', { status: 'aprovado' }));
  await call(d, 'POST', { path: S('/piloto/mapa'), body: { a1: 'art-a1' }, as: admin });
}, 120_000);
afterAll(async () => { await app.close(); });

describe('rotas /piloto/importacao', () => {
  it('registro da folha: só admin/chefe; 201 e idempotente (200); GET /piloto mostra hash e data da primeira folha', async () => {
    const body = { arquivo, leitor2Nome: 'QA 3', materias: ['a1'] };
    expect((await call(d, 'POST', { path: S('/piloto/importacao/registro'), body })).status).toBe(401);
    expect((await call(d, 'POST', { path: S('/piloto/importacao/registro'), body, as: revisor })).status).toBe(403);
    expect((await call(d, 'POST', { path: S('/piloto/importacao/registro'), body, as: editor })).status).toBe(403);
    const r1 = await call(d, 'POST', { path: S('/piloto/importacao/registro'), body, as: admin });
    expect(r1.status).toBe(201);
    const r2 = await call(d, 'POST', { path: S('/piloto/importacao/registro'), body, as: admin });
    expect(r2.status).toBe(200);
    expect(r2.body.registradoEm).toBe(r1.body.registradoEm);
    const outra = await call(d, 'POST', { path: S('/piloto/importacao/registro'), body: { ...body, arquivo: { ...arquivo, sha256: 'd'.repeat(64) } }, as: admin });
    expect(outra.status).toBe(409);
    expect(JSON.stringify(outra.body)).toMatch(/FOLHA_DIFERENTE/);
    const l = await call(d, 'GET', { path: S('/piloto'), as: revisor });
    expect(l.body.items[0].folha).toMatchObject({ sha256: SHA });
  });

  it('importação: revisor 403; leitor 1 pendente 409 LEITOR1_PENDENTE; depois do leitor 1, 201 só com contagens e o leitor 2 aparece como registrado', async () => {
    const imp = { arquivo, leitor2Nome: 'QA 3', leituras: [{ materia: 'a1', achados: [{ trecho: 'a taxa é de 3%', tipo: 'numero', gravidade: 'media', evidenciaId: 'ev_1' }], checklist: OK, veredito: 'aprovado' }] };
    expect((await call(d, 'POST', { path: S('/piloto/importacao'), body: imp, as: revisor })).status).toBe(403);
    const pend = await call(d, 'POST', { path: S('/piloto/importacao'), body: imp, as: admin });
    expect(pend.status).toBe(409);
    expect(JSON.stringify(pend.body)).toMatch(/LEITOR1_PENDENTE/);
    expect((await call(d, 'POST', { path: S('/piloto/a1/leitura'), body: { leitor: 1, achados: [], checklist: OK, veredito: 'aprovado' }, as: admin })).status).toBe(201);
    const r = await call(d, 'POST', { path: S('/piloto/importacao'), body: imp, as: admin });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ importadas: [{ materia: 'a1', unsupportedFacts: 1, altas: 0, medias: 1, baixas: 0 }] });
    expect(JSON.stringify(r.body)).not.toContain('trecho');
    expect((await call(d, 'POST', { path: S('/piloto/importacao'), body: imp, as: admin })).status).toBe(409);
    const l = await call(d, 'GET', { path: S('/piloto'), as: admin });
    expect(l.body.items[0]).toMatchObject({ estado: 'lida', leituras: { leitor1: true, leitor2: true } });
    const ls = await call(d, 'GET', { path: S('/piloto/a1/leituras'), as: admin });
    expect(ls.body.leituras.find((x: any) => x.leitor === 2)).toMatchObject({ origem: 'importacao', importadoPor: expect.any(String), arquivo: { sha256: SHA } });
  });
});
