/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleArticle } from '@ln/editorial/testing';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp } from '../_lib/testkit';
import { portalArticleUrl } from '../_lib/social/articles';
import { dispatchSocial as d, getPublisher, resetPublisherForTest, SOCIAL_ROUTES } from '../_lib/social';

let app: Awaited<ReturnType<typeof makeApp>>;
let admin: Awaited<ReturnType<typeof app.actor>>;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let revisor: Awaited<ReturnType<typeof app.actor>>;
let comercial: Awaited<ReturnType<typeof app.actor>>;
let leitor: Awaited<ReturnType<typeof app.actor>>;

const S = (p: string) => `/api/studio/social${p}`;
const sha = 'a'.repeat(64);

beforeAll(async () => {
  resetPublisherForTest();
  app = await makeApp();
  [admin, chefe, editor, revisor, comercial, leitor] = [
    await app.actor('admin'), await app.actor('editor_chefe'), await app.actor('editor'),
    await app.actor('revisor'), await app.actor('comercial'), await app.actor('leitor'),
  ];
  const img = { url: 'https://example.org/capa.jpg', origem: 'propria', credito: 'Loyalty News', baseDeDireito: 'propria', textoAlternativo: 'Capa da matéria' };
  const mk = (id: string, slug: string, over: Record<string, unknown> = {}) =>
    app.db.insert(schema.articles).values({
      id, slug, titulo: 'Programa muda a regra de validade dos pontos', editoria: 'programas', corpo: 'Corpo da matéria.', resumo: 'Resumo curto.',
      status: 'aprovado', imagem: img, ...over,
    });
  await mk('art-s1', 'programa-muda-regra');
  await mk('art-s2', 'sem-checagem');
  await app.db.insert(schema.publicationReceipts).values({
    id: 'rc-s1', articleId: 'art-s1', versao: 1, conteudoSha256: sha, checagens: [{ tipo: 'fatos', resultado: 'aprovado' }], aprovador: chefe.id, identidadePublicacao: 'portal',
  });
  // checagem editorial aprovada de art-s1 (fatos com fonte); art-s2 não tem registro editorial
  await new PgEditorialStore(app.db).putArticle(sampleArticle('art-s1', { status: 'aprovado' }));
}, 120_000);
afterAll(async () => {
  await app.close();
  resetPublisherForTest();
});

describe('sessão e RBAC do Social', () => {
  it('sem sessão 401; comercial e leitor barrados; revisor só lê; editor gera mas não pede publicação; editor-chefe faz tudo', async () => {
    expect((await call(d, 'GET', { path: S('/summary') })).status).toBe(401);
    expect((await call(d, 'GET', { path: S('/summary'), as: comercial })).status).toBe(403);
    expect((await call(d, 'GET', { path: S('/summary'), as: leitor })).status).toBe(403);
    expect((await call(d, 'GET', { path: S('/summary'), as: revisor })).status).toBe(200);
    expect((await call(d, 'POST', { path: S('/packages'), body: { articleId: 'art-s1' }, as: revisor })).status).toBe(403);
    expect((await call(d, 'POST', { path: S('/packages/art-s1:linkedin:v1/publish-simulated'), as: editor })).status).toBe(403);
    expect((await call(d, 'GET', { path: S('/nada'), as: chefe })).status).toBe(404);
    expect((await call(d, 'GET', { path: S('/packages'), as: chefe })).status).toBe(405);
  });
});

describe('painel: sempre simulado, sem métrica inventada', () => {
  it('resumo: modo simulado, canais com flag desligada, marca ainda proposta, métricas indisponíveis', async () => {
    const r = await call(d, 'GET', { path: S('/summary'), as: editor });
    expect(r.status).toBe(200);
    expect(r.body.note).toMatch(/simulado/i);
    expect(r.body.channels.every((c: any) => c.mode === 'simulado')).toBe(true);
    expect(r.body.channels.find((c: any) => c.channel === 'linkedin').flagEnabled).toBe(false);
    expect(r.body.metrics.available).toBe(false);
    expect(getPublisher().mode).toBe('simulated');
  });
});

