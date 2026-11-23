import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildReport, dayOf, DEFAULT_K, emptyReport, InMemoryAggregateStore, MAX_PATHS_PER_DAY, OVERFLOW_PATH, RETENTION_DAYS, type Bucket,
} from '../aggregate';
import { applyRetention } from '../handlers';
import { toMetricRecords } from '../metrics';

const b = (over: Partial<Bucket> = {}): Bucket => ({ day: '2026-11-23', path: '/materia/a', ref: 'busca', device: 'mobile', ...over });

async function fill(store: InMemoryAggregateStore, n: number, over: Partial<Bucket> = {}) {
  for (let i = 0; i < n; i++) await store.increment(b(over));
}

describe('dia civil em America/Sao_Paulo', () => {
  test('a virada do dia é a de Brasília, não a do UTC', () => {
    assert.equal(dayOf(new Date('2026-11-23T02:59:59Z')), '2026-11-22'); // 23:59:59 em Brasília
    assert.equal(dayOf(new Date('2026-11-23T03:00:00Z')), '2026-11-23'); // 00:00 em Brasília
    assert.equal(dayOf(new Date('2026-11-23T12:00:00Z')), '2026-11-23');
  });
});

describe('armazenamento agregado', () => {
  test('conta por (dia, caminho, origem, dispositivo); só isso é guardado', async () => {
    const s = new InMemoryAggregateStore();
    await fill(s, 3);
    await fill(s, 2, { device: 'desktop' });
    const rows = await s.rows('2026-11-01', '2026-11-30');
    assert.equal(rows.length, 2);
    for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['day', 'device', 'path', 'ref', 'views']);
    assert.equal(rows.reduce((a, r) => a + r.views, 0), 5);
  });

  test('o filtro de período inclui as pontas e exclui o resto', async () => {
    const s = new InMemoryAggregateStore();
    await fill(s, 1, { day: '2026-11-01' });
    await fill(s, 1, { day: '2026-11-15' });
    await fill(s, 1, { day: '2026-12-01' });
    assert.equal((await s.rows('2026-11-01', '2026-11-30')).length, 2);
    assert.equal((await s.rows('2026-11-15', '2026-11-15')).length, 1);
  });

  test('caminhos distintos por dia são limitados: o excedente cai em :outros (sem crescimento ilimitado)', async () => {
    const s = new InMemoryAggregateStore();
    for (let i = 0; i < MAX_PATHS_PER_DAY + 50; i++) await s.increment(b({ path: `/p/${i}` }));
    const rows = await s.rows('2026-11-23', '2026-11-23');
    assert.equal(new Set(rows.map((r) => r.path)).size, MAX_PATHS_PER_DAY + 1);
    assert.equal(rows.find((r) => r.path === OVERFLOW_PATH)?.views, 50);
    await s.increment(b({ path: '/p/0' })); // caminho já visto continua contando normalmente
    assert.equal((await s.rows('2026-11-23', '2026-11-23')).find((r) => r.path === '/p/0')?.views, 2);
  });

  test('retenção apaga dias antigos e preserva os recentes', async () => {
    const s = new InMemoryAggregateStore();
    await fill(s, 2, { day: '2024-01-01' });
    await fill(s, 2, { day: '2026-11-20' });
    const now = () => new Date('2026-11-23T12:00:00Z');
    assert.equal(RETENTION_DAYS, 790);
    assert.equal(await applyRetention({ store: s, now }), 1);
    const left = await s.rows('2000-01-01', '2100-01-01');
    assert.deepEqual(left.map((r) => r.day), ['2026-11-20']);
  });
});

