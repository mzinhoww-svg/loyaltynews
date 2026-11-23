/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FLAG_DEFAULTS } from '@ln/contracts';
import { sampleArticle } from '@ln/editorial/testing';
import { draftContentSha256, type ArticleRecord } from '@ln/editorial';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp, seedEvidence } from '../_lib/testkit';
import * as materiasRoute from '../materias/route';
import * as transicaoRoute from '../materias/[id]/transicao/route';
import * as recibosRoute from '../materias/[id]/recibos/route';
import * as pubList from '../publico/materias/route';
import * as pubOne from '../publico/materias/[slug]/route';
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

async function seed(id: string, publisher = chefe.id, rec: ArticleRecord = approved(id), receiptSha?: string) {
  await app.db.insert(schema.articles).values({ id, slug: id, titulo: 'Título', editoria: 'pontos', corpo: 'Corpo', resumo: 'Resumo', status: 'aprovado' });
  await app.db.insert(schema.publicationReceipts).values({
    id: `rc-${id}`, articleId: id, versao: 1, conteudoSha256: receiptSha ?? draftContentSha256(rec.draft!), checagens: [{ tipo: 'fatos', resultado: 'aprovado' }], aprovador: chefe.id, identidadePublicacao: publisher,
  });
  await store.putArticle(rec);
}
const nothingPublished = async (id: string) => {
  expect((await store.getArticle(id))?.status).toBe('aprovado');
  expect((await store.listAudit()).filter((a) => a.target === id && a.action === 'article.published')).toHaveLength(0);
  expect((await store.listOutbox()).filter((o) => o.refId === id)).toHaveLength(0);
};

beforeAll(async () => {
  app = await makeApp({ publicacaoPortal: true });
  store = new PgEditorialStore(app.db);
  [chefe, admin, editor, revisor] = [await app.actor('editor_chefe'), await app.actor('admin'), await app.actor('editor'), await app.actor('revisor')];
}, 120_000);
afterAll(async () => {
  setStoreFactoryForTest(null);
  await app.close();
});