describe('geração e publicação simulada de pacotes', () => {
  const pid = 'art-s1:linkedin:v1';

  it('gera de forma idempotente a partir da matéria do banco; guarda no PostgreSQL; valida entrada', async () => {
    const g = await call(d, 'POST', { path: S('/packages'), body: { articleId: 'art-s1', channels: ['linkedin'] }, as: editor });
    expect(g.status).toBe(201);
    expect(g.body.created).toEqual([pid]);
    const [row] = await app.db.select().from(schema.socialPackages).where(eq(schema.socialPackages.id, pid));
    expect(row).toMatchObject({ articleId: 'art-s1', channel: 'linkedin' });
    const again = await call(d, 'POST', { path: S('/packages'), body: { articleId: 'art-s1' }, as: editor });
    expect(again.status).toBe(200);
    expect(again.body.existing).toEqual([pid]);
    expect(await app.db.$count(schema.socialPackages)).toBe(1);
    expect((await call(d, 'POST', { path: S('/packages'), body: { articleId: 'nao-existe' }, as: editor })).status).toBe(404);
    expect((await call(d, 'POST', { path: S('/packages'), body: { articleId: 'art-s1', channels: ['the_loyal'] }, as: editor })).status).toBe(422);
    expect((await call(d, 'POST', { path: S('/packages'), body: {}, as: editor })).status).toBe(400);
  });

  it('matéria sem fato aprovado pela checagem não vira post (registro falhou, nunca silêncio)', async () => {
    const g = await call(d, 'POST', { path: S('/packages'), body: { articleId: 'art-s2' }, as: editor });
    expect(g.status).toBe(201);
    expect(g.body.failed).toEqual(['art-s2:linkedin:v1']);
    const one = await call(d, 'GET', { path: S('/packages/art-s2:linkedin:v1'), as: revisor });
    expect(one.body.status).toBe('falhou');
    expect(one.body.blockers.length).toBeGreaterThan(0);
  });

  it('consulta: pacote por id, fila filtrada (cursor e limite como texto), id inválido 400', async () => {
    const one = await call(d, 'GET', { path: S(`/packages/${pid}`), as: revisor });
    expect(one.status).toBe(200);
    expect(one.body.summary.copyText).toContain('Redação Loyalty News');
    const q = await call(d, 'GET', { path: S('/queue'), query: { limit: '1', channel: 'linkedin' }, as: revisor });
    expect(q.status).toBe(200);
    expect(q.body.items).toHaveLength(1);
    expect(q.body.total).toBe(2);
    expect((await call(d, 'GET', { path: S('/packages/xyz'), as: revisor })).status).toBe(400);
    expect((await call(d, 'GET', { path: S('/packages/zz:linkedin:v1'), as: revisor })).status).toBe(404);
    expect((await call(d, 'GET', { path: S('/queue'), query: { limit: '999' }, as: revisor })).status).toBe(400);
  });

  it('pedido de publicação é SIMULADO: recibo SIM-…, nada sai para o mLabs; repetir não duplica; fica no banco', async () => {
    const p = await call(d, 'POST', { path: S(`/packages/${pid}/publish-simulated`), as: chefe });
    expect(p.status).toBe(200);
    expect(p.body.receipt.id).toMatch(/^SIM-/);
    expect(p.body.receipt.simulated).toBe(true);
    expect(p.body.record.status).toBe('simulado');
    const again = await call(d, 'POST', { path: S(`/packages/${pid}/publish-simulated`), as: admin });
    expect(again.status).toBe(200);
    expect(again.body.record.receipts).toHaveLength(1);
    const [row] = await app.db.select().from(schema.socialPackages).where(eq(schema.socialPackages.id, pid));
    expect((row!.record as any).receipts[0].simulated).toBe(true);
    const rc = await call(d, 'GET', { path: S('/receipts'), as: revisor });
    expect(rc.body.simulatedOnly).toBe(true);
    expect(rc.body.items).toHaveLength(1);
    const au = await call(d, 'GET', { path: S('/audit'), query: { limit: '10' }, as: revisor });
    expect(au.status).toBe(200);
    expect(au.body.items.length).toBeGreaterThan(0);
  });

  it('matéria alterada depois da geração: pacote obsoleto (409); pacote com falha não publica; Instagram desligado é recusado e registrado', async () => {
    expect((await call(d, 'POST', { path: S('/packages/art-s2:linkedin:v1/publish-simulated'), as: chefe })).body.error.code).toBe('PACKAGE_FAILED');
    await call(d, 'POST', { path: S('/packages'), body: { articleId: 'art-s1', channels: ['instagram'] }, as: editor });
    const ig = await call(d, 'POST', { path: S('/packages/art-s1:instagram:v1/publish-simulated'), as: chefe });
    expect(ig.status).toBeGreaterThanOrEqual(400);
    const rec = await call(d, 'GET', { path: S('/packages/art-s1:instagram:v1'), as: revisor });
    expect(['recusado', 'bloqueado', 'gerado']).toContain(rec.body.status);
    await app.db.update(schema.articles).set({ titulo: 'Título totalmente diferente da matéria revisada' }).where(eq(schema.articles.id, 'art-s1'));
    await call(d, 'POST', { path: S('/packages'), body: { articleId: 'art-s1', version: 2 }, as: editor });
    const stale = await call(d, 'POST', { path: S(`/packages/${pid}/publish-simulated`), as: chefe });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('PACKAGE_STALE');
  });

  it('não existe rota de publicação real', () => {
    expect(SOCIAL_ROUTES.filter((r) => /live|real/i.test(r.path))).toHaveLength(0);
    expect(SOCIAL_ROUTES.filter((r) => r.method === 'POST').map((r) => r.path.replace('/api/studio/social', '')).sort()).toEqual(['/packages', '/packages/:id/publish-simulated']);
  });
});

