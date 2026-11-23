// FÁBRICA EDITORIAL PONTA A PONTA (Frente 06), contra o PostgreSQL de teste (PGlite) e as ROTAS OFICIAIS:
//   habilitar fonte (revisão humana + habilitação, pelas rotas do Studio) → coleta (fetcher MOCK, sem rede) → redação →
//   checagem em provedor distinto (transporte LLM FALSO) → aprovação → recibo (POST /api/materias/:id/recibos) →
//   publicação (POST /api/studio/editorial/articles/:id/publication) → Portal público.
// Nada aqui chama modelo, rede ou serviço real; os dados são MOCK. É o ensaio do roteiro da "primeira matéria real".
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Collector, InMemoryAuditLog, createHttpPublishingPort, createLlmGateway, draftContentSha256, publishApproved, runFactory,
  type ChatRequest, type ChatResult, type ChatTransport, type HttpTransport,
} from '@ln/editorial';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call, makeApp } from '../_lib/testkit';
import * as recibosRoute from '../materias/[id]/recibos/route';
import * as pubOne from '../publico/materias/[slug]/route';
import { dispatchEditorial as d, setStoreFactoryForTest, sourceRegistry } from '../_lib/editorial';
// fixtures MOCK do pacote (não exportadas): importadas por caminho relativo só em teste
import { COLLECT_ON, FakeResolver, MOCK_ARTICLE_ALFA, MockFetcher, MOCK_PUBLIC_IP } from '../../../../../packages/editorial/fixtures/mock-web.mock';
import { goodDraftOutput } from '../../../../../packages/editorial/fixtures/mock-gateway.mock';

let app: Awaited<ReturnType<typeof makeApp>>;
let store: PgEditorialStore;
let chefe: Awaited<ReturnType<typeof app.actor>>;
let admin: Awaited<ReturnType<typeof app.actor>>;

const NOW = new Date('2026-11-25T12:00:00Z');
const SRC = 'bcb'; // fonte REAL do cadastro da Fábrica (seed), todas nascem desabilitadas
const STU = '/api/studio/editorial';
const SITE = 'https://loyaltynews.example';
const PAGE = 'https://www.bcb.gov.br/noticias/alfa-parceria';
const FLAGS = { editorialCollector: true, editorialPipeline: true } as const;

/** Transporte LLM FALSO: JSON por tarefa; o checador responde de outro provedor (excludeProviders). */
class FakeLlm implements ChatTransport {
  calls: ChatRequest[] = [];
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.calls.push(req);
    const ev = /"id":"(ev_[0-9a-f]+)"/.exec(req.messages[1]!.content)?.[1] ?? 'ev_x';
    const out: Record<string, unknown> = {
      triage: { relevant: true, editoria: 'mercado' },
      context: { notes: [] },
      draft: { ...goodDraftOutput(ev), resumo: 'Programa fictício de teste fecha acordo de acúmulo com uma varejista.' },
      factcheck: { verdicts: ['c1', 'c2', 'c3', 'c4'].map((claimId) => ({ claimId, verdict: 'pass' })) },
      review: { approve: true, issues: [] }, social_pack: { linkedin: 'MOCK' }, roles: { mentions: [] },
    };
    return { ok: true, provider: req.excludeProviders.includes('deepseek') ? 'anthropic' : 'deepseek', model: `${req.route}-mock`, text: JSON.stringify(out[req.taskClass]), usage: { inputTokens: 1, outputTokens: 1, costMicrosUsd: 0 } };
  }
}

