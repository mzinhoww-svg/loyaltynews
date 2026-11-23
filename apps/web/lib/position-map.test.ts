import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { POSITIONS, createCommercialState, makeCtx, mediaKitPage } from '@ln/commercial';
import { PUBLIC_POSITIONS, parseMediaKit, safeDimension, type MapPosition } from '../app/(portal)/_lib/commercial-source';
import { PositionMap } from '../app/(portal)/_components/PositionMap';

const html = (positions: readonly MapPosition[]) => renderToStaticMarkup(createElement(PositionMap, { positions }));
const slot = (m: string, id: string) => {
  const g = new RegExp(`<g data-position="${id}">.*?</g>`).exec(m)?.[0];
  if (!g) return null;
  const n = (a: string) => Number(new RegExp(`${a}="([\\d.]+)"`).exec(g)![1]);
  return { w: n('width'), h: n('height'), x: n('x'), y: n('y') };
};

describe('mapa visual de posições (V-13)', () => {
  it('desenha as 5 posições com dimensão: topo, 3 sidebars e rodapé, cada uma com nome e dimensão', () => {
    const m = html(PUBLIC_POSITIONS);
    for (const id of ['TOP', 'SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3', 'FOOTER']) expect(slot(m, id), id).not.toBeNull();
    expect((m.match(/data-position="/g) ?? []).length).toBe(5);
    expect(m).toContain('Banner topo'); expect(m).toContain('1280 × 150'); expect(m).toContain('336 × 280'); expect(m).toContain('1280 × 200');
  });
  it('as proporções do desenho são as das dimensões reais (largura ÷ altura)', () => {
    const m = html(PUBLIC_POSITIONS);
    const ratio = (id: string) => { const s = slot(m, id)!; return s.w / s.h; };
    expect(ratio('TOP')).toBeCloseTo(1280 / 150, 3); expect(ratio('FOOTER')).toBeCloseTo(1280 / 200, 3);
    for (const id of ['SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3']) expect(ratio(id)).toBeCloseTo(336 / 280, 3);
    // topo e rodapé têm a mesma largura (1280) e a sidebar é mais estreita que o topo, como no inventário
    expect(slot(m, 'TOP')!.w).toBe(slot(m, 'FOOTER')!.w); expect(slot(m, 'SIDEBAR_1')!.w).toBeLessThan(slot(m, 'TOP')!.w);
  });
  it('layout: topo no alto, sidebars empilhadas à direita sem sobrepor, rodapé abaixo de tudo, coluna editorial marcada "não é vendido"', () => {
    const m = html(PUBLIC_POSITIONS);
    const t = slot(m, 'TOP')!; const f = slot(m, 'FOOTER')!; const s = ['SIDEBAR_1', 'SIDEBAR_2', 'SIDEBAR_3'].map((id) => slot(m, id)!);
    expect(t.y).toBeLessThan(s[0]!.y);
    expect(s[1]!.y).toBeGreaterThanOrEqual(s[0]!.y + s[0]!.h); expect(s[2]!.y).toBeGreaterThanOrEqual(s[1]!.y + s[1]!.h);
    expect(f.y).toBeGreaterThanOrEqual(s[2]!.y + s[2]!.h);
    expect(new Set(s.map((x) => x.x)).size).toBe(1); // mesma coluna
    expect(m).toContain('Conteúdo editorial'); expect(m).toContain('não é vendido');
  });
  it('as quatro posições ainda sem dimensão NÃO são desenhadas e dizem "dimensões em definição" na lista', () => {
    const m = html(PUBLIC_POSITIONS);
    for (const id of ['ARTICLE_INLINE', 'HOME_BETWEEN', 'AGENDA', 'DATA']) {
      expect(slot(m, id), id).toBeNull();
      expect(new RegExp(`data-position-item="${id}"[^>]*>.*?dimensões em definição`).test(m), id).toBe(true);
    }
    expect((m.match(/data-position-item="/g) ?? []).length).toBe(9);
  });
  it('acessível: svg com papel de imagem, título e descrição com as dimensões, e a lista em texto', () => {
    const m = html(PUBLIC_POSITIONS);
    expect(m).toContain('role="img"'); expect(m).toContain('aria-labelledby="mk-mapa-t mk-mapa-d"');
    expect(m).toContain('<title id="mk-mapa-t">Mapa das posições de anúncio na página</title>');
    expect(m).toMatch(/<desc id="mk-mapa-d">.*Banner topo, 1280 × 150 pixels.*Sidebar 1, 336 × 280 pixels/);
    expect(m).toContain('<figcaption>'); expect(m).toMatch(/não é captura de tela/);
  });
  it('sem preço, sem número de audiência e sem imagem de anunciante', () => {
    expect(html(PUBLIC_POSITIONS)).not.toMatch(/R\$|pre[cç]o|audi[eê]ncia|<img/i);
  });
  it('lista vazia ou sem nenhuma dimensão: não quebra e diz que não há posição definida', () => {
    for (const pos of [[], PUBLIC_POSITIONS.filter((p) => !p.dimension)]) {
      const m = html(pos);
      expect(m).not.toContain('data-position="'); expect(m).toContain('Nenhuma posição com dimensão definida.');
    }
  });
  it('posição que falta é omitida sem deslocar as demais (só topo e rodapé)', () => {
    const m = html(PUBLIC_POSITIONS.filter((p) => p.id === 'TOP' || p.id === 'FOOTER'));
    expect(slot(m, 'TOP')).not.toBeNull(); expect(slot(m, 'FOOTER')).not.toBeNull(); expect(slot(m, 'SIDEBAR_1')).toBeNull();
  });
  it('nome vindo da API é escapado (nada vira marcação)', () => {
    const m = html([{ id: 'TOP', name: '<script>alert(1)</script>', dimension: '1280x150' }]);
    expect(m).not.toContain('<script>alert(1)</script>'); expect(m).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('dimensão segura', () => {
  it('aceita LxA positivos até 4000; o resto vira null (em definição)', () => {
    expect(safeDimension('1280x150')).toBe('1280x150');
    for (const bad of [null, undefined, 5, '', 'x', '0x100', '100x0', '4001x10', '10x4001', '-1x10', '1e3x10', '10 x 10', '10×10', '<b>1x1</b>', '99999x1']) expect(safeDimension(bad as never), String(bad)).toBeNull();
  });
});

describe('fonte das posições', () => {
  it('as posições públicas de reserva batem com o inventário real de @ln/commercial (id, nome e dimensão)', () => {
    expect(PUBLIC_POSITIONS.map((p) => [p.id, p.name, p.dimension])).toEqual(POSITIONS.map((p) => [p.id, p.name, p.desktop]));
  });
  it('a API comercial entrega as mesmas posições, e o parser as lê', () => {
    const kit = parseMediaKit(JSON.parse(JSON.stringify(mediaKitPage(makeCtx(createCommercialState(), { now: '2026-12-05T12:00:00-03:00' })))));
    expect(kit!.positions).toEqual([...PUBLIC_POSITIONS]);
  });
  it('payload sem posições: lista vazia (a página usa a reserva); posições malformadas derrubam a leitura inteira', () => {
    const base = JSON.parse(JSON.stringify(mediaKitPage(makeCtx(createCommercialState(), { now: '2026-12-05T12:00:00-03:00' })))) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const semPos = JSON.parse(JSON.stringify(base)); delete semPos.blocks.especificacoes;
    expect(parseMediaKit(semPos)!.positions).toEqual([]);
    for (const bad of ['x', [{ id: 'TOP' }], [{ id: '', name: 'a' }], [1], new Array(31).fill({ id: 'TOP', name: 'a', desktop: '1x1' })]) {
      const p = JSON.parse(JSON.stringify(base)); p.blocks.especificacoes.positions = bad;
      expect(parseMediaKit(p), JSON.stringify(bad).slice(0, 30)).toBeNull();
    }
  });
  it('dimensão estranha vinda da API vira "em definição", não é desenhada', () => {
    const base = JSON.parse(JSON.stringify(mediaKitPage(makeCtx(createCommercialState(), { now: '2026-12-05T12:00:00-03:00' })))) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    base.blocks.especificacoes.positions[0].desktop = '99999x1';
    const kit = parseMediaKit(base)!;
    expect(kit.positions[0]).toMatchObject({ id: 'TOP', dimension: null });
    expect(slot(html(kit.positions), 'TOP')).toBeNull();
  });
});
