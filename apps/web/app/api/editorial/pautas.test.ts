import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp } from '../_lib/testkit';
import { dispatchEditorial as d } from '../_lib/editorial';

// Pauta autoral (DP-29): a rota só registra e lista; o worker processa. RBAC, validação das âncoras e idempotência pela rota oficial.
let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let admin: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let revisor: Awaited<ReturnType<typeof app.actor>>;
let leitor: Awaited<ReturnType<typeof app.actor>>;
let comercial: Awaited<ReturnType<typeof app.actor>>;
const S = (p: string) => `/api/studio/editorial${p}`;
const PAUTA = {
  id: 'regras-de-validade-de-pontos', titulo: 'Como funcionam as regras de validade de pontos', formato: 'explicador', editoria: 'regulacao',
  angulo: 'Explicar, com base nas páginas oficiais citadas, como a validade dos pontos é tratada.',
  ancoras: ['https://www12.senado.leg.br/noticias/materias/2026/11/20/exemplo-a', 'https://www.camara.leg.br/noticias/1321186-exemplo-b'],
};

beforeAll(async () => {
  app = await makeApp();
  store = new PgEditorialStore(app.db);
  [admin, editor, revisor, leitor, comercial] = [await app.actor('admin'), await app.actor('editor'), await app.actor('revisor'), await app.actor('leitor'), await app.actor('comercial')];
}, 120_000);
afterAll(async () => { await app.close(); });

describe('rotas /pautas', () => {
  it('RBAC: sem sessão 401; comercial barrado na borda; leitor e revisor não propõem (403); revisor lê', async () => {
    expect((await call(d, 'POST', { path: S('/pautas'), body: PAUTA })).status).toBe(401);
    expect((await call(d, 'POST', { path: S('/pautas'), body: PAUTA, as: comercial })).status).toBe(403);
    expect((await call(d, 'POST', { path: S('/pautas'), body: PAUTA, as: leitor })).status).toBe(403);
    expect((await call(d, 'POST', { path: S('/pautas'), body: PAUTA, as: revisor })).status).toBe(403);
    expect((await call(d, 'GET', { path: S('/pautas'), as: revisor })).status).toBe(200);
  });

  it('editor propõe: 201 pendente; repetir o id é 409; a lista mostra a pauta pendente com quem propôs', async () => {
    const r = await call(d, 'POST', { path: S('/pautas'), body: PAUTA, as: editor });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: PAUTA.id, estado: 'pendente' });
    expect((await call(d, 'POST', { path: S('/pautas'), body: PAUTA, as: admin })).status).toBe(409);
    const l = await call(d, 'GET', { path: S('/pautas'), as: admin });
    expect(l.body.items).toHaveLength(1);
    expect(l.body.items[0]).toMatchObject({ id: PAUTA.id, estado: 'pendente', formato: 'explicador', editoria: 'regulacao' });
    expect(l.body.items[0].submetidaPor).toBeTruthy();
    expect(l.body.items[0].resultado).toBeUndefined();
  });

  it('validação: formato desconhecido, menos de 2 âncoras e âncora fora das fontes primárias do cadastro são 400 (nada é gravado)', async () => {
    const before = (await store.listAudit()).length;
    expect((await call(d, 'POST', { path: S('/pautas'), body: { ...PAUTA, id: 'outra-1', formato: 'noticia' }, as: editor })).status).toBe(400);
    expect((await call(d, 'POST', { path: S('/pautas'), body: { ...PAUTA, id: 'outra-2', ancoras: [PAUTA.ancoras[0]] }, as: editor })).status).toBe(400);
    const blog = await call(d, 'POST', { path: S('/pautas'), body: { ...PAUTA, id: 'outra-3', ancoras: [PAUTA.ancoras[0], 'https://passageirodeprimeira.com/post-x'] }, as: editor });
    expect(blog.status).toBe(400);
    expect(JSON.stringify(blog.body)).toMatch(/sem fonte primária no cadastro/);
    expect((await call(d, 'POST', { path: S('/pautas'), body: { ...PAUTA, id: 'outra-4', extra: 'x' }, as: editor })).status).toBe(400);
    expect((await store.listAudit()).length).toBe(before);
  });
});
