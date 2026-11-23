import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { createMlabsMetricsSource, mapPublishedPost, type SocialMetricsSource } from '../metrics/mlabs-metrics';
import { SimulatedMlabsReadTransport, SIM_CHANNEL_ID, SIM_PROFILE_ID, type SimReadOptions } from '../metrics/read-transport.mock';
import { READ_ONLY_TOOLS, WRITE_TOOLS } from '../mlabs/port';
import { getDashboardSummary, InMemoryPackageStore, PERMISSIONS, type Caller, type DashboardDeps } from '../dashboard';
import { metricsLine } from '../ui/components';
import { DEFAULT_FLAGS } from '../flags';
import { createSocialPublisher } from '../publisher/publisher';

const T0 = new Date('2026-11-23T12:00:00.000Z');
const mk = (o: SimReadOptions = {}, extra: { days?: number; ttlMs?: number; maxPages?: number; clock?: { t: Date } } = {}) => {
  const tx = new SimulatedMlabsReadTransport(o);
  const clock = extra.clock ?? { t: T0 };
  const src = createMlabsMetricsSource({ transport: tx, now: () => clock.t, days: extra.days, ttlMs: extra.ttlMs, maxPages: extra.maxPages });
  return { tx, src, clock };
};
const post = (i: number, over: Record<string, unknown> = {}) => ({ id: `p${i}`, publishedAt: '2026-11-10T10:00:00Z', type: 'foto', likes: 3, comments: 1, views: 100, ...over });

describe('métricas do mLabs (somente leitura): formas observadas em 23/11/2026', () => {
  test('conta real hoje: 0 posts e 0 seguidores são ZEROS OBSERVADOS (status ok), com período, origem e horário', async () => {
    const { src } = mk();
    const m = await src.read();
    assert.deepEqual([m.source, m.channel, m.fetchedAt], ['mlabs', 'linkedin', T0.toISOString()]);
    assert.deepEqual(m.period, { start: '2026-08-25', end: '2026-11-23' });
    assert.deepEqual([m.published.status, m.published.count, m.published.items.length, m.published.truncated], ['ok', 0, 0, false]);
    assert.deepEqual(m.followers, { status: 'ok', current: 0, start: 0, growth: 0, observedAt: '2026-11-22T00:00:00.000Z', observations: 1 });
  });

  test('só ferramentas de LEITURA são chamadas, com os ids descobertos (opacos) e o canal LinkedIn; nenhuma de escrita', async () => {
    const { src, tx } = mk();
    await src.read();
    const tools = tx.calls.map((c) => c.tool);
    assert.deepEqual(tools, ['list_profiles', 'list_channels', 'list_published_posts', 'get_follower_growth'].filter((t) => tools.includes(t)));
    for (const t of tools) {
      assert.ok((READ_ONLY_TOOLS as readonly string[]).includes(t), t);
      assert.ok(!(WRITE_TOOLS as readonly string[]).includes(t), t);
    }
    const posts = tx.calls.find((c) => c.tool === 'list_published_posts')!;
    assert.deepEqual([posts.args.profileId, posts.args.channelId, posts.args.limit], [SIM_PROFILE_ID, SIM_CHANNEL_ID, 100]);
  });

  test('janela: padrão 90 dias, configurável e limitada a 425 (máximo do mLabs)', async () => {
    assert.equal((await mk({}, { days: 30 }).src.read()).period.start, '2026-10-24');
    assert.equal((await mk({}, { days: 9999 }).src.read()).period.start, '2025-09-24');
    assert.equal((await mk({}, { days: 0 }).src.read()).period.start, '2026-11-22');
  });
});