describe('registro da publicação: portões', () => {
  it('flag publicacaoPortal desligada por padrão no contrato; desligada, nada é lido nem gravado; publicacaoAutonoma sozinha NÃO libera a rota (ADR-017)', async () => {
    expect(FLAG_DEFAULTS.publicacaoPortal).toBe(false);
    expect(FLAG_DEFAULTS.publicacaoAutonoma).toBe(false);
    await seed('p-off');
    app.deps.flags.publicacaoPortal = false;
    app.deps.flags.publicacaoAutonoma = true; // só a de agentes ligada: não basta
    try {
      const r = await call(d, 'POST', { path: P('p-off'), body: body('p-off'), as: chefe });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('FEATURE_DISABLED');
      expect(r.body.error.message).toContain('publicacaoPortal');
    } finally {
      app.deps.flags.publicacaoPortal = true;
      app.deps.flags.publicacaoAutonoma = false;
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

describe('recibo prova a versão e o conteúdo aprovados (achado do QA 2 em 283e1e6)', () => {
  it('recibo de versão antiga: 409 RECEIPT_STALE, nada gravado; o recibo da versão atual publica', async () => {
    await seed('p-ver');
    await app.db.update(schema.articles).set({ versao: 2 }).where(eq(schema.articles.id, 'p-ver')); // matéria seguiu para a versão 2
    const old = await call(d, 'POST', { path: P('p-ver'), body: body('p-ver'), as: chefe });
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe('RECEIPT_STALE');
    expect(old.body.error.details).toEqual({ versaoDoRecibo: 1, versaoDaMateria: 2 });
    await nothingPublished('p-ver');
    await app.db.insert(schema.publicationReceipts).values({
      id: 'rc-p-ver-2', articleId: 'p-ver', versao: 2, conteudoSha256: draftContentSha256((await store.getArticle('p-ver'))!.draft!),
      checagens: [{ tipo: 'fatos', resultado: 'aprovado' }], aprovador: chefe.id, identidadePublicacao: chefe.id,
    });
    const ok = await call(d, 'POST', { path: P('p-ver'), body: body('p-ver', { receiptId: 'rc-p-ver-2' }), as: chefe });
    expect(ok.status).toBe(201);
    expect((await store.getArticle('p-ver'))?.publication?.receiptId).toBe('rc-p-ver-2');
  });

  it('sha divergente (recibo de outro conteúdo): 409 RECEIPT_CONTENT_MISMATCH, nada gravado', async () => {
    await seed('p-sha', chefe.id, approved('p-sha'), 'c'.repeat(64));
    const r = await call(d, 'POST', { path: P('p-sha'), body: body('p-sha'), as: chefe });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RECEIPT_CONTENT_MISMATCH');
    expect(JSON.stringify(r.body)).not.toContain('c'.repeat(64)); // não devolve hash
    await nothingPublished('p-sha');
  });

  it('corpo alterado depois do recibo: 409 RECEIPT_CONTENT_MISMATCH (o recibo era do texto antigo)', async () => {
    await seed('p-edit');
    const rec = (await store.getArticle('p-edit'))!;
    await store.putArticle({ ...rec, draft: { ...rec.draft!, body: `${rec.draft!.body}

Trecho acrescentado depois da aprovação.` } });
    const r = await call(d, 'POST', { path: P('p-edit'), body: body('p-edit'), as: chefe });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RECEIPT_CONTENT_MISMATCH');
    await nothingPublished('p-edit');
  });

  it('caso válido: versão e sha batem com a chave do outbox article.published:{id}:{sha}', async () => {
    await seed('p-valid');
    const sha256 = draftContentSha256((await store.getArticle('p-valid'))!.draft!);
    const r = await call(d, 'POST', { path: P('p-valid'), body: body('p-valid'), as: chefe });
    expect(r.status).toBe(201);
    const [rcpt] = await app.db.select().from(schema.publicationReceipts).where(eq(schema.publicationReceipts.id, 'rc-p-valid'));
    expect(rcpt).toMatchObject({ versao: 1, conteudoSha256: sha256 });
    expect((await store.listOutbox()).find((o) => o.refId === 'p-valid')?.idempotencyKey).toBe(`article.published:p-valid:${sha256}`);
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

describe('ADR-017 ponta a ponta: recibo emitido pelo endpoint REAL → rota de publicação', () => {
  /** Matéria criada pela API (id do servidor), em checagem; rascunho aprovado no CMS editorial com o MESMO id; recibo pelo endpoint real. */
  async function setupE2e(tag: string) {
    const [ev] = await seedEvidence(app.db, 1);
    const created = await call(materiasRoute.POST, 'POST', {
      path: '/api/materias', as: editor,
      body: { slug: `e2e-${tag}`, titulo: 'Título da matéria', editoria: 'pontos', corpo: 'Corpo.', resumo: 'Resumo curto.', evidenceIds: [ev] },
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect((await call(transicaoRoute.POST, 'POST', { params: { id }, body: { para: 'em_checagem' }, as: chefe })).status).toBe(200);
    await store.putArticle(approved(id)); // mesmo id no CMS editorial e em articles (ADR-017, decisão 2)
    const rc = await call(recibosRoute.POST, 'POST', {
      params: { id }, as: chefe,
      body: { versao: 1, checagens: [{ tipo: 'fatos', resultado: 'aprovado', autorModelo: 'openai' }] },
    });
    expect(rc.status, JSON.stringify(rc.body)).toBe(201);
    return { id, receipt: rc.body.data as { id: string; conteudoSha256: string; identidadePublicacao: string } };
  }
  const publish = (id: string, receiptId: string) => call(d, 'POST', { path: P(id), body: { receiptId, url: `${URL_PUB}-${id}` }, as: chefe });

  it('o recibo do endpoint real carrega o hash do RASCUNHO e a rota de publicação o aceita; o mesmo sha vai na chave do outbox e em publication', async () => {
    const { id, receipt } = await setupE2e('ok');
    const draft = (await store.getArticle(id))!.draft!;
    expect(receipt.conteudoSha256).toBe(draftContentSha256(draft));
    expect(receipt.identidadePublicacao).toBe(chefe.id);
    const r = await publish(id, receipt.id);
    expect(r.status).toBe(201);
    const rec = await store.getArticle(id);
    expect(rec?.status).toBe('publicado');
    expect(rec?.publication?.contentSha256).toBe(receipt.conteudoSha256);
    expect((await store.listOutbox()).find((o) => o.refId === id)?.idempotencyKey).toBe(`article.published:${id}:${receipt.conteudoSha256}`);
    expect((await publish(id, receipt.id)).status).toBe(200); // repetição idempotente
  });

  it('manchete trocada DEPOIS do recibo: 409 e nada publicado; reemitir recibo da mesma versão com outro conteúdo também é recusado', async () => {
    const { id, receipt } = await setupE2e('titulo');
    const rec = (await store.getArticle(id))!;
    await store.putArticle({ ...rec, draft: { ...rec.draft!, headline: 'Manchete trocada depois da aprovação' } });
    const r = await publish(id, receipt.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RECEIPT_CONTENT_MISMATCH');
    await nothingPublished(id);
    // reemitir com o conteúdo NOVO é uma nova versão da projeção: a versão antiga informada é recusada
    const stale = await call(recibosRoute.POST, 'POST', { params: { id }, body: { versao: 1, checagens: [{ tipo: 'fatos', resultado: 'aprovado' }] }, as: chefe });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_MISMATCH');
    expect(stale.body.error.details).toEqual({ versaoAtual: 2 });
    const fresh = await call(recibosRoute.POST, 'POST', { params: { id }, body: { checagens: [{ tipo: 'fatos', resultado: 'aprovado' }] }, as: chefe });
    expect(fresh.status).toBe(201);
    expect(fresh.body.data.versao).toBe(2);
    // o recibo antigo (versão 1) não publica mais; o novo publica
    const old = await publish(id, receipt.id);
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe('RECEIPT_STALE');
    expect((await publish(id, fresh.body.data.id)).status).toBe(201);
  });

  it('imagem trocada (inclusive para base de direito pendente) DEPOIS do recibo: 409 e nada publicado', async () => {
    const { id, receipt } = await setupE2e('imagem');
    const rec = (await store.getArticle(id))!;
    await store.putArticle({
      ...rec,
      draft: { ...rec.draft!, image: { mode: 'source_image', sourceId: 'mock-ri', url: 'https://example.org/outra.jpg', credit: 'Outra fonte', creditLink: 'https://example.org', basis: null } },
    });
    const r = await publish(id, receipt.id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('RECEIPT_CONTENT_MISMATCH');
    await nothingPublished(id);
  });

  it('id único (decisão 2): recibo de OUTRA matéria é recusado; o id da publicação é o do CMS editorial', async () => {
    const a = await setupE2e('id-a');
    const b = await setupE2e('id-b');
    const wrong = await publish(b.id, a.receipt.id); // recibo da matéria A na matéria B
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('RECEIPT_NOT_FOUND');
    await nothingPublished(b.id);
    expect((await publish(b.id, b.receipt.id)).status).toBe(201);
    expect((await store.getArticle(b.id))?.articleId).toBe(b.id);
    expect((await app.db.select().from(schema.articles).where(eq(schema.articles.id, b.id)))).toHaveLength(1);
  });
});

describe('ADR-017 §4: articles é a projeção do conteúdo APROVADO (recibo → upsert; publicação → publicado)', () => {
  const draftOf = async (id: string) => (await store.getArticle(id))!.draft!;
  const publish = (id: string, receiptId: string) => call(d, 'POST', { path: P(id), body: { receiptId, url: `${URL_PUB}-${id}` }, as: chefe });
  const rcpt = (id: string) => call(recibosRoute.POST, 'POST', { params: { id }, body: { checagens: [{ tipo: 'fatos', resultado: 'aprovado', autorModelo: 'openai' }] }, as: chefe });
  const articleRow = async (id: string) => (await app.db.select().from(schema.articles).where(eq(schema.articles.id, id)))[0];

  it('a emissão cria articles a partir do RASCUNHO (id = articleId, slug, status aprovado, campos publicáveis, versão 1), liga as fontes e emite o recibo; sem articles prévio', async () => {
    const id = 'proj-ok';
    await store.putArticle(approved(id));
    expect(await articleRow(id)).toBeUndefined(); // o rascunho existe antes da 1ª linha em articles
    const r = await rcpt(id);
    expect(r.status).toBe(201);
    const d = await draftOf(id);
    expect(await articleRow(id)).toMatchObject({
      id, slug: d.slug, titulo: d.headline, corpo: d.body, resumo: d.resumo, editoria: d.editoria, status: 'aprovado', versao: 1,
      tipoConteudo: 'noticia', classeDeDado: 'public', patrocinado: false, assinatura: 'Redação Loyalty News',
    });
    expect(r.body.data).toMatchObject({ articleId: id, versao: 1, conteudoSha256: draftContentSha256(d), aprovador: chefe.id });
    const links = await app.db.select().from(schema.articleSources).where(eq(schema.articleSources.articleId, id));
    expect(links.length).toBeGreaterThan(0);
    expect((await app.db.select().from(schema.evidences)).some((e) => e.id === links[0]!.evidenceId)).toBe(true);
  });

  it('rascunho NÃO aprovado ⇒ 409 NOT_APPROVED sem efeito (nada em articles nem em publication_receipts); conteúdo que viola regra ⇒ 422', async () => {
    await store.putArticle(approved('proj-draft', { status: 'em_checagem' }));
    const r = await rcpt('proj-draft');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NOT_APPROVED');
    expect(await articleRow('proj-draft')).toBeUndefined();
    expect(await app.db.$count(schema.publicationReceipts, eq(schema.publicationReceipts.articleId, 'proj-draft'))).toBe(0);
    // imagem sem base de direito (pendente) não vira projeção aprovada
    const pend = approved('proj-img');
    pend.draft!.image = { mode: 'source_image', sourceId: 'mock-ri', url: 'https://example.org/i.jpg', credit: 'Fonte', creditLink: 'https://example.org', basis: null };
    await store.putArticle(pend);
    const g = await rcpt('proj-img');
    expect(g.status).toBe(422);
    expect(g.body.error.details.join(' ')).toMatch(/imagem sem base de direito/);
    expect(await articleRow('proj-img')).toBeUndefined();
  });

  it('emissão idempotente (mesmo conteúdo ⇒ 200, mesmo recibo, sem linhas novas); conteúdo novo ⇒ versão 2; slug repetido noutra matéria ⇒ 409', async () => {
    const id = 'proj-idem';
    await store.putArticle(approved(id));
    const a = await rcpt(id);
    const b = await rcpt(id);
    expect(b.status).toBe(200);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await app.db.$count(schema.publicationReceipts, eq(schema.publicationReceipts.articleId, id))).toBe(1);
    const rec = (await store.getArticle(id))!;
    await store.putArticle({ ...rec, draft: { ...rec.draft!, headline: 'Manchete revisada e reaprovada' } });
    const c = await rcpt(id);
    expect(c.status).toBe(201);
    expect(c.body.data.versao).toBe(2);
    expect(await articleRow(id)).toMatchObject({ versao: 2, titulo: 'Manchete revisada e reaprovada', status: 'aprovado' });
    const dup = approved('proj-slug');
    dup.draft!.slug = (await draftOf(id)).slug;
    await store.putArticle(dup);
    const s = await rcpt('proj-slug');
    expect(s.status).toBe(409);
    expect(await articleRow('proj-slug')).toBeUndefined();
  });

  it('publicação: a projeção vira publicado na MESMA transação (com histórico); depois disso o conteúdo é imutável (reemitir ⇒ 409)', async () => {
    const id = 'proj-pub';
    await store.putArticle(approved(id));
    const r = await rcpt(id);
    expect((await publish(id, r.body.data.id)).status).toBe(201);
    expect(await articleRow(id)).toMatchObject({ status: 'publicado', versao: 1 });
    expect((await articleRow(id))?.publicadoEm?.toISOString()).toBe('2026-11-22T12:00:00.000Z');
    const tr = await app.db.select().from(schema.articleTransitions).where(eq(schema.articleTransitions.articleId, id));
    expect(tr).toMatchObject([{ de: 'aprovado', para: 'publicado', actorId: chefe.id, receiptId: r.body.data.id }]);
    expect((await publish(id, r.body.data.id)).status).toBe(200); // repetição: nada novo
    expect(await app.db.$count(schema.articleTransitions, eq(schema.articleTransitions.articleId, id))).toBe(1);
    const again = await rcpt(id); // o CMS já está 'publicado': não é rascunho aprovado
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOT_APPROVED');
    // CMS reaprovado SEM despublicar (conteúdo novo): a projeção publicada é imutável
    const rec = (await store.getArticle(id))!;
    await store.putArticle({ ...rec, status: 'aprovado', draft: { ...rec.draft!, headline: 'Manchete nova depois de publicada' } });
    const imm = await rcpt(id);
    expect(imm.status).toBe(409);
    expect(imm.body.error.code).toBe('PUBLISHED_IMMUTABLE');
    expect((await articleRow(id))?.titulo).not.toBe('Manchete nova depois de publicada');
  });

  it('falha injetada na publicação desfaz TAMBÉM a projeção: articles continua aprovado', async () => {
    const id = 'proj-fault';
    await store.putArticle(approved(id));
    const r = await rcpt(id);
    setStoreFactoryForTest((db) => {
      const s = new PgEditorialStore(db);
      s.armFault('after_audit');
      return s;
    });
    const f = await publish(id, r.body.data.id);
    setStoreFactoryForTest(null);
    expect(f.status).toBe(500);
    expect((await articleRow(id))?.status).toBe('aprovado');
    expect(await app.db.$count(schema.articleTransitions, eq(schema.articleTransitions.articleId, id))).toBe(0);
    await nothingPublished(id);
    expect((await publish(id, r.body.data.id)).status).toBe(201);
    expect((await articleRow(id))?.status).toBe('publicado');
  });

  it('rotas públicas só leem publicado: aprovado dá 404 e fica fora da lista; depois de publicar aparece, com fontes e sem campos internos', async () => {
    const id = 'proj-public';
    await store.putArticle(approved(id));
    const r = await rcpt(id);
    const slug = (await draftOf(id)).slug;
    const list0 = await call(pubList.GET, 'GET', { path: '/api/publico/materias' });
    expect(list0.body.data.map((m: { slug: string }) => m.slug)).not.toContain(slug);
    expect((await call(pubOne.GET, 'GET', { params: { slug } })).status).toBe(404); // aprovado não é público
    await publish(id, r.body.data.id);
    const list1 = await call(pubList.GET, 'GET', { path: '/api/publico/materias' });
    expect(list1.body.data.map((m: { slug: string }) => m.slug)).toContain(slug);
    const one = await call(pubOne.GET, 'GET', { params: { slug } });
    expect(one.status).toBe(200);
    expect(one.body.data.fontes.length).toBeGreaterThan(0);
    expect(one.body.data.resumo).toBeTruthy();
    for (const k of ['id', 'status', 'classeDeDado', 'versao']) expect(one.body.data[k]).toBeUndefined();
  });
});
