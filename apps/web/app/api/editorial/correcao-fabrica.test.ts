/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleArticle } from '@ln/editorial/testing';
import type { ArticleRecord } from '@ln/editorial';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp } from '../_lib/testkit';
import { dispatchEditorial as d, setStoreFactoryForTest } from '../_lib/editorial';
import * as recibos from '../materias/[id]/recibos/route';
import * as transicao from '../materias/[id]/transicao/route';
import * as pubOne from '../publico/materias/[slug]/route';

// ADR-019 §c.5 (Fábrica): recibo da versão corrigida (prepareCorrection) → publicação oficial (applyCorrection) + projeção em articles.
let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let admin: Awaited<ReturnType<typeof app.actor>>;
let editor: Awaited<ReturnType<typeof app.actor>>;
let n = 0;

const S = (p: string) => `/api/studio/editorial${p}`;
const P = (id: string) => S(`/articles/${id}/publication`);
const URL_PUB = 'https://loyaltynews.example/noticia/materia';
const CHECK = [{ tipo: 'fatos', resultado: 'aprovado', autorModelo: 'openai' }];

function approved(id: string): ArticleRecord {
  const a = sampleArticle(id, { status: 'aprovado' });
  a.evidences = a.evidences.map((e) => ({ ...e, text: 'Texto MOCK. Nas palavras de Pessoa MOCK: texto literal.' }));
  a.factcheck = { provider: 'anthropic', model: 'mock', verdicts: a.draft!.claims.map((c) => ({ claimId: c.id, verdict: 'pass' as const })) };
  return a;
}
const rcpt = (id: string, body: Record<string, unknown> = {}) => call(recibos.POST, 'POST', { params: { id }, body: { checagens: CHECK, ...body }, as: chefe });
const publish = (id: string, receiptId: string, correcao?: unknown, as = chefe) => call(d, 'POST', { path: P(id), body: { receiptId, url: `${URL_PUB}-${id}`, ...(correcao ? { correcao } : {}) }, as });
const row = async (id: string) => (await app.db.select().from(schema.articles).where(eq(schema.articles.id, id)))[0]!;
const outboxOf = async (id: string) => (await app.db.select().from(schema.outbox).where(eq(schema.outbox.refId, id))).map((o) => [o.queue, o.idempotencyKey]).sort();
const transitions = async (id: string) => app.db.select().from(schema.articleTransitions).where(eq(schema.articleTransitions.articleId, id));

/** Matéria da Fábrica PUBLICADA pelo fluxo oficial (recibo editorial → rota de publicação). */
async function publicada() {
  const id = `fab-${++n}`;
  await store.putArticle(approved(id));
  const r = await rcpt(id);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect((await publish(id, r.body.data.id)).status).toBe(201);
  return { id, slug: (await store.getArticle(id))!.draft!.slug, receiptId: r.body.data.id as string, sha: r.body.data.conteudoSha256 as string };
}
async function acceptedCase(articleId: string) {
  const o = await call(d, 'POST', { path: S('/corrections'), body: { articleId, kind: 'erratum', contested: 'afirmação MOCK', requester: { name: 'Redação', channel: 'internal' } }, as: chefe });
  expect(o.status, JSON.stringify(o.body)).toBe(201);
  const id = (o.body.id ?? o.body.correctionId) as string;
  expect((await call(d, 'POST', { path: S(`/corrections/${id}/preserve-evidence`), body: { url: 'https://loyaltynews.example/noticia/x', body: 'pagina' }, as: chefe })).status).toBe(200);
  const t = await call(d, 'POST', {
    path: S(`/corrections/${id}/triage`),
    body: { accepted: true, reason: 'Procede.', corrected: 'afirmação MOCK corrigida', claims: [{ id: 'c1', text: 'afirmação corrigida', kind: 'fact', evidenceIds: ['ev_1'] }] },
    as: chefe,
  });
  expect(t.status, JSON.stringify(t.body)).toBe(200);
  return id;
}
/** Rascunho corrigido a partir do publicado (sem bloco Avisos) + checagem de outro provedor. */
async function correcao(articleId: string, casoId: string, over: Record<string, unknown> = {}) {
  const rec = (await store.getArticle(articleId))!;
  const draft = { ...rec.draft!, body: rec.draft!.body.replace('Corpo MOCK.', 'Corpo MOCK corrigido.'), ...over };
  return { casoId, draft, factcheck: { provider: 'anthropic', model: 'mock', verdicts: draft.claims.map((c: any) => ({ claimId: c.id, verdict: 'pass' })) } };
}

