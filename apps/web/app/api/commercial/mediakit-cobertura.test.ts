/* eslint-disable @typescript-eslint/no-explicit-any -- corpos JSON das respostas */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { applyStagingSeed, SEED_LABEL, SEED_PREFIX } from '@ln/workers/seed-staging';
import { call, makeApp } from '../_lib/testkit';
import { dispatchCommercial as d } from '../_lib/commercial';
import { SEED_DEMO_LABEL, SEED_ID_PREFIX } from '../_lib/commercial/repo';

// Regra do PM: a cobertura do mídia kit (matérias de 30/90 dias e eventos futuros) conta SÓ conteúdo real, nunca o seed de staging (seed-stg-*, [DEMO · staging]).
let app: Awaited<ReturnType<typeof makeApp>>;
const kit = async () => {
  const r = await call(d, 'GET', { path: '/api/commercial/mediakit' });
  expect(r.status).toBe(200);
  const m = (r.body.blocks?.cobertura?.metrics ?? []) as { label: string; record: { metric: string; value: number | null; period_start: string; period_end: string; fetched_at: string; source: string } }[];
  return { metrics: Object.fromEntries(m.map((x) => [x.record.metric, x.record])), body: r.body };
};

beforeAll(async () => {
  app = await makeApp();
  await applyStagingSeed(app.db as any, { APP_ENV: 'staging' }, app.deps.now());
}, 120_000);
afterAll(async () => {
  await app.close();
});

describe('mídia kit: cobertura sem o seed de staging', () => {
  it('as marcas do seed no repositório são as mesmas do seed (não podem divergir)', () => {
    expect(SEED_ID_PREFIX).toBe(SEED_PREFIX);
    expect(SEED_LABEL.startsWith(SEED_DEMO_LABEL)).toBe(true);
  });

  it('só com o seed aplicado (5 matérias publicadas e 3 eventos aprovados e futuros): a métrica NÃO existe (o portal mostra "—")', async () => {
    const { metrics, body } = await kit();
    // nenhuma das três métricas de cobertura tem valor: o mídia kit as devolve como indisponíveis (valor nulo), nunca contando o seed
    for (const k of ['articles_published_30d', 'articles_published_90d', 'upcoming_events']) expect(metrics[k], k).toMatchObject({ status: 'unavailable', value: null });
    expect(body.blocks.cobertura.emptyState).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/seed-stg|\[DEMO/);
  });

  it('com UMA matéria real publicada (e o seed ao lado) a métrica conta 1; matéria sem publicar, interna, antiga demais ou rotulada de demo não entram', async () => {
    const now = app.deps.now();
    const base = { corpo: 'x', resumo: 'Resumo', editoria: 'pontos', classeDeDado: 'public' as const };
    await app.db.insert(schema.articles).values([
      { ...base, id: 'real-1', slug: 'real-1', titulo: 'Matéria real', status: 'publicado', publicadoEm: new Date(now.getTime() - 5 * 86_400_000) },
      { ...base, id: 'real-rascunho', slug: 'real-rascunho', titulo: 'Rascunho', status: 'rascunho', publicadoEm: null },
      { ...base, id: 'real-interna', slug: 'real-interna', titulo: 'Interna', status: 'publicado', classeDeDado: 'internal' as any, publicadoEm: new Date(now.getTime() - 2 * 86_400_000) },
      { ...base, id: 'real-demo', slug: 'real-demo', titulo: `${SEED_LABEL} rotulada sem o prefixo`, status: 'publicado', publicadoEm: new Date(now.getTime() - 3 * 86_400_000) },
    ] as any);
    // fora da janela de 30 dias (mas dentro de 90)
    await app.db.insert(schema.articles).values({ ...base, id: 'real-velha', slug: 'real-velha', titulo: 'Velha', status: 'publicado', publicadoEm: new Date(now.getTime() - 60 * 86_400_000) } as any);
    const { metrics } = await kit();
    expect(metrics.articles_published_30d).toMatchObject({ source: 'cms', value: 1 });
    expect(metrics.articles_published_90d).toMatchObject({ value: 2 });
    expect(metrics.upcoming_events).toMatchObject({ status: 'unavailable', value: null }); // eventos: só o seed existe
    // período e instante reais da contagem
    expect(metrics.articles_published_30d!.fetched_at).toBe(now.toISOString());
    expect(Date.parse(metrics.articles_published_30d!.period_end) - Date.parse(metrics.articles_published_30d!.period_start)).toBe(30 * 86_400_000);
  });

  it('evento real aprovado e futuro conta; pendente, passado, rejeitado e o do seed não', async () => {
    const ev = (id: string, over: Record<string, unknown>) =>
      app.db.insert(schema.agendaEvents).values({ id, titulo: `Evento ${id}`, inicio: '2027-02-01', fim: '2027-02-02', local: 'SP', fonteUrl: 'https://example.org/e', moderacao: 'aprovado', ...over } as any);
    await ev('ev-real', {});
    await ev('ev-pendente', { moderacao: 'pendente' });
    await ev('ev-rejeitado', { moderacao: 'rejeitado', motivoRejeicao: 'duplicado' });
    await ev('ev-passado', { inicio: '2020-01-01', fim: '2020-01-02' });
    await ev('ev-demo', { titulo: `${SEED_LABEL} sem prefixo` });
    const { metrics } = await kit();
    expect(metrics.upcoming_events).toMatchObject({ source: 'cms', value: 1 });
  });
});
