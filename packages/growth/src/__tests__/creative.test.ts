import { test } from 'vitest';
import assert from 'node:assert/strict';
import { contextKeyFor, CreativeRefusal, fitHeadline, renderPost, TOKENS, wrapText } from '../creative/post';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

test('criativo: determinístico (mesma entrada, mesmo SVG)', () => {
  assert.equal(renderPost(MOCK_ARTICLE).svg, renderPost(MOCK_ARTICLE).svg);
});

test('criativo: dimensões e cores vêm do brandkit (design.tokens.json)', () => {
  assert.equal(TOKENS.colors.primary, '#153C3C');
  for (const [format, key] of [['vertical', 'vertical'], ['square', 'square'], ['story', 'story'], ['open_graph', 'open_graph']] as const) {
    const a = renderPost(MOCK_ARTICLE, { format });
    const [w, h] = TOKENS.social[key];
    assert.equal(a.width, w);
    assert.equal(a.height, h);
    assert.ok(a.svg.includes(`viewBox="0 0 ${w} ${h}"`));
  }
  const svg = renderPost(MOCK_ARTICLE).svg;
  assert.ok(svg.includes('#153C3C') && svg.includes('#A7DDC9') && svg.includes('#DDEFE8'));
  assert.ok(renderPost(MOCK_ARTICLE, { theme: 'dark' }).svg.includes('#101C1C'));
});

test('criativo: status do brandkit (aprovado) acompanha o ativo; mock exibe MOCK', () => {
  const a = renderPost(MOCK_ARTICLE);
  assert.equal(a.brandStatus, 'approved');
  assert.ok(a.svg.includes('data-brand-status="approved"'));
  assert.equal(a.mock, true);
  assert.ok(a.svg.includes('MOCK — NÃO PUBLICAR'));
  assert.ok(a.html.includes('MOCK'));
  const real = renderPost({ ...MOCK_ARTICLE, mock: false, title: 'Título real de teste' });
  assert.ok(!real.svg.includes('MOCK — NÃO PUBLICAR'));
  assert.ok(real.svg.includes('ILUSTRAÇÃO LOYALTY NEWS'));
});

test('criativo: contexto por editoria; logo e ilustração embutidos', () => {
  assert.equal(contextKeyFor('Travel & Hospitality'), 'travel');
  assert.equal(contextKeyFor('Varejo & Cashback'), 'retail');
  assert.equal(contextKeyFor('Bancos & Cartões'), 'payments');
  assert.equal(contextKeyFor('Editoria Inexistente'), 'payments');
  const svg = renderPost(MOCK_ARTICLE).svg;
  assert.equal((svg.match(/data:image\/svg\+xml;base64,/g) ?? []).length >= 2, true);
  assert.ok(svg.includes('data-context="retail"'));
});

test('criativo: manchete respeita 4 linhas e área segura; manchete longa demais é recusada, nunca encurtada', () => {
  const long = 'Banco anuncia nova parceria de pontos com varejista e companhia aérea para ampliar acúmulo';
  const f = fitHeadline(long, 1080 - 144, TOKENS.social.headline_max_lines, 64, 40);
  assert.ok(f.lines.length <= 4);
  assert.throws(
    () => renderPost({ ...MOCK_ARTICLE, title: 'palavra '.repeat(80) }),
    (e: unknown) => e instanceof CreativeRefusal && e.rule === 'manchete_longa',
  );
  assert.throws(() => renderPost({ ...MOCK_ARTICLE, title: '   ' }), CreativeRefusal);
});

test('criativo: escapa XML da manchete (sem injeção de marcação)', () => {
  const a = renderPost({ ...MOCK_ARTICLE, title: 'A & B <script>x</script> "c"' });
  assert.ok(!a.svg.includes('<script>'));
  assert.ok(a.svg.includes('&lt;script&gt;'));
  assert.ok(a.svg.includes('A &amp; B'));
});

test('criativo: deck longo é cortado em 2 linhas com reticências', () => {
  const a = renderPost(MOCK_ARTICLE, { deck: 'texto de apoio '.repeat(30) });
  assert.ok(a.svg.includes('…'));
});

test('wrapText quebra por largura', () => {
  const lines = wrapText('um dois três quatro cinco seis sete oito', 40, 300);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(' '), 'um dois três quatro cinco seis sete oito');
});
