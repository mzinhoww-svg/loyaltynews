import { describe, expect, it } from 'vitest';
import type { DashboardSummary } from '@ln/growth/dashboard';
import { metricasVista } from './social-metricas';

type Data = Extract<DashboardSummary['metrics'], { available: true }>['data'];
const base = (over: Partial<Data> = {}): DashboardSummary['metrics'] => ({
  available: true,
  data: {
    source: 'mlabs',
    channel: 'linkedin',
    fetchedAt: '2026-11-23T12:00:00Z',
    period: { start: '2026-08-25', end: '2026-11-23' },
    published: { status: 'ok', count: 0, items: [], truncated: false, totals: { likes: null, comments: null, views: null } },
    followers: { status: 'ok', current: 0, start: 0, growth: null, observedAt: '2026-11-22T00:00:00Z', observations: 1 },
    ...over,
  },
});

describe('metricasVista (mLabs, só leitura)', () => {
  it('sem fonte: indisponível com o motivo, sem número', () => {
    const v = metricasVista({ available: false, reason: 'integração de métricas não configurada; sem números fictícios' });
    expect(v).toEqual({ disponivel: false, motivo: 'integração de métricas não configurada; sem números fictícios' });
  });

  it('hoje (0 posts e 0 seguidores): zero real aparece como 0, somas sem posts como "—"', () => {
    const v = metricasVista(base());
    if (!v.disponivel) throw new Error('deveria estar disponível');
    const c = Object.fromEntries(v.celulas.map((x) => [x.rotulo, x]));
    expect(c['Posts publicados no período']!.valor).toBe('0');
    expect(c['Seguidores']!.valor).toBe('0');
    expect(c['Crescimento de seguidores']!.valor).toBe('—');
    expect(c['Curtidas (soma dos posts)']!.valor).toBe('—');
    expect(c['Curtidas (soma dos posts)']!.nota).toBeNull();
    expect(v.posts).toEqual([]);
    expect(v.periodo).toBe('2026-08-25 a 2026-11-23');
  });

  it('leitura falhou num lado: "—" com o motivo, nunca 0', () => {
    const v = metricasVista(base({ followers: { status: 'indisponivel', reason: 'timeout', current: null, start: null, growth: null, observedAt: null, observations: 0 } }));
    if (!v.disponivel) throw new Error('x');
    const seg = v.celulas.find((x) => x.rotulo === 'Seguidores')!;
    expect(seg).toMatchObject({ estado: 'indisponivel', valor: '—', nota: 'timeout' });
  });

  it('soma parcial não existe: total null com post sem o campo vira "—" e explica', () => {
    const v = metricasVista(
      base({
        published: {
          status: 'ok',
          count: 2,
          truncated: true,
          totals: { likes: 12, comments: null, views: 1500 },
          items: [
            { id: 'a', publishedAt: '2026-11-20T10:00:00Z', type: 'image', likes: 10, comments: 1, views: 1000 },
            { id: null, publishedAt: null, type: null, likes: 2, comments: null, views: 500 },
          ],
        },
        followers: { status: 'ok', current: 1234, start: 1200, growth: 34, observedAt: null, observations: 3 },
      }),
    );
    if (!v.disponivel) throw new Error('x');
    const c = Object.fromEntries(v.celulas.map((x) => [x.rotulo, x]));
    // lista cortada: nenhuma soma aparece como total (QA 7), e o total de posts igual ao lido é só um mínimo
    expect(c['Visualizações (soma dos posts)']!.valor).toBe('—');
    expect(c['Visualizações (soma dos posts)']!.nota).toMatch(/soma parcial não é total/);
    expect(c['Posts publicados no período']!.valor).toBe('≥ 2');
    expect(c['Posts publicados no período']!.nota).toMatch(/mínimo lido/);
    expect(c['Crescimento de seguidores']!.valor).toBe('+34');
    expect(c['Seguidores']!.nota).toMatch(/não informou a data/);
    expect(v.posts[1]).toEqual({ chave: 'sem-id-1', data: '—', tipo: '—', curtidas: '2', comentarios: '—', visualizacoes: '500' });
  });

  it('amostra do QA 7: 2 posts informados e 1 lido, sem corte: soma escondida, total do mLabs mantido', () => {
    const v = metricasVista(
      base({
        published: {
          status: 'ok', count: 2, truncated: false, totals: { likes: 10, comments: 1, views: 1000 },
          items: [{ id: 'a', publishedAt: '2026-11-20T10:00:00Z', type: 'image', likes: 10, comments: 1, views: 1000 }],
        },
      }),
    );
    if (!v.disponivel) throw new Error('x');
    const c = Object.fromEntries(v.celulas.map((x) => [x.rotulo, x]));
    expect(c['Curtidas (soma dos posts)']).toMatchObject({ valor: '—', nota: expect.stringMatching(/só 1 posts foram lidos/) });
    expect(c['Posts publicados no período']).toMatchObject({ valor: '2', nota: expect.stringMatching(/foram lidos 1/) });
  });

  it('lista completa: soma de todos os posts aparece', () => {
    const v = metricasVista(
      base({
        published: {
          status: 'ok', count: 1, truncated: false, totals: { likes: 10, comments: 1, views: 1000 },
          items: [{ id: 'a', publishedAt: '2026-11-20T10:00:00Z', type: 'image', likes: 10, comments: 1, views: 1000 }],
        },
      }),
    );
    if (!v.disponivel) throw new Error('x');
    const c = Object.fromEntries(v.celulas.map((x) => [x.rotulo, x]));
    expect(c['Curtidas (soma dos posts)']).toMatchObject({ valor: '10', nota: null });
    expect(c['Posts publicados no período']).toMatchObject({ valor: '1', nota: null });
  });
});
