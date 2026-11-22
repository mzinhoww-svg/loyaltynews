import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp, seedEvidence } from './_lib/testkit';
import * as fontes from './fontes/route';
import * as fonte from './fontes/[id]/route';
import * as evidencias from './fontes/[id]/evidencias/route';
import * as midia from './midia/route';
import * as midiaUma from './midia/[id]/route';
import * as agenda from './agenda/route';
import * as agendaUma from './agenda/[id]/route';
import * as pubAgenda from './publico/agenda/route';
import * as empresas from './entidades/empresas/route';
import * as empresa from './entidades/empresas/[id]/route';
import * as pessoas from './entidades/pessoas/route';
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

const direitos = {
  url: 'https://example.org/foto.jpg',
  origem: 'licenciada',
  credito: 'Agência X',
  baseDeDireito: 'licenca',
  textoAlternativo: 'Descrição da foto',
};

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

describe('mídia', () => {
  it('registra metadados com base de direito; pendente = não publicável; URL insegura recusada', async () => {
    const ok = await call(midia.POST, 'POST', { body: { tipo: 'imagem', direitos, sha256: 'e'.repeat(64) }, as: editor });
    expect(ok.status).toBe(201);
    expect(ok.body.data.publicavel).toBe(true);
    const pend = await call(midia.POST, 'POST', { body: { tipo: 'imagem', direitos: { ...direitos, baseDeDireito: 'pendente' }, sha256: 'e'.repeat(64) }, as: editor });
    expect(pend.body.data.publicavel).toBe(false);
    expect((await call(midia.POST, 'POST', { body: { tipo: 'imagem', direitos: { ...direitos, url: 'data:text/html,x' }, sha256: 'e'.repeat(64) }, as: editor })).status).toBe(400);
    expect((await call(midia.POST, 'POST', { body: { tipo: 'imagem', direitos: { ...direitos, origem: 'fonte_terceiro' }, sha256: 'e'.repeat(64) }, as: editor })).status).toBe(400); // terceiro sem link
    const list = await call(midia.GET, 'GET', { query: { tipo: 'imagem' }, as: leitor });
    expect(list.body.total).toBe(2);
    expect((await call(midiaUma.GET, 'GET', { params: { id: ok.body.data.id }, as: leitor })).status).toBe(200);
    expect((await call(midiaUma.DELETE, 'DELETE', { params: { id: ok.body.data.id }, as: editor })).status).toBe(403);
    expect((await call(midiaUma.DELETE, 'DELETE', { params: { id: ok.body.data.id }, as: chefe })).status).toBe(204);
    expect((await call(midiaUma.GET, 'GET', { params: { id: ok.body.data.id }, as: leitor })).status).toBe(404);
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

describe('entidades', () => {
  it('empresa exige evidência existente; CRUD; exclusão barrada se houver pessoa', async () => {
    const [e1, e2] = await seedEvidence(app.db, 2);
    const body = { id: 'emp-1', nome: 'Programa Alfa', site: 'https://alfa.example', setor: 'varejo', evidenceIds: [e1] };
    expect((await call(empresas.POST, 'POST', { body: { ...body, evidenceIds: [] }, as: editor })).status).toBe(400);
    expect((await call(empresas.POST, 'POST', { body: { ...body, evidenceIds: ['nada'] }, as: editor })).body.error.code).toBe('UNKNOWN_EVIDENCE');
    expect((await call(empresas.POST, 'POST', { body: { ...body, site: 'javascript:1' }, as: editor })).status).toBe(400);
    const c = await call(empresas.POST, 'POST', { body, as: editor });
    expect(c.status).toBe(201);
    expect(c.body.data.evidenceIds).toEqual([e1]);
    const p = await call(empresa.PATCH, 'PATCH', { params: { id: 'emp-1' }, body: { setor: null, evidenceIds: [e1, e2] }, as: editor });
    expect(p.body.data).toMatchObject({ setor: null });
    expect(p.body.data.evidenceIds).toHaveLength(2);
    expect((await call(empresa.GET, 'GET', { params: { id: 'emp-1' }, as: leitor })).status).toBe(200);
    expect((await call(empresas.GET, 'GET', { as: leitor })).body.data).toHaveLength(1);
    expect((await call(empresas.POST, 'POST', { body, as: editor })).status).toBe(409);
    expect((await call(empresa.DELETE, 'DELETE', { params: { id: 'emp-1' }, as: leitor })).status).toBe(403);
    await app.db.insert(schema.people).values({ id: 'p1', nome: 'N', cargo: 'C', empresaId: 'emp-1', evidenceId: e1 });
    expect((await call(empresa.DELETE, 'DELETE', { params: { id: 'emp-1' }, as: chefe })).status).toBe(409);
    await app.db.delete(schema.people);
    expect((await call(empresa.DELETE, 'DELETE', { params: { id: 'emp-1' }, as: chefe })).status).toBe(204);
  });

  it('pessoas: ingestão desligada por flag (padrão); ligada, aceita só nome, cargo, empresa e evidência', async () => {
    const [e1] = await seedEvidence(app.db, 1);
    await call(empresas.POST, 'POST', { body: { id: 'emp-2', nome: 'Beta', evidenceIds: [e1] }, as: editor });
    const person = { id: 'pe-1', nome: 'Fulana', cargo: 'Diretora', empresaId: 'emp-2', evidenceId: e1 };
    const off = await call(pessoas.POST, 'POST', { body: person, as: editor });
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('FEATURE_DISABLED');
    expect((await call(pessoas.GET, 'GET', { as: leitor })).body.data).toHaveLength(0);

    app.deps.flags.intelligencePessoas = true;
    try {
      expect((await call(pessoas.POST, 'POST', { body: { ...person, email: 'x@y.z' }, as: editor })).status).toBe(400); // dado pessoal além do P4
      expect((await call(pessoas.POST, 'POST', { body: { ...person, telefone: '1' }, as: editor })).status).toBe(400);
      expect((await call(pessoas.POST, 'POST', { body: person, as: editor })).status).toBe(201);
      expect((await call(pessoas.POST, 'POST', { body: { ...person, id: 'pe-2', empresaId: 'inexistente' }, as: editor })).status).toBe(409);
    } finally {
      app.deps.flags.intelligencePessoas = false;
    }
  });
});

describe('sessão e papel valem em todas as rotas novas', () => {
  it('sem login 401; comercial não escreve em matérias/fontes', async () => {
    for (const h of [fontes.GET, midia.GET, agenda.GET, empresas.GET, pessoas.GET]) expect((await call(h, 'GET', {})).status).toBe(401);
    expect((await call(fontes.POST, 'POST', { body: {}, as: comercial })).status).toBe(403);
    expect((await call(materias.POST, 'POST', { body: {}, as: comercial })).status).toBe(403);
  });
});
