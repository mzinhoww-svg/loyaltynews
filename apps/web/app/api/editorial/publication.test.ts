/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FLAG_DEFAULTS } from '@ln/contracts';
import { sampleArticle } from '@ln/editorial/testing';
import type { ArticleRecord } from '@ln/editorial';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp } from '../_lib/testkit';
import { dispatchEditorial as d, setStoreFactoryForTest } from '../_lib/editorial';

let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let admin: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let revisor: Awaited<ReturnType<typeof app.actor>>;

const URL_PUB = 'https://loyaltynews.example/noticia/materia';
const P = (id: string) => `/api/studio/editorial/articles/${id}/publication`;
const body = (id: string, over: Record<string, unknown> = {}) => ({ receiptId: `rc-${id}`, url: `${URL_PUB}-${id}`, ...over });
const sha = 'b'.repeat(64);

/** Matéria aprovada no CMS que passa o gate refeito (todas as claims 'pass', checagem de outro provedor, citação na evidência). */
function approved(id: string, over: Partial<ArticleRecord> = {}): ArticleRecord {
  const a = sampleArticle(id, { status: 'aprovado', ...over });
  a.evidences = a.evidences.map((e) => ({ ...e, text: 'Texto MOCK. Nas palavras de Pessoa MOCK: texto literal.' }));
  a.factcheck = { provider: 'anthropic', model: 'mock', verdicts: a.draft!.claims.map((c) => ({ claimId: c.id, verdict: 'pass' as const })) };
  return a;
}

async function seed(id: string, publisher = chefe.id, rec: ArticleRecord = approved(id)) {
  await app.db.insert(schema.articles).values({ id, slug: id, titulo: 'Título', editoria: 'pontos', corpo: 'Corpo', resumo: 'Resumo' });
  await app.db.insert(schema.publicationReceipts).values({
    id: `rc-${id}`, articleId: id, versao: 1, conteudoSha256: sha, checagens: [{ tipo: 'fatos', resultado: 'aprovado' }], aprovador: chefe.id, identidadePublicacao: publisher,
  });
  await store.putArticle(rec);
}
const nothingPublished = async (id: string) => {
  expect((await store.getArticle(id))?.status).toBe('aprovado');
  expect((await store.listAudit()).filter((a) => a.target === id && a.action === 'article.published')).toHaveLength(0);
  expect((await store.listOutbox()).filter((o) => o.refId === id)).toHaveLength(0);
};

beforeAll(async () => {
  app = await makeApp({ publicacaoAutonoma: true });
  store = new PgEditorialStore(app.db);
  [chefe, admin, editor, revisor] = [await app.actor('editor_chefe'), await app.actor('admin'), await app.actor('editor'), await app.actor('revisor')];
}, 120_000);
afterAll(async () => {
  setStoreFactoryForTest(null);
  await app.close();
});

describe('registro da publicação: portões', () => {
  it('flag publicacaoAutonoma desligada por padrão no contrato; desligada, nada é lido nem gravado', async () => {
    expect(FLAG_DEFAULTS.publicacaoAutonoma).toBe(false);
    await seed('p-off');
    app.deps.flags.publicacaoAutonoma = false;
    try {
      const r = await call(d, 'POST', { path: P('p-off'), body: body('p-off'), as: chefe });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('FEATURE_DISABLED');
    } finally {
      app.deps.flags.publicacaoAutonoma = true;
    }
    await nothingPublished('p-off');
  });

  it('sem sessão 401; só senha MFA_REQUIRED; editor e revisor barrados (sem materias:publish)', async () => {
    await seed('p-auth');
    expect((await call(d, 'POST', { path: P('p-auth'), body: body('p-auth') })).status).toBe(401);
    const solo = await app.passwordOnly('editor_chefe');
    expect((await call(d, 'POST', { path: P('p-auth'), body: body('p-auth'), as: solo })).body.error.code).toBe('MFA_REQUIRED');
    expect((await call(d, 'POST', { path: P('p-auth'), body: body('p-auth'), as: editor })).status).toBe(403);
    expect((await call(d, 'POST', { path: P('p-auth'), body: body('p-auth'), as: revisor })).status).toBe(403);
    await nothingPublished('p-auth');
  });

  it('entrada inválida (zod): campos faltando, URL não http(s), e campos proibidos (isMock, publishedAt, extras) são recusados', async () => {
    await seed('p-in');
    const bad = [
      {}, { receiptId: 'rc-p-in' }, { url: `${URL_PUB}-p-in` },
      body('p-in', { url: 'javascript:alert(1)' }), body('p-in', { url: 'ftp://x.example/a' }), body('p-in', { receiptId: '  ' }),
      body('p-in', { isMock: true }), body('p-in', { publishedAt: '2020-01-01T00:00:00Z' }), body('p-in', { extra: 1 }),
    ];
    for (const b of bad) {
      const r = await call(d, 'POST', { path: P('p-in'), body: b, as: chefe });
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION_ERROR');
    }
    await nothingPublished('p-in');
  });

  it('recibo inexistente ou de outra matéria: 409; identidade de publicação diferente: 403; matéria inexistente: 409 (sem recibo)', async () => {
    await seed('p-rc', admin.id); // recibo emitido para o admin publicar
    await seed('p-other');
    expect((await call(d, 'POST', { path: P('p-rc'), body: body('p-rc', { receiptId: 'rc-nao-existe' }), as: chefe })).body.error.code).toBe('RECEIPT_NOT_FOUND');
    expect((await call(d, 'POST', { path: P('p-rc'), body: body('p-rc', { receiptId: 'rc-p-other' }), as: chefe })).body.error.code).toBe('RECEIPT_NOT_FOUND');
    const wrong = await call(d, 'POST', { path: P('p-rc'), body: body('p-rc'), as: chefe });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('NOT_PUBLISHER_IDENTITY');
    expect((await call(d, 'POST', { path: P('nao-existe'), body: body('nao-existe'), as: chefe })).status).toBe(409);
    await nothingPublished('p-rc');
  });

  it('matéria não aprovada: 409; gate refeito reprova rascunho adulterado: 409 com achados; nada gravado', async () => {
    await seed('p-draft', chefe.id, approved('p-draft', { status: 'em_checagem' }));
    const nd = await call(d, 'POST', { path: P('p-draft'), body: body('p-draft'), as: chefe });
    expect(nd.status).toBe(409);
    expect(nd.body.error.code).toBe('NOT_APPROVED');

    const tampered = approved('p-gate');
    tampered.draft!.body = tampered.draft!.body.replace('Corpo MOCK.', 'Corpo MOCK. A alta foi de 87%.');
    await seed('p-gate', chefe.id, tampered);
    const g = await call(d, 'POST', { path: P('p-gate'), body: body('p-gate'), as: chefe });
    expect(g.status).toBe(409);
    expect(g.body.error.code).toBe('GATE_FAILED');
    expect(g.body.error.details.length).toBeGreaterThan(0);
    await nothingPublished('p-gate');
    expect((await store.getArticle('p-draft'))?.status).toBe('em_checagem');
  });
});

