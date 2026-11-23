import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  generatePackages, getDashboardSummary, getPackage, listAudit, listQueue, listReceipts, PERMISSIONS,
  requestSimulatedPublish, toSocialArticle, InMemoryPackageStore,
  type ArticleSource, type Caller, type DashboardDeps, type GenerateResult, type QueueResult, type SocialPackageRecord,
} from '../dashboard';
import { DEFAULT_FLAGS } from '../flags';
import { createLiveMlabsAdapter, LIVE_ACK } from '../mlabs/live';
import { SimulatedMlabsAdapter } from '../mlabs/simulated.mock';
import { PUBLISHER_SOCIAL, SocialPublisher } from '../publisher/publisher';
import type { Article } from '../types';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';
import type { ApiError } from '@ln/contracts';

const clockState = { n: 0 };
const now = () => new Date(Date.UTC(2026, 10, 22, 12, 0, clockState.n++)).toISOString();

const ALL: Caller = { id: 'u1', permissions: [PERMISSIONS.read, PERMISSIONS.generate, PERMISSIONS.requestPublish] };
const READER: Caller = { id: 'u2', permissions: [PERMISSIONS.read] };
const NOBODY: Caller = { id: 'u3', permissions: [] };

class MapSource implements ArticleSource {
  items = new Map<string, Article>();
  async get(id: string) {
    const a = this.items.get(id);
    return a ? structuredClone(a) : null;
  }
}

function make(flags = DEFAULT_FLAGS) {
  const adapter = new SimulatedMlabsAdapter(now);
  const articles = new MapSource();
  articles.items.set(MOCK_ARTICLE.id, MOCK_ARTICLE);
  const deps: DashboardDeps = {
    store: new InMemoryPackageStore(),
    articles,
    adapter,
    publisher: new SocialPublisher({ adapter, flags, now }),
    flags,
    now,
  };
  return { deps, articles, adapter };
}

const isErr = (b: unknown): b is ApiError => typeof b === 'object' && b !== null && 'error' in b;
const code = (b: unknown) => (isErr(b) ? b.error.code : undefined);
const ok = <T>(r: { status: number; body: T | ApiError }): T => {
  assert.ok(!isErr(r.body), JSON.stringify(r.body));
  return r.body as T;
};

