import { describe, expect, it } from 'vitest';
import { createCommercialState, formatCatalogView, makeCtx, mediaKitPage } from './index';
import * as h from './api/index';

const NOW = '2026-12-05T12:00:00-03:00';
const ctxOf = (actor?: { id: string; canManageCommercial: boolean }) => makeCtx(createCommercialState(), { now: NOW, today: '2026-12-05', flags: {}, actor });
const studio = { id: 'u', canManageCommercial: true };
const leitor = { id: 'l', canManageCommercial: false };

describe('o que a API pública do comercial NÃO expõe', () => {
  it('mídia kit público: sem motivo interno do estado e sem cenário de capacidade (potencial de receita)', () => {
    for (const actor of [undefined, leitor]) {
      const kit = mediaKitPage(ctxOf(actor));
      expect(kit.blocks.catalogo.capacityScenario).toBeNull();
      expect(kit.blocks.catalogo.formats.every((f) => !('statusReason' in f))).toBe(true);
      // `capabilities` (booleanos de disponibilidade) é público de propósito; o que não sai é o motivo e o potencial de receita.
      const json = JSON.stringify(kit);
      for (const interno of ['P-01', 'P-02', 'flag', '72000', 'previsão de faturamento', 'Capacidade operacional declarada']) expect(json).not.toContain(interno);
    }
  });
  it('o mídia kit público continua completo no que é público: 47 formatos com preço de referência e estado', () => {
    const kit = mediaKitPage(ctxOf());
    expect(kit.blocks.catalogo.total).toBe(47);
    expect(kit.blocks.catalogo.formats.find((f) => f.id === 'banners--banner-topo')).toEqual({ id: 'banners--banner-topo', section: 'Banners', name: 'Banner topo', price: 'R$ 3.000/mês', scope: '1280 × 150; 4 cotas; mínimo 3 meses', status: 'sob_consulta' });
  });
  it('listagem pública de formatos: sem motivo; handler público com e sem sessão', () => {
    expect(formatCatalogView(ctxOf()).formats.every((f) => !('statusReason' in f))).toBe(true);
    for (const actor of [undefined, leitor]) {
      const body = h.listFormats(ctxOf(actor), {}).body as { formats: object[] };
      expect(body.formats.every((f) => !('statusReason' in f))).toBe(true);
    }
  });
  it('ator do Studio (canManageCommercial) vê o motivo e o cenário de capacidade, rotulado como cenário', () => {
    const kit = mediaKitPage(ctxOf(studio));
    expect(kit.blocks.catalogo.capacityScenario).toMatchObject({ grossBRLMonth: 72000 });
    expect(kit.blocks.catalogo.capacityScenario!.label).toMatch(/não é previsão/);
    const topo = kit.blocks.catalogo.formats.find((f) => f.id === 'banners--banner-topo')!;
    expect(topo.statusReason).toMatch(/capacidade operacional/i);
    const lista = h.listFormats(ctxOf(studio), { section: 'The Loyal' }).body as { formats: { statusReason?: string }[] };
    expect(lista.formats.length).toBeGreaterThan(0);
    expect(lista.formats.every((f) => typeof f.statusReason === 'string' && f.statusReason.length > 0)).toBe(true);
  });
  it('a rota pública de mídia kit usa o mesmo corte (handler getMediaKit)', () => {
    const pub = h.getMediaKit(ctxOf(), undefined).body as { blocks: { catalogo: { capacityScenario: unknown } } };
    expect(pub.blocks.catalogo.capacityScenario).toBeNull();
    const int = h.getMediaKit(ctxOf(studio), undefined).body as { blocks: { catalogo: { capacityScenario: unknown } } };
    expect(int.blocks.catalogo.capacityScenario).not.toBeNull();
  });
});