describe('registro da publicação: sucesso, duplicado e atomicidade', () => {
  it('sucesso: 201; matéria publicada com recibo e data do servidor, auditoria e outbox; sem mock; auditoria do Studio com ator', async () => {
    await seed('p-ok');
    const r = await call(d, 'POST', { path: P('p-ok'), body: body('p-ok'), as: chefe });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ articleId: 'p-ok', status: 'publicado', outbox: 'enqueued', alreadyPublished: false });
    expect(r.body.publication).toMatchObject({ receiptId: 'rc-p-ok', url: `${URL_PUB}-p-ok`, publishedAt: '2026-11-22T12:00:00.000Z' });
    const rec = await store.getArticle('p-ok');
    expect(rec?.status).toBe('publicado');
    expect((rec?.publication as any).isMock).toBeUndefined();
    expect((await store.listAudit()).filter((a) => a.target === 'p-ok' && a.action === 'article.published')).toHaveLength(1);
    const ob = (await store.listOutbox()).filter((o) => o.refId === 'p-ok');
    expect(ob).toEqual([{ queue: 'intelligence-ingest', refId: 'p-ok', idempotencyKey: `article.published:p-ok:${rec!.publication!.contentSha256}` }]);
    const au = await app.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, 'editorial.articles.publication'));
    expect(au.some((a) => a.actorId === chefe.id && a.actorRole === 'editor_chefe')).toBe(true);
  });

  it('duplicado (mesmo recibo e URL): 200 alreadyPublished, sem novo efeito; outro recibo não republica', async () => {
    const again = await call(d, 'POST', { path: P('p-ok'), body: body('p-ok'), as: chefe });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ alreadyPublished: true, outbox: 'duplicate' });
    expect((await store.listAudit()).filter((a) => a.target === 'p-ok' && a.action === 'article.published')).toHaveLength(1);
    expect((await store.listOutbox()).filter((o) => o.refId === 'p-ok')).toHaveLength(1);
    await app.db.insert(schema.publicationReceipts).values({
      id: 'rc-p-ok-2', articleId: 'p-ok', versao: 2, conteudoSha256: sha, checagens: [{ tipo: 'fatos', resultado: 'aprovado' }], aprovador: chefe.id, identidadePublicacao: chefe.id,
    });
    const other = await call(d, 'POST', { path: P('p-ok'), body: body('p-ok', { receiptId: 'rc-p-ok-2' }), as: chefe });
    expect(other.status).toBe(409);
    expect((await store.getArticle('p-ok'))?.publication?.receiptId).toBe('rc-p-ok');
  });

  it('5 pedidos simultâneos: uma publicação, uma auditoria, um outbox', async () => {
    await seed('p-par');
    const rs = await Promise.all(Array.from({ length: 5 }, () => call(d, 'POST', { path: P('p-par'), body: body('p-par'), as: chefe })));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect((await store.listAudit()).filter((a) => a.target === 'p-par' && a.action === 'article.published')).toHaveLength(1);
    expect((await store.listOutbox()).filter((o) => o.refId === 'p-par')).toHaveLength(1);
  });

  it('falha injetada em cada passo desfaz tudo (matéria, auditoria e outbox) e a repetição conclui', async () => {
    await seed('p-fault');
    for (const step of ['after_outbox', 'after_article', 'after_audit'] as const) {
      setStoreFactoryForTest((db) => {
        const s = new PgEditorialStore(db);
        s.armFault(step);
        return s;
      });
      const r = await call(d, 'POST', { path: P('p-fault'), body: body('p-fault'), as: chefe });
      expect(r.status, step).toBe(500);
      expect(r.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(r.body)).not.toContain('falha injetada'); // detalhe interno não vaza
      await nothingPublished('p-fault');
    }
    setStoreFactoryForTest(null);
    const ok = await call(d, 'POST', { path: P('p-fault'), body: body('p-fault'), as: chefe });
    expect(ok.status).toBe(201);
    expect((await store.getArticle('p-fault'))?.status).toBe('publicado');
    expect((await store.listOutbox()).filter((o) => o.refId === 'p-fault')).toHaveLength(1);
  });
});
