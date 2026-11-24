import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { call, makeApp, seedEvidence } from '../_lib/testkit';
import * as editorias from '../editorias/route';
import * as editoriaOne from '../editorias/[slug]/route';
import * as materias from './route';
import * as materia from './[id]/route';
import * as transicao from './[id]/transicao/route';
import * as recibos from './[id]/recibos/route';
import * as fontes from './[id]/fontes/route';
import * as pubList from '../publico/materias/route';
import * as pubOne from '../publico/materias/[slug]/route';

let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Awaited<ReturnType<typeof app.actor>>;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let leitor: Awaited<ReturnType<typeof app.actor>>;
let ev: string[];

beforeAll(async () => {
  app = await makeApp();
  [admin, chefe, editor, leitor] = [await app.actor('admin'), await app.actor('editor_chefe'), await app.actor('editor'), await app.actor('leitor')];
  ev = await seedEvidence(app.db, 3);
}, 120_000);
afterAll(async () => {
  await app.close();
});

let n = 0;
const draft = (over: Record<string, unknown> = {}) => ({
  slug: `materia-${++n}`,
  titulo: 'Programa muda regra de pontos',
  editoria: 'pontos',
  resumo: 'Resumo curto da matéria.',
  corpo: 'Texto da matéria com fatos verificáveis.',
  evidenceIds: [ev[0]],
  ...over,
});

async function create(over: Record<string, unknown> = {}, as = editor) {
  const r = await call(materias.POST, 'POST', { path: '/api/materias', body: draft(over), as });
  expect(r.status).toBe(201);
  return r.body.data as { id: string; versao: number; slug: string };
}
const go = (id: string, para: string, as = chefe, extra: Record<string, unknown> = {}) =>
  call(transicao.POST, 'POST', { params: { id }, body: { para, ...extra }, as });
const receipt = (id: string, versao: number, as = chefe, extra: Record<string, unknown> = {}) =>
  call(recibos.POST, 'POST', {
    params: { id },
    body: { versao, checagens: [{ tipo: 'fatos', resultado: 'aprovado', autorModelo: 'openai' }], ...extra },
    as,
  });

/**
 * Estado que o fluxo OFICIAL de publicação deixa (articles publicado/corrigido + histórico). A rota genérica de transição não
 * publica nem corrige (achado do QA 2 em 0edb1ac); o fluxo oficial real é testado em editorial/publication.test.ts.
 */
async function markPublished(id: string, para: 'publicado' | 'corrigido' = 'publicado', nota: string | null = null) {
  const [cur] = await app.db.select().from(schema.articles).where(eq(schema.articles.id, id));
  const now = app.deps.now();
  await app.db.update(schema.articles).set({ status: para, ...(para === 'publicado' ? { publicadoEm: now } : {}) }).where(eq(schema.articles.id, id));
  await app.db.insert(schema.articleTransitions).values({ id: `tr-${id}-${para}`, articleId: id, de: cur!.status, para, actorId: chefe.id, nota, receiptId: null, at: now });
}

/** rascunho → em_checagem → recibo → aprovado. */
async function toApproved(over: Record<string, unknown> = {}) {
  const a = await create(over);
  expect((await go(a.id, 'em_checagem')).status).toBe(200);
  const r = await receipt(a.id, a.versao);
  expect(r.status).toBe(201);
  expect((await go(a.id, 'aprovado')).status).toBe(200);
  return a;
}

describe('autenticação e RBAC nas rotas', () => {
  it('sem sessão: 401; só senha (sem TOTP): 403 MFA_REQUIRED; leitor não cria: 403', async () => {
    expect((await call(materias.GET, 'GET', { path: '/api/materias' })).status).toBe(401);
    const solo = await app.passwordOnly('admin');
    const r = await call(materias.GET, 'GET', { path: '/api/materias', as: solo });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MFA_REQUIRED');
    const f = await call(materias.POST, 'POST', { path: '/api/materias', body: draft(), as: leitor });
    expect(f.status).toBe(403);
    expect(f.body.error.code).toBe('FORBIDDEN');
    expect((await call(materias.GET, 'GET', { path: '/api/materias', as: leitor })).status).toBe(200);
  });
});