describe('Social Dashboard: handlers puros', () => {
  let ctx: ReturnType<typeof make>;
  beforeEach(() => {
    clockState.n = 0;
    ctx = make();
  });

  test('sem permissão: todo handler devolve 403 FORBIDDEN', async () => {
    const d = ctx.deps;
    const calls = [
      await getDashboardSummary(d, NOBODY), await listQueue(d, NOBODY, {}), await getPackage(d, NOBODY, 'a:linkedin:v1'),
      await listReceipts(d, NOBODY), await listAudit(d, NOBODY),
      await generatePackages(d, READER, { articleId: MOCK_ARTICLE.id }),
      await requestSimulatedPublish(d, READER, 'a:linkedin:v1'),
    ];
    for (const r of calls) {
      assert.equal(r.status, 403);
      assert.equal(code(r.body), 'FORBIDDEN');
    }
  });

  test('estado vazio honesto: fila e recibos vazios, sem métricas fictícias', async () => {
    const q = ok<QueueResult>(await listQueue(ctx.deps, ALL, {}));
    assert.deepEqual(q.items, []);
    assert.equal(q.total, 0);
    assert.equal(q.nextCursor, null);
    const s = ok(await getDashboardSummary(ctx.deps, ALL));
    assert.equal(s.totals.packages, 0);
    assert.equal(s.metrics.available, false);
    assert.equal(s.brandStatus, 'proposal_not_approved');
    assert.ok(s.note.includes('simulado'));
    assert.ok(s.channels.every((c) => c.flagEnabled === false && c.mode === 'simulado'));
    const r = ok(await listReceipts(ctx.deps, ALL));
    assert.deepEqual(r.items, []);
  });

  test('gerar pacote a partir de uma matéria: 201, bloqueado pelos bloqueios de publicação REAL; repetir é idempotente', async () => {
    const first = await generatePackages(ctx.deps, ALL, { articleId: MOCK_ARTICLE.id });
    assert.equal(first.status, 201);
    const g = ok<GenerateResult>(first);
    assert.deepEqual(g.created, ['MOCK-2026-0001:linkedin:v1']);
    const item = g.items[0]!;
    assert.equal(item.status, 'bloqueado');
    for (const b of ['mock_nao_publicavel', 'brandkit_proposal_not_approved']) assert.ok(item.blockers.includes(b), b);
    assert.equal('svg' in (item.summary!.creative as object), false, 'listagem não carrega o SVG');

    const again = await generatePackages(ctx.deps, ALL, { articleId: MOCK_ARTICLE.id });
    assert.equal(again.status, 200);
    assert.deepEqual(ok<GenerateResult>(again).existing, ['MOCK-2026-0001:linkedin:v1']);
    assert.equal((await ctx.deps.store.all()).length, 1);
  });

  test('LinkedIn + Instagram: Instagram nasce bloqueado pela flag desligada; The Loyal não tem pacote', async () => {
    const g = ok<GenerateResult>(await generatePackages(ctx.deps, ALL, { articleId: MOCK_ARTICLE.id, channels: ['linkedin', 'instagram'] }));
    assert.equal(g.items.length, 2);
    const ig = g.items.find((i) => i.channel === 'instagram')!;
    assert.ok(ig.blockers.includes('canal_desligado:instagram'));
    const loyal = await generatePackages(ctx.deps, ALL, { articleId: MOCK_ARTICLE.id, channels: ['the_loyal'] });
    assert.equal(loyal.status, 422);
    assert.equal(code(loyal.body), 'CHANNEL_NOT_SUPPORTED');
  });

  test('entrada inválida e matéria inexistente', async () => {
    assert.equal((await generatePackages(ctx.deps, ALL, { articleId: '' })).status, 400);
    assert.equal((await generatePackages(ctx.deps, ALL, { articleId: 'x', channels: ['tiktok'] })).status, 400);
    const nf = await generatePackages(ctx.deps, ALL, { articleId: 'nao-existe' });
    assert.equal(nf.status, 404);
    assert.equal(code(nf.body), 'ARTICLE_NOT_FOUND');
    assert.equal((await listQueue(ctx.deps, ALL, { limit: 1000 })).status, 400);
    assert.equal((await listQueue(ctx.deps, ALL, { status: 'inexistente' })).status, 400);
    assert.equal((await getPackage(ctx.deps, ALL, 'sem formato')).status, 400);
    assert.equal((await getPackage(ctx.deps, ALL, 'a:linkedin:v1')).status, 404);
  });

  test('falha de regra de copy vira registro `falhou` com as regras, nunca silêncio', async () => {
    ctx.articles.items.set('A-2027', { ...MOCK_ARTICLE, id: 'A-2027', title: 'Regra muda em 2027', facts: [{ text: 'Regra muda.', source: 's' }] });
    const r = await generatePackages(ctx.deps, ALL, { articleId: 'A-2027' });
    assert.equal(r.status, 201);
    const g = ok<GenerateResult>(r);
    assert.deepEqual(g.failed, ['A-2027:linkedin:v1']);
    assert.equal(g.items[0]!.status, 'falhou');
    assert.ok(g.items[0]!.blockers.includes('regra:numero_sem_evidencia'));
    const pub = await requestSimulatedPublish(ctx.deps, ALL, 'A-2027:linkedin:v1');
    assert.equal(pub.status, 409);
    assert.equal(code(pub.body), 'PACKAGE_FAILED');
  });

  test('getPackage devolve o SVG do criativo para a prévia', async () => {
    await generatePackages(ctx.deps, ALL, { articleId: MOCK_ARTICLE.id });
    const rec = ok<SocialPackageRecord>(await getPackage(ctx.deps, READER, 'MOCK-2026-0001:linkedin:v1'));
    assert.ok(rec.summary!.creative.svg!.startsWith('<svg'));
    assert.equal(rec.mock, true);
  });

  test('fila: filtros, contagens e paginação', async () => {
    for (let i = 1; i <= 5; i++) {
      ctx.articles.items.set(`ART-${i}`, { ...MOCK_ARTICLE, id: `ART-${i}`, gatesPassed: i % 2 === 0 });
      await generatePackages(ctx.deps, ALL, { articleId: `ART-${i}`, channels: ['linkedin', 'instagram'] });
    }
    const all = ok<QueueResult>(await listQueue(ctx.deps, ALL, {}));
    assert.equal(all.total, 10);
    assert.equal(all.counts.byChannel.linkedin, 5);
    assert.equal(all.counts.byChannel.instagram, 5);
    assert.equal(all.counts.byStatus.bloqueado, 10);

    const ig = ok<QueueResult>(await listQueue(ctx.deps, ALL, { channel: 'instagram' }));
    assert.equal(ig.total, 5);
    const gates = ok<QueueResult>(await listQueue(ctx.deps, ALL, { blocker: 'gates_automaticos_pendentes' }));
    assert.equal(gates.total, 6); // 3 matérias ímpares × 2 canais

    const p1 = ok<QueueResult>(await listQueue(ctx.deps, ALL, { limit: 4 }));
    assert.equal(p1.items.length, 4);
    assert.equal(p1.nextCursor, '4');
    const p3 = ok<QueueResult>(await listQueue(ctx.deps, ALL, { limit: 4, cursor: '8' }));
    assert.equal(p3.items.length, 2);
    assert.equal(p3.nextCursor, null);
    const seen = new Set([...p1.items, ...ok<QueueResult>(await listQueue(ctx.deps, ALL, { limit: 4, cursor: '4' })).items, ...p3.items].map((i) => i.id));
    assert.equal(seen.size, 10);
  });

  test('pedido de publicação SIMULADA: recibo SIM-, status simulado, idempotente; aparece em recibos e auditoria', async () => {
    await generatePackages(ctx.deps, ALL, { articleId: MOCK_ARTICLE.id });
    const id = 'MOCK-2026-0001:linkedin:v1';
    const r1 = await requestSimulatedPublish(ctx.deps, ALL, id);
    assert.equal(r1.status, 200);
    const body = ok(r1);
    assert.match(body.receipt.id, /^SIM-\d{6}$/);
    assert.equal(body.receipt.simulated, true);
    assert.equal(body.record.status, 'simulado');

    const r2 = ok(await requestSimulatedPublish(ctx.deps, ALL, id));
    assert.equal(r2.receipt.id, body.receipt.id);
    assert.equal(r2.record.receipts.length, 1);
    assert.equal(ctx.adapter.count, 1);

    const rec = ok(await listReceipts(ctx.deps, READER));
    assert.equal(rec.items.length, 1);
    assert.equal(rec.simulatedOnly, true);
    const audit = ok(await listAudit(ctx.deps, READER));
    assert.equal(audit.items[0]!.outcome, 'accepted');
  });

  test('Instagram com a chave desligada: recusa 403, status recusado, tentativa registrada na auditoria', async () => {
    await generatePackages(ctx.deps, ALL, { articleId: MOCK_ARTICLE.id, channels: ['instagram'] });
    const r = await requestSimulatedPublish(ctx.deps, ALL, 'MOCK-2026-0001:instagram:v1');
    assert.equal(r.status, 403);
    assert.equal(code(r.body), 'CHANNEL_DISABLED');
    const rec = ok<SocialPackageRecord>(await getPackage(ctx.deps, ALL, 'MOCK-2026-0001:instagram:v1'));
    assert.equal(rec.status, 'recusado');
    assert.equal(rec.lastRefusal, 'canal_desligado:instagram');
    const audit = ok(await listAudit(ctx.deps, ALL));
    assert.equal(audit.items[0]!.outcome, 'refused');
    assert.equal(audit.items[0]!.reason, 'canal_desligado:instagram');
    assert.equal(ctx.adapter.count, 0);
  });

  test('bloqueios duros (gates pendentes, sem imagem) impedem até a simulação', async () => {
    ctx.articles.items.set('G1', { ...MOCK_ARTICLE, id: 'G1', gatesPassed: false });
    ctx.articles.items.set('G2', { ...MOCK_ARTICLE, id: 'G2', approvedImage: undefined });
    for (const id of ['G1', 'G2']) {
      await generatePackages(ctx.deps, ALL, { articleId: id });
      const r = await requestSimulatedPublish(ctx.deps, ALL, `${id}:linkedin:v1`);
      assert.equal(r.status, 409);
      assert.equal(code(r.body), 'PACKAGE_BLOCKED');
    }
    assert.equal(ctx.adapter.count, 0);
  });

  test('matéria mudou desde a geração: pacote obsoleto (409), nada publicado', async () => {
    await generatePackages(ctx.deps, ALL, { articleId: MOCK_ARTICLE.id });
    ctx.articles.items.set(MOCK_ARTICLE.id, { ...MOCK_ARTICLE, title: 'MOCK: Outro título depois da geração' });
    const r = await requestSimulatedPublish(ctx.deps, ALL, 'MOCK-2026-0001:linkedin:v1');
    assert.equal(r.status, 409);
    assert.equal(code(r.body), 'PACKAGE_STALE');
    assert.equal(ctx.adapter.count, 0);
  });

  test('com adaptador REAL o dashboard recusa pedir publicação (só simulada)', async () => {
    const live = createLiveMlabsAdapter({
      transport: { call: async () => { throw new Error('não deve ser chamado'); } },
      liveAck: LIVE_ACK,
      actor: PUBLISHER_SOCIAL,
      flags: () => ({ ...DEFAULT_FLAGS, growth_linkedin_live: true }),
    });
    const deps: DashboardDeps = { ...ctx.deps, adapter: live };
    await generatePackages(deps, ALL, { articleId: MOCK_ARTICLE.id });
    const r = await requestSimulatedPublish(deps, ALL, 'MOCK-2026-0001:linkedin:v1');
    assert.equal(r.status, 409);
    assert.equal(code(r.body), 'LIVE_ADAPTER_NOT_ALLOWED');
    const s = ok(await getDashboardSummary(deps, ALL));
    assert.ok(s.channels.every((c) => c.mode === 'real'));
  });

  test('resumo: contagens e principais bloqueios', async () => {
    await generatePackages(ctx.deps, ALL, { articleId: MOCK_ARTICLE.id, channels: ['linkedin', 'instagram'] });
    const s = ok(await getDashboardSummary(ctx.deps, READER));
    assert.equal(s.totals.packages, 2);
    assert.equal(s.totals.byStatus.bloqueado, 2);
    assert.ok(s.topBlockers.some((b) => b.blocker === 'mock_nao_publicavel' && b.count === 2));
  });
});