describe('relatório', () => {
  const args = { from: '2026-11-01', to: '2026-11-30', fetchedAt: '2026-11-23T12:00:00.000Z' };

  test('sem dados: indisponível, total null, NUNCA zero (Blueprint: jamais número fictício)', () => {
    const r = buildReport([], args);
    assert.equal(r.status, 'unavailable');
    assert.equal(r.totalViews, null);
    assert.equal(r.reason, 'sem dados no período');
    assert.deepEqual(r.topPaths, []);
    assert.equal(emptyReport({ ...args, reason: 'x' }).totalViews, null);
  });

  test('traz período, fonte, metodologia e horário; total exato', async () => {
    const s = new InMemoryAggregateStore();
    await fill(s, 8, { path: '/materia/a' });
    await fill(s, 6, { path: '/materia/b', ref: 'social', device: 'desktop' });
    const r = buildReport(await s.rows(args.from, args.to), args);
    assert.deepEqual({ st: r.status, src: r.source, v: r.methodology_version, a: r.period_start, z: r.period_end, f: r.fetched_at, t: r.totalViews }, {
      st: 'available', src: 'ln_first_party', v: 'ln-analytics-1', a: '2026-11-01', z: '2026-11-30', f: args.fetchedAt, t: 14,
    });
    assert.deepEqual(r.topPaths, [{ key: '/materia/a', views: 8 }, { key: '/materia/b', views: 6 }]);
    assert.deepEqual(r.referrers, [{ key: 'busca', views: 8 }, { key: 'social', views: 6 }]);
  });

  test(`k-anonimato: células com menos de ${DEFAULT_K} visualizações são suprimidas por dimensão; o total continua exato`, async () => {
    const s = new InMemoryAggregateStore();
    await fill(s, 10, { path: '/materia/grande' });
    await fill(s, 2, { path: '/materia/rara', ref: 'social', device: 'tablet' });
    await fill(s, 1, { path: '/materia/unica', ref: 'outro', device: 'desktop' });
    const r = buildReport(await s.rows(args.from, args.to), args);
    assert.equal(r.totalViews, 13);
    assert.deepEqual(r.topPaths.map((c) => c.key), ['/materia/grande']);
    assert.equal(r.suppressedViews, 3);
    assert.deepEqual(r.referrers.map((c) => c.key), ['busca']);
    assert.deepEqual(r.devices.map((c) => c.key), ['mobile']);
    for (const dim of [r.topPaths, r.referrers, r.devices, r.byDay]) for (const c of dim) assert.ok(c.views >= DEFAULT_K);
  });

  test('tráfego inicial pequeno: tudo suprimido por dimensão, total visível (sem inventar detalhe)', async () => {
    const s = new InMemoryAggregateStore();
    await fill(s, 3);
    const r = buildReport(await s.rows(args.from, args.to), args);
    assert.equal(r.status, 'available');
    assert.equal(r.totalViews, 3);
    assert.deepEqual([r.topPaths, r.referrers, r.devices, r.byDay], [[], [], [], []]);
  });

  test('k é configurável e nunca menor que 1', async () => {
    const s = new InMemoryAggregateStore();
    await fill(s, 2);
    assert.equal(buildReport(await s.rows(args.from, args.to), { ...args, k: 2 }).topPaths.length, 1);
    assert.equal(buildReport(await s.rows(args.from, args.to), { ...args, k: 0 }).k, 1);
  });
});

describe('ponte com o mídia kit (MetricStore)', () => {
  test('relatório disponível vira registros com origem, período, horário e metodologia; indisponível não gera registro', async () => {
    const s = new InMemoryAggregateStore();
    await fill(s, 9, { path: '/materia/a', ref: 'busca', device: 'mobile' });
    const rep = buildReport(await s.rows('2026-11-01', '2026-11-30'), { from: '2026-11-01', to: '2026-11-30', fetchedAt: '2026-11-23T12:00:00.000Z' });
    const recs = toMetricRecords(rep);
    assert.deepEqual(recs.map((r) => r.metric), ['pageviews', 'pageviews_origem_busca', 'pageviews_dispositivo_mobile']);
    for (const r of recs) {
      assert.equal(r.source, 'ln_first_party');
      assert.equal(r.period_start, '2026-11-01T00:00:00-03:00');
      assert.equal(r.period_end, '2026-11-30T23:59:59-03:00');
      assert.equal(r.fetched_at, '2026-11-23T12:00:00.000Z');
      assert.equal(r.methodology_version, 'ln-analytics-1');
      assert.equal(Number.isFinite(r.value), true);
    }
    assert.deepEqual(toMetricRecords(buildReport([], { from: '2026-11-01', to: '2026-11-30', fetchedAt: 'x' })), []);
  });

  test('o MetricStore do Comercial aceita os registros (ingest) e mostra "não disponível" na ausência', async () => {
    const { MetricStore, displayMetric } = await import('@ln/commercial');
    const s = new InMemoryAggregateStore();
    await fill(s, 12);
    const rep = buildReport(await s.rows('2026-11-01', '2026-11-30'), { from: '2026-11-01', to: '2026-11-30', fetchedAt: '2026-11-23T12:00:00.000Z' });
    const store = new MetricStore();
    for (const r of toMetricRecords(rep)) store.ingest(r);
    const got = store.get({ source: 'ln_first_party', metric: 'pageviews' }, '2026-11-23T12:05:00.000Z');
    assert.equal(got.status, 'available');
    assert.equal(got.value, 12);
    assert.equal(displayMetric(store.get({ source: 'ln_first_party', metric: 'nao_coletada' }, '2026-11-23T12:05:00.000Z')), '— / não disponível');
  });
});