beforeAll(async () => {
  app = await makeApp({ publicacaoPortal: true });
  store = new PgEditorialStore(app.db);
  [chefe, admin, editor] = [await app.actor('editor_chefe'), await app.actor('admin'), await app.actor('editor')];
}, 120_000);
afterAll(async () => {
  setStoreFactoryForTest(null);
  await app.close();
});

describe('recibo da versão corrigida (prepareCorrection)', () => {
  it('recusas sem efeito: caso inexistente 404, de outra matéria 409, não aceito 409, Avisos no rascunho 400, slug trocado 409, checagem do mesmo provedor 422', async () => {
    const a = await publicada();
    const b = await publicada();
    const caso = await acceptedCase(a.id);
    const casoB = await acceptedCase(b.id);
    const aberto = await call(d, 'POST', { path: S('/corrections'), body: { articleId: a.id, kind: 'erratum', contested: 'x trecho', requester: { name: 'Redação', channel: 'internal' } }, as: chefe });
    const antes = await app.db.$count(schema.publicationReceipts);

    const falhas: [string, any, number][] = [
      ['CASE_NOT_FOUND', await correcao(a.id, 'nao-existe'), 404],
      ['CASE_MISMATCH', await correcao(a.id, casoB), 409],
      ['CASE_NOT_ACCEPTED', await correcao(a.id, aberto.body.id ?? aberto.body.correctionId), 409],
      ['NOTICES_IN_DRAFT', await correcao(a.id, caso, { body: 'Corpo.\n\nAvisos:\n- inventado\n\nFontes:\n- MOCK: https://ri.mock.example/a' }), 400],
      ['SLUG_IMMUTABLE', await correcao(a.id, caso, { slug: 'outro-slug' }), 409],
    ];
    for (const [code, corr, status] of falhas) {
      const r = await rcpt(a.id, { correcao: corr });
      expect(r.status, code).toBe(status);
      expect(r.body.error.code).toBe(code);
    }
    const mesmo = await correcao(a.id, caso);
    mesmo.factcheck = { ...mesmo.factcheck, provider: 'deepseek' };
    const fc = await rcpt(a.id, { correcao: mesmo });
    expect(fc.status).toBe(422);
    expect(fc.body.error.code).toBe('FACTCHECK_FAILED');
    expect(await app.db.$count(schema.publicationReceipts)).toBe(antes);
    expect((await row(a.id)).versao).toBe(1);
  });

  it('entrada estrita: campos extras no rascunho/correção e correcao em matéria do CMS são recusados', async () => {
    const a = await publicada();
    const caso = await acceptedCase(a.id);
    const c = await correcao(a.id, caso);
    expect((await rcpt(a.id, { correcao: { ...c, extra: 1 } })).status).toBe(400);
    expect((await rcpt(a.id, { correcao: { ...c, draft: { ...c.draft, extra: 1 } } })).status).toBe(400);
    // matéria só do CMS
    await app.db.insert(schema.articles).values({ id: 'so-cms', slug: 'so-cms', titulo: 'T', editoria: 'pontos', corpo: 'C', resumo: 'R', status: 'publicado', publicadoEm: new Date() });
    const r = await rcpt('so-cms', { correcao: c });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NOT_FACTORY_ARTICLE');
    expect((await publish('so-cms', 'qualquer', c)).status).toBeGreaterThanOrEqual(409);
  });
});

