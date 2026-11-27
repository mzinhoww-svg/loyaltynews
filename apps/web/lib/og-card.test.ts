import { describe, expect, it } from 'vitest';
import { OG_CARD, OG_COLORS, OgCardRefusal, dataCurta, planejarOgCard, podeGerarOgCard, quebrarManchete, tamanhoDaManchete } from './og-card';
import { ogImagemDaMateria } from '../app/(portal)/_lib/seo';

/** Luminância relativa WCAG 2.x. */
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

// Títulos do aceite: curto (30) e longo (120), com acentos e pontuação reais.
const CURTO = 'Cashback cresce no varejo 2026';
const LONGO =
  'O varejo brasileiro amplia cashback e pontos com novas regras de resgate e testa modelos híbridos de fidelidade em 2026.';

describe('card de OG por matéria: manchete', () => {
  it('título curto (30 caracteres) usa o corpo máximo e cabe em até 2 linhas', () => {
    expect(CURTO.length).toBe(30);
    const plano = planejarOgCard({ title: CURTO, editoria: 'Varejo & Cashback' });
    expect(plano.fontSize).toBe(tamanhoDaManchete(CURTO));
    expect(plano.lines.length).toBeLessThanOrEqual(2);
    expect(plano.lines.join(' ')).toBe(CURTO);
  });

  it('título de 120 caracteres cabe em 4 linhas sem reticências e sem perder caractere', () => {
    expect(LONGO.length).toBe(120);
    const plano = planejarOgCard({ title: LONGO, editoria: 'Programas' });
    expect(plano.lines.length).toBeLessThanOrEqual(4);
    expect(plano.fontSize).toBeGreaterThanOrEqual(46);
    expect(plano.lines.join(' ')).toBe(LONGO);
    const desenhado = plano.lines.join(' ');
    expect(desenhado).not.toContain('…');
    expect(desenhado).not.toContain('...');
  });

  // P2 do QA 5 (int038-v7): o passo de 4 px atravessava o mínimo (52 → 48 → 44).
  it('manchete que só caberia abaixo do mínimo é recusada, nunca desenhada a 44 px', () => {
    const exemplo = Array(21).fill('milhas').join(' ');
    expect(() => planejarOgCard({ title: exemplo, editoria: 'Mercado' })).toThrow(/no mínimo de 46px/);
    expect(podeGerarOgCard({ title: exemplo, editoria: 'Mercado' })).toBe(false);
  });

  it('manchete que cabe exatamente no mínimo sai a 46 px, nem abaixo nem recusada', () => {
    // 4 linhas de 40 caracteres: cabem a 46 px (40 por linha), não a 48 px (39 por linha).
    const linha = 'abcdefghijklm abcdefghijklm abcdefghijkl';
    const titulo = Array(4).fill(linha).join(' ');
    expect(linha.length).toBe(40);
    const plano = planejarOgCard({ title: titulo, editoria: 'Mercado' });
    expect(plano.fontSize).toBe(46);
    expect(plano.lines).toEqual(Array(4).fill(linha));
  });

  it('nenhum plano aceito usa fonte menor que o mínimo, em qualquer comprimento', () => {
    for (let tamanho = 1; tamanho <= 14; tamanho++) {
      for (let palavras = 1; palavras <= 40; palavras++) {
        const title = Array(palavras).fill('m'.repeat(tamanho)).join(' ');
        if (podeGerarOgCard({ title, editoria: 'Mercado' })) expect(planejarOgCard({ title, editoria: 'Mercado' }).fontSize, title).toBeGreaterThanOrEqual(OG_CARD.minFontSize);
      }
    }
  });

  it('manchete que não cabe é RECUSADA, nunca truncada', () => {
    const enorme = 'palavra '.repeat(60).trim();
    expect(podeGerarOgCard({ title: enorme, editoria: 'Mercado' })).toBe(false);
    expect(() => planejarOgCard({ title: enorme, editoria: 'Mercado' })).toThrow(OgCardRefusal);
  });

  it('palavra isolada maior que a linha é recusada (sem corte silencioso)', () => {
    expect(() => quebrarManchete('a'.repeat(200), 52, 1056)).toThrow(OgCardRefusal);
  });

  it('a quebra preserva todas as palavras na ordem', () => {
    const linhas = quebrarManchete('um dois três quatro cinco seis sete oito nove dez', 52, 300);
    expect(linhas.join(' ')).toBe('um dois três quatro cinco seis sete oito nove dez');
  });

  it('o card é 1200×630 e a data sai curta em pt-BR', () => {
    const plano = planejarOgCard({ title: CURTO, editoria: 'Varejo', credit: 'Redação Loyalty News', publishedAt: '2026-11-26T12:00:00.000Z' });
    expect([plano.width, plano.height]).toEqual([1200, 630]);
    expect(plano.dateLabel).toMatch(/^26 de nov/);
    expect(plano.credit).toBe('Redação Loyalty News');
    expect(dataCurta(undefined)).toBe('');
    expect(dataCurta('data-invalida')).toBe('');
  });
});

describe('card de OG por matéria: contraste medido nos tokens', () => {
  it('manchete branca sobre primary passa AA de texto grande (>= 3:1) e de corpo (>= 4,5:1)', () => {
    expect(ratio(OG_COLORS.headline, OG_COLORS.background)).toBeGreaterThanOrEqual(4.5);
  });
  it('editoria em mint sobre primary passa AA de corpo', () => {
    expect(ratio(OG_COLORS.eyebrow, OG_COLORS.background)).toBeGreaterThanOrEqual(4.5);
  });
  it('rodapé em signal sobre primary passa AA de corpo', () => {
    expect(ratio(OG_COLORS.footer, OG_COLORS.background)).toBeGreaterThanOrEqual(4.5);
  });
  it('registra os três números medidos', () => {
    expect({
      manchete: Number(ratio(OG_COLORS.headline, OG_COLORS.background).toFixed(2)),
      editoria: Number(ratio(OG_COLORS.eyebrow, OG_COLORS.background).toFixed(2)),
      rodape: Number(ratio(OG_COLORS.footer, OG_COLORS.background).toFixed(2)),
    }).toEqual({ manchete: 12.04, editoria: 10.09, rodape: 7.93 });
  });
});

describe('og:image por matéria: precedência', () => {
  const base = { slug: 'materia-teste', title: CURTO, editoriaSlug: 'mercado', publishedAt: '2026-11-26T12:00:00.000Z' };

  it('imagem publicada vence o card gerado', () => {
    const i = ogImagemDaMateria({ ...base, image: { src: 'https://cdn.example/foto.jpg', alt: 'Foto da matéria' } });
    expect(i.url).toBe('https://cdn.example/foto.jpg');
    expect(i.alt).toBe('Foto da matéria');
  });

  it('sem imagem publicada e com manchete que cabe, usa o card da matéria', () => {
    const i = ogImagemDaMateria(base);
    expect(i.url).toBe('/og/noticia/materia-teste');
    expect([i.width, i.height]).toEqual([1200, 630]);
    expect(i.alt).toBe(CURTO);
  });

  it('manchete que não cabe cai na imagem da editoria, nunca em texto cortado', () => {
    const i = ogImagemDaMateria({ ...base, title: 'palavra '.repeat(60).trim() });
    expect(i.url).toBe('/og/editoria-mercado.png');
  });

  it('slug com espaço ou acento é escapado na URL do card', () => {
    expect(ogImagemDaMateria({ ...base, slug: 'matéria de teste' }).url).toBe('/og/noticia/mat%C3%A9ria%20de%20teste');
  });
});