describe('editorias', () => {
  it('cadastra (idempotente), lista, renomeia e protege exclusão com matérias', async () => {
    await app.db.delete(schema.editorias).where(eq(schema.editorias.slug, 'global'));
    const c1 = await call(editorias.POST, 'POST', { body: { slug: 'global' }, as: chefe });
    expect(c1.status).toBe(201);
    expect(c1.body.data.nome).toBe('Global Loyalty');
    expect((await call(editorias.POST, 'POST', { body: { slug: 'global' }, as: chefe })).status).toBe(200);
    expect((await call(editorias.POST, 'POST', { body: { slug: 'inventada' }, as: chefe })).status).toBe(400);
    expect((await call(editorias.POST, 'POST', { body: { slug: 'global' }, as: editor })).status).toBe(403);
    const list = await call(editorias.GET, 'GET', { as: leitor });
    expect(list.body.data).toHaveLength(10);
    const p = await call(editoriaOne.PATCH, 'PATCH', { params: { slug: 'global' }, body: { nome: 'Global' }, as: chefe });
    expect(p.body.data.nome).toBe('Global');
    await create({ editoria: 'mercado' });
    const d = await call(editoriaOne.DELETE, 'DELETE', { params: { slug: 'mercado' }, as: admin });
    expect(d.status).toBe(409);
    expect(d.body.error.code).toBe('IN_USE');
    expect((await call(editoriaOne.DELETE, 'DELETE', { params: { slug: 'global' }, as: editor })).status).toBe(403);
    expect((await call(editoriaOne.DELETE, 'DELETE', { params: { slug: 'global' }, as: admin })).status).toBe(204);
  });
});