describe('posts publicados', () => {
  test('mapeia o que existe; campo ausente fica null (nunca 0); totais só quando TODOS os posts têm o campo', async () => {
    const { src } = mk({ posts: [post(1), post(2, { likes: undefined, views: 50 }), post(3, { comments: 4 })] });
    const m = await src.read();
    assert.equal(m.published.count, 3);
    assert.deepEqual(m.published.items[1], { id: 'p2', publishedAt: '2026-11-10T10:00:00Z', type: 'foto', likes: null, comments: 1, views: 50 });
    assert.deepEqual(m.published.totals, { likes: null, comments: 6, views: 250 });
  });

  test('o mapeamento aceita interações aninhadas e rejeita lixo (negativo, texto, NaN) como null', () => {
    assert.deepEqual(mapPublishedPost({ id: 'x', interactions: { curtidas: 7, comments: -1, views: '9' } }), { id: 'x', publishedAt: null, type: null, likes: 7, comments: null, views: null });
    assert.deepEqual(mapPublishedPost(null), { id: null, publishedAt: null, type: null, likes: null, comments: null, views: null });
    assert.equal(mapPublishedPost({ likes: Number.NaN }).likes, null);
  });

  test('paginação: segue nextCursor até acabar; no limite de páginas marca truncated e mantém o total informado', async () => {
    const posts = Array.from({ length: 250 }, (_, i) => post(i));
    const full = await mk({ posts, pageSize: 100 }).src.read();
    assert.deepEqual([full.published.count, full.published.items.length, full.published.truncated], [250, 250, false]);
    const cut = await mk({ posts, pageSize: 100 }, { maxPages: 2 }).src.read();
    assert.deepEqual([cut.published.count, cut.published.items.length, cut.published.truncated], [250, 200, true]);
  });

  test('resposta partida em partes (responsePage) é juntada antes de interpretar', async () => {
    let n = 0;
    const tx = new SimulatedMlabsReadTransport({});
    const base = tx.call.bind(tx);
    tx.call = async (tool, args) => {
      if (tool !== 'list_published_posts') return base(tool, args);
      n++;
      return args.responseCursor
        ? { posts: [post(2)], totalCount: 2, hasMore: false }
        : { posts: [post(1)], totalCount: 2, hasMore: false, responsePage: { hasMore: true, nextCursor: 'r2' } };
    };
    const m = await createMlabsMetricsSource({ transport: tx, now: () => T0 }).read();
    assert.deepEqual([n, m.published.items.map((i) => i.id)], [2, ['p1', 'p2']]);
  });
});

describe('seguidores', () => {
  test('evolução: atual, inicial, crescimento e a data da última observação', async () => {
    const { src } = mk({ followers: [{ date: '2026-11-01T00:00:00.000Z', followerCount: 10 }, { date: '2026-11-20T00:00:00.000Z', followerCount: 25 }] });
    const m = await src.read();
    assert.deepEqual(m.followers, { status: 'ok', current: 25, start: 10, growth: 15, observedAt: '2026-11-20T00:00:00.000Z', observations: 2 });
  });

  test('sem observações (no_data): sem_dados, tudo null (não vira 0)', async () => {
    const m = await mk({ followers: [] }).src.read();
    assert.deepEqual(m.followers, { status: 'sem_dados', reason: 'sem_observacoes_no_periodo', current: null, start: null, growth: null, observedAt: null, observations: 0 });
  });
});