describe('URL canônica da matéria nos posts', () => {
  it('portalArticleUrl: base NEXT_PUBLIC_SITE_URL + /noticia/{slug}, sem barra dupla e com slug escapado', () => {
    expect(portalArticleUrl('https://loyalty.example', 'a-b')).toBe('https://loyalty.example/noticia/a-b');
    expect(portalArticleUrl('https://loyalty.example///', 'a-b')).toBe('https://loyalty.example/noticia/a-b');
    expect(portalArticleUrl(' http://localhost:3000/ ', 'x y')).toBe('http://localhost:3000/noticia/x%20y');
  });

  it('o pacote gerado aponta para /noticia/{slug} na base do portal (e não usa PORTAL_BASE_URL nem /materias)', async () => {
    const old = { site: process.env.NEXT_PUBLIC_SITE_URL, portal: process.env.PORTAL_BASE_URL };
    process.env.NEXT_PUBLIC_SITE_URL = 'https://loyalty.example';
    process.env.PORTAL_BASE_URL = 'https://errado.example';
    try {
      const g = await call(d, 'POST', { path: S('/packages'), body: { articleId: 'art-s1', version: 7 }, as: editor });
      expect(g.status).toBe(201);
      const one = await call(d, 'GET', { path: S('/packages/art-s1:linkedin:v7'), as: revisor });
      const text = one.body.summary.copyText as string;
      expect(text).toContain('https://loyalty.example/noticia/programa-muda-regra');
      expect(text).not.toContain('errado.example');
      expect(text).not.toContain('/materias/');
    } finally {
      if (old.site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = old.site;
      if (old.portal === undefined) delete process.env.PORTAL_BASE_URL; else process.env.PORTAL_BASE_URL = old.portal;
    }
  });
});
