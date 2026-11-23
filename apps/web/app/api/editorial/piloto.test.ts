/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleArticle } from '@ln/editorial/testing';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp } from '../_lib/testkit';
import { dispatchEditorial as d } from '../_lib/editorial';

// Piloto de 10 matérias: mapa, leitura humana e cegueira entre leitores, pelas rotas oficiais (sessão + MFA + RBAC).
let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let admin: Awaited<ReturnType<typeof app.actor>>;
let revisor: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let leitor: Awaited<ReturnType<typeof app.actor>>;
let comercial: Awaited<ReturnType<typeof app.actor>>;
const S = (p: string) => `/api/studio/editorial${p}`;
const OK = { fatosNasEvidencias: true, tom: true, nadaInventado: true };

beforeAll(async () => {
  app = await makeApp();
  store = new PgEditorialStore(app.db);
  [admin, revisor, editor, leitor, comercial] = [await app.actor('admin'), await app.actor('revisor'), await app.actor('editor'), await app.actor('leitor'), await app.actor('comercial')];
  for (const m of ['a1', 'a2']) await store.putArticle(sampleArticle(`art-${m}`, { status: 'aprovado' }));
}, 120_000);
afterAll(async () => { await app.close(); });

describe('rotas /piloto', () => {
  it('sem sessão 401; comercial e leitor barrados; antes de gerar, 10 matérias com articleId null (estado vazio honesto)', async () => {
    expect((await call(d, 'GET', { path: S('/piloto') })).status).toBe(401);
    expect((await call(d, 'GET', { path: S('/piloto'), as: comercial })).status).toBe(403);
    expect((await call(d, 'GET', { path: S('/piloto'), as: leitor })).status).toBe(403);
    const r = await call(d, 'GET', { path: S('/piloto'), as: revisor });
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(10);
    expect(r.body.items.every((i: any) => i.articleId === null && i.estado === 'nao_gerada')).toBe(true);
    expect(r.body.fechamento).toBeUndefined();
  });

  it('mapa: revisor/editor 403; admin fixa a1 e a2; repetir 409; artigo inexistente 404', async () => {
    expect((await call(d, 'POST', { path: S('/piloto/mapa'), body: { a1: 'art-a1' }, as: revisor })).status).toBe(403);
    expect((await call(d, 'POST', { path: S('/piloto/mapa'), body: { a1: 'nada' }, as: admin })).status).toBe(404);
    const ok = await call(d, 'POST', { path: S('/piloto/mapa'), body: { a1: 'art-a1', a2: 'art-a2' }, as: admin });
    expect(ok.status).toBe(201);
    expect((await call(d, 'POST', { path: S('/piloto/mapa'), body: { a1: 'art-a2' }, as: admin })).status).toBe(409);
    const l = await call(d, 'GET', { path: S('/piloto'), as: editor });
    expect(l.body.items[0]).toMatchObject({ materia: 'a1', articleId: 'art-a1', estado: 'aguardando_leitura', leitor2: true });
    expect(l.body.items[1]).toMatchObject({ materia: 'a2', articleId: 'art-a2', leitor2: false });
  });

  it('leitura: leitor 1 (admin) registra; leitor 2 (revisor) só em a1; 409 repetida; cegueira do leitor 2 e do adjudicador; fechamento só para o dono', async () => {
    const body1 = { leitor: 1, achados: [{ trecho: 'a taxa é de 3%', tipo: 'numero', gravidade: 'baixa', evidenciaId: 'ev_1' }], checklist: OK, veredito: 'aprovado' };
    expect((await call(d, 'POST', { path: S('/piloto/a1/leitura'), body: body1, as: revisor })).status).toBe(403);
    const r1 = await call(d, 'POST', { path: S('/piloto/a1/leitura'), body: body1, as: admin });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ materia: 'a1', leitor: 1, unsupportedFacts: 1, baixas: 1 });
    expect((await call(d, 'POST', { path: S('/piloto/a1/leitura'), body: body1, as: admin })).status).toBe(409);
    expect((await call(d, 'POST', { path: S('/piloto/a2/leitura'), body: { ...body1, leitor: 2 }, as: revisor })).status).toBe(400);
    const cego = await call(d, 'GET', { path: S('/piloto/a1/leituras'), as: revisor });
    expect(cego.body).toMatchObject({ leituras: [], ocultas: 1 });
    expect((await call(d, 'GET', { path: S('/piloto'), as: revisor })).body.fechamento).toBeUndefined();
    expect((await call(d, 'POST', { path: S('/piloto/a1/leitura'), body: { ...body1, leitor: 2, achados: [] }, as: revisor })).status).toBe(201);
    const aberto = await call(d, 'GET', { path: S('/piloto/a1/leituras'), as: revisor });
    expect(aberto.body.leituras.map((l: any) => l.leitor).sort()).toEqual([1, 2]);
    const f = await call(d, 'GET', { path: S('/piloto'), as: admin });
    expect(f.body.fechamento).toMatchObject({ lidas: 1, altas: 0, criterio: 'em_andamento', divergencias: [] }); // só difere em baixa: baixas são anotadas, não contam como divergência
    expect(f.body.items[0].estado).toBe('lida');
  });
});