describe('matérias: CRUD e validação', () => {
  it('cria com assinatura institucional fixa; slug repetido 409; editoria/evidência inexistente 422', async () => {
    const a = await create();
    const g = await call(materia.GET, 'GET', { params: { id: a.id }, as: leitor });
    expect(g.body.data).toMatchObject({ status: 'rascunho', assinatura: 'Redação Loyalty News', versao: 1 });
    expect(g.body.data.fontes).toHaveLength(1);
    expect((await call(materias.POST, 'POST', { body: draft({ slug: a.slug }), as: editor })).status).toBe(409);
    expect((await call(materias.POST, 'POST', { body: draft({ editoria: 'mercado', evidenceIds: ['nao-existe'] }), as: editor })).body.error.code).toBe('UNKNOWN_EVIDENCE');
    await app.db.delete(schema.editorias).where(eq(schema.editorias.slug, 'regulacao'));
    expect((await call(materias.POST, 'POST', { body: draft({ editoria: 'regulacao' }), as: editor })).body.error.code).toBe('UNKNOWN_EDITORIA');
    await app.db.insert(schema.editorias).values({ slug: 'regulacao', nome: 'Regulação & Dados' });
  });

  it('recusa autor/assinatura no corpo, campos extras e patrocinado sem rótulo', async () => {
    for (const bad of [{ assinatura: 'Fulano' }, { status: 'publicado' }, { patrocinado: true }, { titulo: '' }, { slug: 'Maiúsculas Inválidas' }]) {
      const r = await call(materias.POST, 'POST', { body: draft(bad), as: editor });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
    const ok = await call(materias.POST, 'POST', { body: draft({ patrocinado: true, rotuloPublieditorial: 'Publieditorial' }), as: editor });
    expect(ok.status).toBe(201);
  });

  it('PATCH: exige versaoEsperada, incrementa versão, 409 se desatualizada ou fora de rascunho', async () => {
    const a = await create();
    const u = await call(materia.PATCH, 'PATCH', { params: { id: a.id }, body: { versaoEsperada: 1, titulo: 'Novo título' }, as: editor });
    expect(u.body.data).toMatchObject({ titulo: 'Novo título', versao: 2 });
    const stale = await call(materia.PATCH, 'PATCH', { params: { id: a.id }, body: { versaoEsperada: 1, titulo: 'X' }, as: editor });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_MISMATCH');
    expect((await call(materia.PATCH, 'PATCH', { params: { id: a.id }, body: { titulo: 'X' }, as: editor })).status).toBe(400);
    expect((await call(materia.PATCH, 'PATCH', { params: { id: a.id }, body: { versaoEsperada: 2, patrocinado: true }, as: editor })).status).toBe(422);
    await go(a.id, 'em_checagem');
    const locked = await call(materia.PATCH, 'PATCH', { params: { id: a.id }, body: { versaoEsperada: 2, titulo: 'Y' }, as: editor });
    expect(locked.body.error.code).toBe('NOT_EDITABLE');
  });

  it('troca de fontes incrementa a versão; só rascunho é excluído', async () => {
    const a = await create();
    const f = await call(fontes.PUT, 'PUT', { params: { id: a.id }, body: { versaoEsperada: 1, evidenceIds: [ev[1], ev[2]] }, as: editor });
    expect(f.body.data.versao).toBe(2);
    expect(f.body.data.fontes).toHaveLength(2);
    expect((await call(fontes.PUT, 'PUT', { params: { id: a.id }, body: { versaoEsperada: 2, evidenceIds: ['x'] }, as: editor })).status).toBe(422);
    const b = await toApproved();
    expect((await call(materia.DELETE, 'DELETE', { params: { id: b.id }, as: chefe })).body.error.code).toBe('NOT_DELETABLE');
    expect((await call(materia.DELETE, 'DELETE', { params: { id: a.id }, as: chefe })).status).toBe(204);
    expect((await call(materia.DELETE, 'DELETE', { params: { id: a.id }, as: editor })).status).toBe(403);
  });

  it('lista com filtro, busca e paginação', async () => {
    const r = await call(materias.GET, 'GET', { query: { editoria: 'pontos', limit: '2' }, as: leitor });
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeLessThanOrEqual(2);
    expect(r.body.total).toBeGreaterThan(2);
    expect(r.body.data[0].corpo).toBeUndefined();
    expect((await call(materias.GET, 'GET', { query: { limit: '1000' }, as: leitor })).status).toBe(400);
    expect((await call(materias.GET, 'GET', { query: { status: 'inventado' }, as: leitor })).status).toBe(400);
  });
});

describe('publicação só com recibo (ADR-008)', () => {
  it('fluxo: checagem → recibo → aprovado; a rota genérica NÃO publica nem corrige (flag desligada: 403; ligada: 409), sem efeito; despublicar segue com nota e histórico', async () => {
    const a = await toApproved();
    for (const para of ['publicado', 'corrigido']) {
      const off = await go(a.id, para, chefe, { nota: 'x'.repeat(10) });
      expect(off.status, para).toBe(para === 'publicado' ? 403 : 409); // corrigido a partir de aprovado nem é transição válida
    }
    const off = await go(a.id, 'publicado');
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe('FEATURE_DISABLED');
    app.deps.flags.publicacaoPortal = true;
    try {
      const on = await go(a.id, 'publicado');
      expect(on.status).toBe(409);
      expect(on.body.error.code).toBe('USE_PUBLICATION_ROUTE');
      expect(on.body.error.details.rota).toBe(`/api/studio/editorial/articles/${a.id}/publication`);
      expect((await go(a.id, 'publicado', editor)).body.error.code).toBe('FORBIDDEN'); // a autorização vem antes
    } finally {
      app.deps.flags.publicacaoPortal = false;
    }
    const [row] = await app.db.select().from(schema.articles).where(eq(schema.articles.id, a.id));
    expect(row).toMatchObject({ status: 'aprovado', publicadoEm: null });
    expect((await call(pubOne.GET, 'GET', { params: { slug: a.slug } })).status).toBe(404);

    await markPublished(a.id);
    for (const flag of [false, true]) {
      app.deps.flags.publicacaoPortal = flag;
      try {
        const c = await go(a.id, 'corrigido', chefe, { nota: 'Corrigido o prazo de validade citado.' });
        expect(c.status).toBe(flag ? 409 : 403);
      } finally {
        app.deps.flags.publicacaoPortal = false;
      }
    }
    expect((await call(materia.GET, 'GET', { params: { id: a.id }, as: leitor })).body.data.status).toBe('publicado');
    const d = await go(a.id, 'despublicado', chefe, { nota: 'Retirada a pedido da fonte.' });
    expect(d.body.data.status).toBe('despublicado');
    const g = await call(materia.GET, 'GET', { params: { id: a.id }, as: leitor });
    expect(g.body.data.transicoes.map((t: { para: string }) => t.para)).toEqual(['em_checagem', 'aprovado', 'publicado', 'despublicado']);
    expect(g.body.data.recibo.conteudoSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sem recibo não aprova; só quem tem materias:publish chega sequer à recusa de publicar', async () => {
    const a = await create();
    await go(a.id, 'em_checagem');
    expect((await go(a.id, 'aprovado')).body.error.code).toBe('RECEIPT_REQUIRED');
    await receipt(a.id, a.versao);
    await go(a.id, 'aprovado');
    for (const quem of [chefe, admin]) expect((await go(a.id, 'publicado', quem)).status).toBe(403); // flag desligada
    expect((await go(a.id, 'publicado', editor)).body.error.code).toBe('FORBIDDEN');
  });

  it('voltar a rascunho e editar gera nova versão: o recibo antigo não vale', async () => {
    const a = await toApproved();
    expect((await go(a.id, 'rascunho')).status).toBe(200);
    const u = await call(materia.PATCH, 'PATCH', { params: { id: a.id }, body: { versaoEsperada: a.versao, corpo: 'Corpo revisado.' }, as: editor });
    expect(u.body.data.versao).toBe(a.versao + 1);
    await go(a.id, 'em_checagem');
    expect((await go(a.id, 'aprovado')).body.error.code).toBe('RECEIPT_REQUIRED');
    expect((await receipt(a.id, a.versao)).body.error.code).toBe('VERSION_MISMATCH');
    expect((await receipt(a.id, a.versao + 1)).status).toBe(201);
    expect((await receipt(a.id, a.versao + 1)).status).toBe(200); // idempotente
    expect((await go(a.id, 'aprovado')).status).toBe(200);
  });

  it('regras determinísticas: imagem sem direito, classe de dado não pública e matéria sem fonte são barradas', async () => {
    const imgPendente = {
      url: 'https://example.org/i.jpg',
      origem: 'propria',
      credito: 'Loyalty News',
      baseDeDireito: 'pendente',
      textoAlternativo: 'Descrição da imagem',
    };
    const a = await create({ imagem: imgPendente });
    await go(a.id, 'em_checagem');
    const r = await receipt(a.id, a.versao);
    expect(r.status).toBe(422);
    expect(r.body.error.details.join(' ')).toMatch(/imagem sem base de direito/);

    const b = await create({ classeDeDado: 'personal' });
    await go(b.id, 'em_checagem');
    expect((await receipt(b.id, b.versao)).body.error.details.join(' ')).toMatch(/classe de dado personal/);

    const c = await create({ evidenceIds: [] });
    const t = await go(c.id, 'em_checagem');
    expect(t.status).toBe(422);
    expect(t.body.error.code).toBe('GATES_FAILED');
  });

  it('resumo é obrigatório para aprovar; tipo patrocinado exige rótulo; tempo de leitura derivado', async () => {
    const a = await create({ resumo: undefined });
    await go(a.id, 'em_checagem');
    const r = await receipt(a.id, a.versao);
    expect(r.status).toBe(422);
    expect(r.body.error.details.join(' ')).toMatch(/resumo obrigatório/);
    expect((await call(materias.POST, 'POST', { body: draft({ resumo: 'x'.repeat(301) }), as: editor })).status).toBe(400);
    expect((await call(materias.POST, 'POST', { body: draft({ tipoConteudo: 'patrocinado' }), as: editor })).status).toBe(400);
    expect((await call(materias.POST, 'POST', { body: draft({ tipoConteudo: 'patrocinado', patrocinado: true, rotuloPublieditorial: 'Publieditorial' }), as: editor })).status).toBe(201);
    expect((await call(materias.POST, 'POST', { body: draft({ tipoConteudo: 'inventado' }), as: editor })).status).toBe(400);
    const u = await call(materia.PATCH, 'PATCH', { params: { id: a.id }, body: { versaoEsperada: 1, tipoConteudo: 'patrocinado' }, as: editor });
    expect(u.status).toBe(409); // em checagem não edita
    const g = await call(materia.GET, 'GET', { params: { id: a.id }, as: leitor });
    expect(g.body.data).toMatchObject({ tipoConteudo: 'noticia', tempoLeituraMin: 1 });
  });

  it('transições inválidas, notas obrigatórias e não publicar a partir de rascunho', async () => {
    const a = await create();
    for (const para of ['publicado', 'aprovado', 'corrigido', 'despublicado']) expect((await go(a.id, para)).body.error.code).toBe('BAD_TRANSITION');
    await go(a.id, 'em_checagem');
    expect((await go(a.id, 'bloqueado')).body.error.code).toBe('NOTE_REQUIRED');
    expect((await go(a.id, 'bloqueado', chefe, { nota: 'Fonte não confirma o número.' })).status).toBe(200);
    expect((await go(a.id, 'rascunho')).status).toBe(200);
    const b = await toApproved();
    await markPublished(b.id);
    expect((await go(b.id, 'despublicado')).body.error.code).toBe('NOTE_REQUIRED');
  });

  it('transição concorrente: só uma vence', async () => {
    const a = await toApproved();
    await markPublished(a.id);
    const [x, y] = await Promise.all([go(a.id, 'despublicado', chefe, { nota: 'Retirada.' }), go(a.id, 'despublicado', chefe, { nota: 'Retirada.' })]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
  });
});

describe('API pública: só publicado e corrigido, com errata', () => {
  it('rascunho, aprovado e despublicado ficam fora; publicado e corrigido aparecem sem campos internos', async () => {
    const draftOnly = await create({ titulo: 'Rascunho secreto' });
    const pub = await toApproved({ titulo: 'Matéria pública' });
    await markPublished(pub.id);
    await markPublished(pub.id, 'corrigido', 'Errata: data ajustada.');
    const gone = await toApproved({ titulo: 'Matéria retirada' });
    await markPublished(gone.id);
    await go(gone.id, 'despublicado', chefe, { nota: 'Retirada.' });

    const list = await call(pubList.GET, 'GET', { path: '/api/publico/materias' });
    expect(list.status).toBe(200);
    const slugs = list.body.data.map((m: { slug: string }) => m.slug);
    expect(slugs).toContain(pub.slug);
    expect(slugs).not.toContain(draftOnly.slug);
    expect(slugs).not.toContain(gone.slug);
    expect(list.headers.get('cache-control')).toContain('public');

    const one = await call(pubOne.GET, 'GET', { params: { slug: pub.slug } });
    expect(one.body.data.erratas[0].nota).toBe('Errata: data ajustada.');
    expect(one.body.data.fontes).toHaveLength(1);
    expect(one.body.data.assinatura).toBe('Redação Loyalty News');
    for (const k of ['id', 'status', 'classeDeDado', 'versao', 'criadoEm']) expect(one.body.data[k]).toBeUndefined();
    expect((await call(pubOne.GET, 'GET', { params: { slug: draftOnly.slug } })).status).toBe(404);
    expect((await call(pubOne.GET, 'GET', { params: { slug: gone.slug } })).status).toBe(404);
  });
});

describe('auditoria das escritas', () => {
  it('registra criação, transição e recibo com ator e papel, sem corpo da matéria', async () => {
    const rows = await app.db.select().from(schema.auditLog);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['materia.criada', 'materia.transicao', 'materia.recibo_emitido', 'materia.alterada', 'editoria.criada']) expect(actions).toContain(a);
    const created = rows.find((r) => r.action === 'materia.criada');
    expect(created?.actorRole).toBe('editor');
    expect(JSON.stringify(rows)).not.toContain('Texto da matéria com fatos');
  });
});

describe('P2-02: recibo com o NOME de quem aprovou (auditoria do Studio)', () => {
  it('o detalhe da matéria devolve aprovadorNome (nome do usuário, nunca o e-mail) junto com o id; sem recibo, recibo null; usuário apagado, nome null', async () => {
    const a = await toApproved();
    const r = await call(materia.GET, 'GET', { params: { id: a.id }, as: editor });
    expect(r.status).toBe(200);
    const [u] = await app.db.select().from(schema.user).where(eq(schema.user.id, chefe.id));
    expect(r.body.data.recibo).toMatchObject({ aprovador: chefe.id, aprovadorNome: u!.name });
    expect(JSON.stringify(r.body.data.recibo)).not.toContain(u!.email); // só o nome; o e-mail do revisor não sai
    const semRecibo = await create();
    expect((await call(materia.GET, 'GET', { params: { id: semRecibo.id }, as: editor })).body.data.recibo).toBeNull();
    // aprovador que não existe mais (usuário removido; o recibo é imutável e guarda o id): o id fica, o nome vira null (a tela cai no id)
    const chefe2 = await app.actor('editor_chefe', 'chefe-removido' as 'editor_chefe');
    const b = await create();
    expect((await go(b.id, 'em_checagem', chefe2)).status).toBe(200);
    expect((await receipt(b.id, b.versao, chefe2)).status).toBe(201);
    await app.db.delete(schema.session).where(eq(schema.session.userId, chefe2.id));
    await app.db.delete(schema.account).where(eq(schema.account.userId, chefe2.id));
    await app.db.delete(schema.twoFactor).where(eq(schema.twoFactor.userId, chefe2.id));
    await app.db.delete(schema.user).where(eq(schema.user.id, chefe2.id));
    expect((await call(materia.GET, 'GET', { params: { id: b.id }, as: editor })).body.data.recibo).toMatchObject({ aprovador: chefe2.id, aprovadorNome: null });
  });
});