function web(): MockFetcher {
  const bcb = sourceRegistry.get(SRC)!;
  const html = MOCK_ARTICLE_ALFA.replace('https://ri.mock.example/noticias/alfa-parceria', PAGE);
  const feed = `<rss><channel><item><title>MOCK: Programa Alfa anuncia nova parceria</title><link>${PAGE}</link></item></channel></rss>`;
  return new MockFetcher({ [`https://${bcb.host}/robots.txt`]: 'User-agent: *\nDisallow:', [bcb.feedUrl!]: feed, [PAGE]: html });
}
const collector = () => new Collector(web(), { now: () => NOW, resolver: new FakeResolver({ 'www.bcb.gov.br': [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON });
const factory = (llm: ChatTransport) => ({ store, registry: sourceRegistry, collector: collector(), gateway: createLlmGateway(llm), audit: new InMemoryAuditLog(), flags: FLAGS, now: () => NOW });

/** Transporte HTTP em processo: leva o cliente da Fábrica às rotas oficiais (sessão do operador). */
const transport = (as: typeof chefe): HttpTransport => async (r) => {
  const rec = /^\/api\/materias\/([^/]+)\/recibos$/.exec(r.path);
  const res = rec
    ? await call(recibosRoute.POST, 'POST', { params: { id: decodeURIComponent(rec[1]!) }, body: r.body, as })
    : await call(d, r.method, { path: r.path, body: r.body, as });
  return { status: res.status, body: res.body };
};

beforeAll(async () => {
  app = await makeApp({ publicacaoPortal: true });
  store = new PgEditorialStore(app.db);
  [chefe, admin] = [await app.actor('editor_chefe'), await app.actor('admin')];
}, 120_000);
afterAll(async () => {
  setStoreFactoryForTest(null);
  await app.close();
});

describe('fábrica ponta a ponta (rotas oficiais + PostgreSQL de teste)', () => {
  it('cadastro da Fábrica nasce desabilitado: sem revisão humana nada é coletado', async () => {
    const r = await runFactory(factory(new FakeLlm()));
    expect(r.sources).toEqual([]);
    expect(r.articles).toEqual([]);
    expect(await store.listArticles()).toHaveLength(0);
  });

  it('habilitar a fonte pelas rotas do Studio: revisão humana (≠ pesquisador) e habilitação, persistidas no PostgreSQL', async () => {
    const body = { termsStatus: 'approved', termsNote: 'Termos oficiais lidos pelo revisor responsável (MOCK).', urlVerified: true, robotsChecked: true, paywall: 'none' };
    expect((await call(d, 'POST', { path: `${STU}/sources/${SRC}/review`, body, as: chefe })).status).toBe(200);
    const en = await call(d, 'POST', { path: `${STU}/sources/${SRC}/enabled`, body: { enabled: true }, as: admin });
    expect(en.status).toBe(200);
    expect(en.body.habilitada ?? en.body.data?.habilitada).toBe(true);
    expect((await store.getSourceState(SRC))?.enabled).toBe(true);
  });

  it('coleta → rascunho → checagem em provedor distinto → aprovada, gravada no banco; segunda rodada não repete', async () => {
    const llm = new FakeLlm();
    const r = await runFactory(factory(llm));
    expect(r.haltedBy).toBeNull();
    expect(r.articles).toHaveLength(1);
    expect(r.articles[0]).toMatchObject({ status: 'aprovado', stages: ['triage', 'context', 'draft', 'factcheck', 'review'] });
    const rec = (await store.getArticle(r.articles[0]!.articleId))!;
    expect(rec.status).toBe('aprovado');
    expect(rec.draft!.modelProvider).not.toBe(rec.factcheck!.provider);
    expect(rec.draft!.slug).toBeTruthy();
    expect(llm.calls.map((c) => c.taskClass)).toEqual(['triage', 'context', 'draft', 'factcheck', 'review']);
    expect(llm.calls.find((c) => c.taskClass === 'factcheck')!.excludeProviders).toEqual(['deepseek']);
    // nada em `articles` antes do recibo (articles só guarda conteúdo aprovado/publicado)
    expect(await app.db.select().from(schema.articles).where(eq(schema.articles.id, rec.articleId))).toHaveLength(0);
    const again = await runFactory(factory(llm));
    expect(again.articles).toHaveLength(0);
    expect(llm.calls).toHaveLength(5);
  });

  it('publicação com flag do servidor DESLIGADA: recibo sai, a rota recusa (FEATURE_DISABLED), a rodada para e nada é publicado', async () => {
    const id = (await store.listArticles())[0]!.articleId;
    app.deps.flags.publicacaoPortal = false;
    try {
      const rep = await publishApproved({ store, port: createHttpPublishingPort(transport(chefe)), siteBaseUrl: SITE, flags: { publicacaoPortal: true }, trigger: 'studio' });
      expect(rep.rows[0]).toMatchObject({ articleId: id, outcome: 'failed', code: 'FEATURE_DISABLED' });
      expect(rep.haltedBy).toBe('FEATURE_DISABLED');
    } finally {
      app.deps.flags.publicacaoPortal = true;
    }
    expect((await store.getArticle(id))?.status).toBe('aprovado');
    const slug = (await store.getArticle(id))!.draft!.slug;
    expect((await call(pubOne.GET, 'GET', { params: { slug } })).status).toBe(404);
  });

  it('recibo + publicação pelas rotas oficiais: matéria publicada, hash único, outbox e Portal público', async () => {
    const id = (await store.listArticles())[0]!.articleId;
    // sem as flags do ORQUESTRADOR a fábrica nem tenta (aprovada fica esperando)
    const off = await publishApproved({ store, port: createHttpPublishingPort(transport(chefe)), siteBaseUrl: SITE, flags: {}, trigger: 'studio' });
    expect(off.rows[0]?.outcome).toBe('waiting_flag');
    expect((await store.getArticle(id))?.status).toBe('aprovado');
    // com a flag: recibo e publicação
    const rep = await publishApproved({ store, port: createHttpPublishingPort(transport(chefe)), siteBaseUrl: SITE, flags: { publicacaoPortal: true }, trigger: 'studio' });
    expect(rep.rows[0]).toMatchObject({ articleId: id, outcome: 'published' });
    const rec = (await store.getArticle(id))!;
    expect(rec.status).toBe('publicado');
    expect(rec.publication?.contentSha256).toBe(draftContentSha256(rec));
    expect(rec.publication?.url).toBe(`${SITE}/noticia/${rec.draft!.slug}`);
    const [receipt] = await app.db.select().from(schema.publicationReceipts).where(eq(schema.publicationReceipts.articleId, id));
    expect(receipt?.conteudoSha256).toBe(rec.publication!.contentSha256);
    expect((await store.listOutbox()).some((o) => o.idempotencyKey === `article.published:${id}:${rec.publication!.contentSha256}`)).toBe(true);
    expect((await store.listAudit()).filter((a) => a.target === id && a.action === 'article.published')).toHaveLength(1);
    // Portal público
    const pub = await call(pubOne.GET, 'GET', { params: { slug: rec.draft!.slug } });
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.body)).not.toMatch(/generatedBy|deepseek|anthropic|promptSha256/);
    // repetir a publicação não duplica nada
    const rep2 = await publishApproved({ store, port: createHttpPublishingPort(transport(chefe)), siteBaseUrl: SITE, flags: { publicacaoPortal: true }, trigger: 'studio' });
    expect(rep2.rows).toEqual([]);
    expect((await store.listOutbox()).filter((o) => o.refId === id && o.queue === 'intelligence-ingest')).toHaveLength(1);
  });

  it('o registro do Portal cita a fonte da Fábrica com o mesmo id (origem fabrica) e a evidência coletada', async () => {
    const id = (await store.listArticles())[0]!.articleId;
    const [src] = await app.db.select().from(schema.sources).where(eq(schema.sources.id, SRC));
    expect(src?.origem).toBe('fabrica');
    const links = await app.db.select().from(schema.articleSources).where(eq(schema.articleSources.articleId, id));
    expect(links.length).toBeGreaterThan(0);
  });
});