describe('falhas, descoberta e cache', () => {
  test('uma leitura que falha vira indisponivel SEM o texto do erro; a outra seção segue; a falha não fica em cache', async () => {
    const { src, tx, clock } = mk({ failTool: 'get_follower_growth' });
    const m = await src.read();
    assert.equal(m.published.status, 'ok');
    assert.deepEqual([m.followers.status, m.followers.reason, m.followers.current], ['indisponivel', 'leitura_falhou', null]);
    assert.doesNotMatch(JSON.stringify(m), /segredo|token/);
    const before = tx.calls.length;
    clock.t = new Date(T0.getTime() + 1000);
    await src.read();
    assert.ok(tx.calls.length > before, 'tentou de novo (não guardou a falha)');
  });

  test('resposta fora da forma esperada: resposta_inesperada', async () => {
    const m = await mk({ override: { get_follower_growth: 'lixo', list_published_posts: { posts: 'x' } } }).src.read();
    assert.deepEqual([m.followers.reason, m.published.reason], ['resposta_inesperada', 'resposta_inesperada']);
  });

  test('canal LinkedIn ausente ou ambíguo: indisponível nas duas seções; não escolhe sozinho; nenhuma leitura de métrica é feita', async () => {
    for (const [channels, reason] of [
      [[{ id: 'a', name: 'IG', channel: 'instagram', active: true }], 'canal_linkedin_nao_encontrado'],
      [[{ id: 'a', name: 'L1', channel: 'linkedin', active: true }, { id: 'b', name: 'L2', channel: 'linkedin', active: true }], 'canal_linkedin_ambiguo'],
      [[{ id: 'a', name: 'L1', channel: 'linkedin', active: false }], 'canal_linkedin_nao_encontrado'],
    ] as const) {
      const { src, tx } = mk({ channels: [...channels] });
      const m = await src.read();
      assert.deepEqual([m.published.status, m.followers.status, m.published.reason, m.followers.reason], ['indisponivel', 'indisponivel', reason, reason]);
      assert.equal(tx.calls.some((c) => c.tool === 'list_published_posts' || c.tool === 'get_follower_growth'), false);
    }
  });

  test('ids informados dispensam a descoberta; cache respeita o TTL com relógio injetado', async () => {
    const tx = new SimulatedMlabsReadTransport();
    const clock = { t: T0 };
    const src = createMlabsMetricsSource({ transport: tx, now: () => clock.t, profileId: 'ext_p', channelId: 'ext_c', ttlMs: 60_000 });
    await src.read();
    assert.deepEqual(tx.calls.map((c) => c.tool).sort(), ['get_follower_growth', 'list_published_posts']);
    clock.t = new Date(T0.getTime() + 30_000);
    await src.read();
    assert.equal(tx.calls.length, 2, 'dentro do TTL: sem nova chamada');
    clock.t = new Date(T0.getTime() + 61_000);
    await src.read();
    assert.equal(tx.calls.length, 4);
  });
});

describe('Social Dashboard: resumo com a fonte de métricas', () => {
  const READER: Caller = { id: 'u', permissions: [PERMISSIONS.read] };
  const deps = (metrics?: SocialMetricsSource): DashboardDeps => ({
    store: new InMemoryPackageStore(), articles: { get: async () => null }, publisher: createSocialPublisher({ mode: 'simulated', flags: DEFAULT_FLAGS, now: () => T0.toISOString() }),
    flags: DEFAULT_FLAGS, now: () => T0.toISOString(), ...(metrics ? { metrics } : {}),
  });

  test('sem fonte: indisponível, sem número; com fonte: dados do mLabs; fonte que quebra: indisponível', async () => {
    const none = await getDashboardSummary(deps(), READER);
    assert.equal((none.body as { metrics: { available: boolean } }).metrics.available, false);
    const ok = await getDashboardSummary(deps(mk().src), READER);
    const m = (ok.body as { metrics: { available: boolean; data?: { followers: { current: number } } } }).metrics;
    assert.deepEqual([m.available, m.data?.followers.current], [true, 0]);
    const broken = await getDashboardSummary(deps({ read: async () => { throw new Error('token=abc'); } }), READER);
    const b = (broken.body as { metrics: { available: boolean; reason: string } }).metrics;
    assert.deepEqual([b.available, /abc/.test(b.reason)], [false, false]);
  });

  test('o texto do painel mostra 0 observado como 0 e ausência como traço; indisponível diz o motivo', async () => {
    const zero = await mk().src.read();
    assert.match(metricsLine({ available: true, data: zero }), /0 post\(s\) publicado\(s\) · 0 seguidor\(es\), última observação 2026-11-22/);
    const off = await mk({ failTool: 'list_published_posts', followers: [] }).src.read();
    const line = metricsLine({ available: true, data: off });
    assert.match(line, /posts publicados indisponível \(leitura_falhou\) · seguidores sem dados \(sem_observacoes_no_periodo\)/);
    assert.match(metricsLine({ available: false, reason: 'x' }), /indisponíveis \(x\)/);
  });
});