describe('toSocialArticle: projeção do contrato Article', () => {
  const base = {
    id: 'a1', slug: 'a-1', titulo: 'Título', subtitulo: 'Sub', tipoConteudo: 'noticia' as const, editoria: 'pontos' as const, status: 'aprovado' as const,
    assinatura: 'Redação Loyalty News' as const, corpo: 'corpo', fontes: [{ sourceId: 's', url: 'https://x.invalid/', capturadoEm: '2026-11-22T00:00:00Z', sha256: 'a'.repeat(64) }],
    classeDeDado: 'public' as const, patrocinado: false, versao: 1,
  };
  const extras = { url: 'https://example.invalid/a', facts: [{ text: 'Fato.', source: 's' }] };

  test('editoria por nome, gates padrão desligado, fatos só os fornecidos', () => {
    const a = toSocialArticle(base, extras);
    assert.equal(a.editoria, 'Pontos & Milhas');
    assert.equal(a.gatesPassed, false);
    assert.deepEqual(a.facts, extras.facts);
    assert.equal(a.approvedImage, undefined);
  });

  test('imagem só vira aprovada se houver base de direito', () => {
    const img = { url: 'https://x.invalid/i.png', origem: 'propria' as const, credito: 'Crédito', baseDeDireito: 'propria' as const, edicoes: [], textoAlternativo: 'alt' };
    assert.equal(toSocialArticle({ ...base, imagem: img }, extras).approvedImage?.credit, 'Crédito');
    assert.equal(toSocialArticle({ ...base, imagem: { ...img, baseDeDireito: 'pendente' as const } }, extras).approvedImage, undefined);
  });
});