describe('publicação oficial da correção (applyCorrection + projeção)', () => {
  it('fluxo completo: recibo v2 com o hash composto → publicação ⇒ corrigido, aviso no corpo, publicadoEm original, outbox article.corrected, caso notice_published, errata pública; repetir é idempotente', async () => {
    const a = await publicada();
    const original = await row(a.id);
    const caso = await acceptedCase(a.id);
    const corr = await correcao(a.id, caso);
    const r = await rcpt(a.id, { correcao: corr });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.versao).toBe(2);
    expect(r.body.data.conteudoSha256).not.toBe(a.sha);
    expect((await rcpt(a.id, { correcao: corr })).status).toBe(200); // idempotente: mesmo conteúdo, mesmo recibo
    // a página segue com o conteúdo publicado até a publicação
    expect((await call(pubOne.GET, 'GET', { params: { slug: a.slug } })).body.data.corpo).toBe(original.corpo);

    const p = await publish(a.id, r.body.data.id, corr);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body).toMatchObject({ articleId: a.id, status: 'corrigido', outbox: 'enqueued', alreadyPublished: false });
    const depois = await row(a.id);
    expect(depois).toMatchObject({ status: 'corrigido', versao: 2 });
    expect(depois.publicadoEm?.toISOString()).toBe(original.publicadoEm?.toISOString());
    expect(depois.corpo).toContain('Corpo MOCK corrigido.');
    expect(depois.corpo).toContain('Avisos:');
    const rec = (await store.getArticle(a.id))!;
    expect(rec).toMatchObject({ status: 'corrigido', publication: { receiptId: r.body.data.id, contentSha256: r.body.data.conteudoSha256 } });
    expect(rec.notices).toHaveLength(1);
    expect(depois.corpo).toContain(rec.notices![0]!.text.split('\n')[0]!);
    expect(await outboxOf(a.id)).toEqual([['article-corrected', `article.corrected:${a.id}:${r.body.data.conteudoSha256}`], ['intelligence-ingest', `article.published:${a.id}:${a.sha}`]].sort());
    expect((await store.getCorrection(caso))?.case.state).toBe('notice_published');
    const corrigidas = (await transitions(a.id)).filter((t) => t.para === 'corrigido');
    expect(corrigidas).toMatchObject([{ de: 'publicado', receiptId: r.body.data.id, actorId: chefe.id, nota: rec.notices![0]!.text }]);
    const pub = await call(pubOne.GET, 'GET', { params: { slug: a.slug } });
    expect(pub.body.data.corpo).toContain('Corpo MOCK corrigido.');
    expect(pub.body.data.erratas).toHaveLength(1);

    const again = await publish(a.id, r.body.data.id, corr);
    expect(again.status).toBe(200);
    expect(again.body.alreadyPublished).toBe(true);
    expect((await transitions(a.id)).filter((t) => t.para === 'corrigido')).toHaveLength(1);
    expect(await outboxOf(a.id)).toHaveLength(2);
    expect((await row(a.id)).versao).toBe(2);
  });

  it('portões: flag desligada 403; identidade do recibo; papel; recibo da versão antiga; hash que não bate; sem correcao a rota normal não corrige — sem efeito', async () => {
    const a = await publicada();
    const caso = await acceptedCase(a.id);
    const corr = await correcao(a.id, caso);
    const r = await rcpt(a.id, { correcao: corr, identidadePublicacao: admin.id });
    const semEfeito = async () => {
      expect(await row(a.id)).toMatchObject({ status: 'publicado', versao: 1 });
      expect(await outboxOf(a.id)).toEqual([['intelligence-ingest', `article.published:${a.id}:${a.sha}`]]);
      expect((await store.getCorrection(caso))?.case.state).toBe('accepted');
    };
    app.deps.flags.publicacaoPortal = false;
    try {
      expect((await publish(a.id, r.body.data.id, corr, admin)).body.error.code).toBe('FEATURE_DISABLED');
    } finally {
      app.deps.flags.publicacaoPortal = true;
    }
    expect((await publish(a.id, r.body.data.id, corr, chefe)).body.error.code).toBe('NOT_PUBLISHER_IDENTITY');
    expect((await publish(a.id, r.body.data.id, corr, editor)).status).toBe(403);
    // recibo da versão ANTIGA com correcao: não é versão nova
    expect((await publish(a.id, a.receiptId, corr, chefe)).body.error.code).toBe('RECEIPT_STALE');
    // rascunho diferente do que o recibo provou
    const outro = await correcao(a.id, caso, { headline: 'Manchete trocada depois do recibo' });
    const adult = await publish(a.id, r.body.data.id, outro, admin);
    expect(adult.status).toBe(409);
    expect(adult.body.error.code).toBe('RECEIPT_CONTENT_MISMATCH');
    // sem correcao, a rota de publicação não publica o recibo da nova versão
    expect((await publish(a.id, r.body.data.id, undefined, admin)).status).toBeGreaterThanOrEqual(409);
    // e a rota genérica de transição continua recusando
    expect((await call(transicao.POST, 'POST', { params: { id: a.id }, body: { para: 'corrigido', nota: 'Errata fora do fluxo oficial.' }, as: chefe })).status).toBeGreaterThanOrEqual(403);
    await semEfeito();
  });

  it('falha no meio da aplicação desfaz TUDO (matéria, projeção, auditoria, outbox e caso) e a repetição conclui', async () => {
    const a = await publicada();
    const caso = await acceptedCase(a.id);
    const corr = await correcao(a.id, caso);
    const r = await rcpt(a.id, { correcao: corr });
    setStoreFactoryForTest((db) => {
      const s = new PgEditorialStore(db);
      s.armFault('after_audit');
      return s;
    });
    const f = await publish(a.id, r.body.data.id, corr);
    setStoreFactoryForTest(null);
    expect(f.status).toBe(500);
    expect(await row(a.id)).toMatchObject({ status: 'publicado', versao: 1 });
    expect((await store.getArticle(a.id))?.status).toBe('publicado');
    expect((await store.getCorrection(caso))?.case.state).toBe('accepted');
    expect((await transitions(a.id)).filter((t) => t.para === 'corrigido')).toHaveLength(0);
    expect(await outboxOf(a.id)).toHaveLength(1);
    expect((await publish(a.id, r.body.data.id, corr)).status).toBe(201);
    expect((await row(a.id)).status).toBe('corrigido');
  });

  it('segunda correção: o aviso anterior permanece no corpo (versão 3, dois avisos) e o caso já aplicado não se repete (o caso avançou)', async () => {
    const a = await publicada();
    const caso1 = await acceptedCase(a.id);
    const c1 = await correcao(a.id, caso1);
    const r1 = await rcpt(a.id, { correcao: c1 });
    expect((await publish(a.id, r1.body.data.id, c1)).status).toBe(201);
    const aviso1 = (await store.getArticle(a.id))!.notices![0]!.text;

    const caso2 = await acceptedCase(a.id);
    const rec = (await store.getArticle(a.id))!;
    const c2 = await correcao(a.id, caso2, { body: rec.draft!.body.replace(/\n*Avisos:[\s\S]*?(?=\n*Fontes:)/, '').replace('Corpo MOCK corrigido.', 'Corpo MOCK corrigido de novo.') });
    const r2 = await rcpt(a.id, { correcao: c2 });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(r2.body.data.versao).toBe(3);
    expect((await publish(a.id, r2.body.data.id, c2)).status).toBe(201);
    const fim = await row(a.id);
    expect(fim).toMatchObject({ status: 'corrigido', versao: 3 });
    expect(fim.corpo).toContain(aviso1.split('\n')[0]!);
    expect((await store.getArticle(a.id))!.notices).toHaveLength(2);
    expect((await call(pubOne.GET, 'GET', { params: { slug: a.slug } })).body.data.erratas).toHaveLength(2);
    // o mesmo caso não é aplicado de novo com outro recibo
    const again = await rcpt(a.id, { correcao: await correcao(a.id, caso1) });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('CASE_NOT_ACCEPTED'); // o caso já avançou para notice_published
  });
});
