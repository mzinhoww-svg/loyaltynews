import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { createMlabsMetricsSource } from '../metrics/mlabs-metrics';
import { SimulatedMlabsReadTransport } from '../metrics/read-transport.mock';
import { socialMetricsToRecords, SOCIAL_METHODOLOGY_VERSION, SOCIAL_SOURCE } from '../metrics/to-records';

const NOW = new Date('2026-11-23T12:00:00.000Z');
const read = (o: ConstructorParameters<typeof SimulatedMlabsReadTransport>[0] = {}) => createMlabsMetricsSource({ transport: new SimulatedMlabsReadTransport(o), now: () => NOW }).read();
const post = (i: number, over: Record<string, unknown> = {}) => ({ id: `p${i}`, publishedAt: '2026-11-10T10:00:00Z', type: 'foto', likes: 3, comments: 1, views: 100, ...over });
const by = (rs: ReturnType<typeof socialMetricsToRecords>) => Object.fromEntries(rs.map((r) => [r.metric, r.value]));

describe('métricas sociais do mLabs -> registros do armazém de métricas', () => {
  test('conta real hoje (0 posts, 0 seguidores observados): zeros OBSERVADOS viram registros, com fonte, período, horário e metodologia', async () => {
    const rs = socialMetricsToRecords(await read());
    assert.deepEqual(by(rs), { social_posts_publicados: 0, social_curtidas_total: 0, social_comentarios_total: 0, social_visualizacoes_total: 0, social_seguidores: 0, social_seguidores_crescimento: 0 });
    for (const r of rs) assert.deepEqual([r.source, r.fetched_at, r.methodology_version], [SOCIAL_SOURCE, NOW.toISOString(), SOCIAL_METHODOLOGY_VERSION]);
    const posts = rs.find((r) => r.metric === 'social_posts_publicados')!;
    assert.deepEqual([posts.period_start, posts.period_end], ['2026-08-25T00:00:00-03:00', '2026-11-23T23:59:59-03:00']);
    const fol = rs.find((r) => r.metric === 'social_seguidores')!;
    assert.deepEqual([fol.period_start, fol.period_end], ['2026-11-22T00:00:00-03:00', '2026-11-22T23:59:59-03:00']); // o dia da última observação
  });

  test('o que o mLabs não devolve NÃO vira registro (nem zero): total parcial, seção indisponível e seguidores sem observação', async () => {
    const parcial = by(socialMetricsToRecords(await read({ posts: [post(1), post(2, { likes: undefined })] })));
    assert.equal('social_curtidas_total' in parcial, false);
    assert.deepEqual([parcial.social_posts_publicados, parcial.social_comentarios_total, parcial.social_visualizacoes_total], [2, 2, 200]);
    assert.deepEqual(socialMetricsToRecords(await read({ failTool: 'list_published_posts', followers: [] })), []);
    const soSeguidores = by(socialMetricsToRecords(await read({ failTool: 'list_published_posts', followers: [{ date: '2026-11-20T00:00:00.000Z', followerCount: 7 }] })));
    assert.deepEqual(soSeguidores, { social_seguidores: 7, social_seguidores_crescimento: 0 });
  });

  test('canal ausente: nenhum registro; os valores são inteiros finitos e não negativos onde o mLabs informa contagens', async () => {
    assert.deepEqual(socialMetricsToRecords(await read({ channels: [] })), []);
    const rs = socialMetricsToRecords(await read({ posts: [post(1), post(2)], followers: [{ date: '2026-11-01T00:00:00.000Z', followerCount: 10 }, { date: '2026-11-20T00:00:00.000Z', followerCount: 25 }] }));
    assert.deepEqual(by(rs).social_seguidores_crescimento, 15);
    for (const r of rs.filter((x) => x.metric !== 'social_seguidores_crescimento')) assert.ok(Number.isFinite(r.value) && r.value >= 0, r.metric);
  });
});
