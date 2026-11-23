import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, makeApp } from './_lib/testkit';
import * as fontes from './fontes/route';
import * as fonte from './fontes/[id]/route';
import * as evidencias from './fontes/[id]/evidencias/route';
import * as agenda from './agenda/route';
import * as agendaUma from './agenda/[id]/route';
import * as pubAgenda from './publico/agenda/route';
import * as materias from './materias/route';

let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Awaited<ReturnType<typeof app.actor>>;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let leitor: Awaited<ReturnType<typeof app.actor>>;
let comercial: Awaited<ReturnType<typeof app.actor>>;

beforeAll(async () => {
  app = await makeApp();
  admin = await app.actor('admin');
  chefe = await app.actor('editor_chefe');
  editor = await app.actor('editor');
  leitor = await app.actor('leitor');
  comercial = await app.actor('comercial');
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('fontes e evidências', () => {
  const body = { id: 'fonte-gov', nome: 'Diário Oficial', url: 'https://example.org/do', tipo: 'site', editorias: ['regulacao', 'mercado'] };

  it('cria inativa; só ativa com termos revisados; evidência só de fonte ativa', async () => {
    const c = await call(fontes.POST, 'POST', { body, as: editor });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ ativo: false, acesso: 'publico', termosRevisados: false });
    expect(c.body.data.editorias).toEqual(['mercado', 'regulacao']);
    const ev = { url: 'https://example.org/do/1', capturadoEm: '2026-11-20T10:00:00-03:00', sha256: 'd'.repeat(64) };
    expect((await call(evidencias.POST, 'POST', { params: { id: 'fonte-gov' }, body: ev, as: editor })).body.error.code).toBe('SOURCE_INACTIVE');
    const bad = await call(fonte.PATCH, 'PATCH', { params: { id: 'fonte-gov' }, body: { ativo: true }, as: chefe });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('TERMS_NOT_REVIEWED');
    const ok = await call(fonte.PATCH, 'PATCH', { params: { id: 'fonte-gov' }, body: { termosRevisados: true, ativo: true }, as: chefe });
    expect(ok.body.data).toMatchObject({ ativo: true, termosRevisados: true });
    const e = await call(evidencias.POST, 'POST', { params: { id: 'fonte-gov' }, body: ev, as: editor });
    expect(e.status).toBe(201);
    expect((await call(evidencias.GET, 'GET', { params: { id: 'fonte-gov' }, as: leitor })).body.data).toHaveLength(1);
  });

  it('recusa acesso não público, URL javascript:, editoria inexistente, duplicata e papel sem permissão', async () => {
    expect((await call(fontes.POST, 'POST', { body: { ...body, id: 'f2', acesso: 'assinante' }, as: editor })).status).toBe(400);
    expect((await call(fontes.POST, 'POST', { body: { ...body, id: 'f3', url: 'javascript:alert(1)' }, as: editor })).status).toBe(400);
    expect((await call(fontes.POST, 'POST', { body: { ...body, id: 'f4', editorias: ['nao-existe'] }, as: editor })).status).toBe(400);
    expect((await call(fontes.POST, 'POST', { body, as: editor })).status).toBe(409);
    expect((await call(fontes.POST, 'POST', { body: { ...body, id: 'f5' }, as: leitor })).status).toBe(403);
    expect((await call(fonte.DELETE, 'DELETE', { params: { id: 'fonte-gov' }, as: editor })).status).toBe(403);
    expect((await call(fonte.DELETE, 'DELETE', { params: { id: 'fonte-gov' }, as: admin })).status).toBe(409); // tem evidência
  });
});

describe('agenda', () => {
  const ev = { titulo: 'Congresso de Fidelidade', inicio: '2026-12-02', fim: '2026-12-03', local: 'São Paulo', fonteUrl: 'https://example.org/evento' };

  it('CRUD, fim antes do início recusado, filtro por data e leitura pública', async () => {
    const c = await call(agenda.POST, 'POST', { body: ev, as: editor });
    expect(c.status).toBe(201);
    const past = await call(agenda.POST, 'POST', { body: { ...ev, titulo: 'Passado', inicio: '2026-01-10', fim: '2026-01-11' }, as: editor });
    expect(past.status).toBe(201);
    expect((await call(agenda.POST, 'POST', { body: { ...ev, fim: '2026-12-01' }, as: editor })).status).toBe(400);
    expect((await call(agenda.POST, 'POST', { body: ev, as: comercial })).status).toBe(403);
    const id = c.body.data.id;
    expect((await call(agendaUma.PATCH, 'PATCH', { params: { id }, body: { fim: '2026-12-01' }, as: editor })).status).toBe(422);
    expect((await call(agendaUma.PATCH, 'PATCH', { params: { id }, body: { patrocinado: true }, as: editor })).body.data.patrocinado).toBe(true);
    const priv = await call(agenda.GET, 'GET', { query: { from: '2026-12-01', to: '2026-12-31' }, as: leitor });
    expect(priv.body.data.map((e: { titulo: string }) => e.titulo)).toEqual(['Congresso de Fidelidade']);
    const pub = await call(pubAgenda.GET, 'GET', {}); // sem login; hoje = 2026-11-22
    expect(pub.status).toBe(200);
    expect(pub.body.data.map((e: { titulo: string }) => e.titulo)).toEqual(['Congresso de Fidelidade']);
    expect((await call(agendaUma.DELETE, 'DELETE', { params: { id }, as: chefe })).status).toBe(204);
    expect((await call(agendaUma.GET, 'GET', { params: { id }, as: leitor })).status).toBe(404);
  });
});

describe('sessão e papel valem em todas as rotas novas', () => {
  it('sem login 401; comercial não escreve em matérias/fontes', async () => {
    for (const h of [fontes.GET, agenda.GET]) expect((await call(h, 'GET', {})).status).toBe(401);
    expect((await call(fontes.POST, 'POST', { body: {}, as: comercial })).status).toBe(403);
    expect((await call(materias.POST, 'POST', { body: {}, as: comercial })).status).toBe(403);
  });
});
