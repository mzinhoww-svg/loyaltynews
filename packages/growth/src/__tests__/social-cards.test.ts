import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CreativeRefusal, TOKENS } from '../creative/post';
import { AUTORAL_LABEL, renderSocialCard, type SocialCardFormat, type SocialCardInput } from '../creative/social-cards';
import { measure, textPath, wrap } from '../creative/type-paths';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';

// Todos os exemplos são FICTÍCIOS (empresas e números inventados); nada aqui é notícia real.
const MATERIA: SocialCardInput = {
  id: 'T-1',
  title: 'Programa Alfa oferece bônus de 100% em transferências até 15 de dezembro',
  deck: 'O comunicado não informa se o bônus vale para todos os clientes nem se haverá prorrogação.',
  editoria: 'Pontos & Milhas',
  url: 'https://example.invalid/t-1',
  facts: [{ text: 'Dado fictício.', source: 'fixture://t' }],
  gatesPassed: true,
};
const ANALISE: SocialCardInput = { ...MATERIA, id: 'T-2', title: 'O que os regulamentos de transferência bonificada dizem sobre prazo', editoria: 'Regulação & Dados', autoral: { formato: 'analise' } };
const FORMATS: SocialCardFormat[] = ['linkedin_landscape', 'square'];
const rule = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof CreativeRefusal ? e.rule : `outro:${String(e)}`;
  }
  return undefined;
};

test('cards: determinísticos (mesma entrada, mesmo SVG, byte a byte)', () => {
  for (const f of FORMATS) {
    for (const a of [MATERIA, ANALISE, MOCK_ARTICLE]) {
      assert.equal(renderSocialCard(a, { format: f }).svg, renderSocialCard(a, { format: f }).svg);
    }
  }
});

test('cards: 1200×627 (LinkedIn) e 1080×1080 (quadrado) vêm do brandkit', () => {
  const [lw, lh] = TOKENS.social.open_graph;
  const [sw, sh] = TOKENS.social.square;
  assert.deepEqual([lw, lh, sw, sh], [1200, 627, 1080, 1080]);
  for (const a of [MATERIA, ANALISE]) {
    const l = renderSocialCard(a, { format: 'linkedin_landscape' });
    const s = renderSocialCard(a, { format: 'square' });
    assert.deepEqual([l.width, l.height, s.width, s.height], [1200, 627, 1080, 1080]);
    assert.ok(l.svg.includes('viewBox="0 0 1200 627"') && s.svg.includes('viewBox="0 0 1080 1080"'));
    assert.equal(l.format, 'linkedin_landscape');
    assert.equal(s.format, 'square');
  }
});

test('cards: o texto é desenhado em curvas (sem <text>, sem recurso externo, sem script)', () => {
  for (const f of FORMATS) {
    for (const a of [MATERIA, ANALISE, { ...MATERIA, sponsored: { label: 'Conteúdo patrocinado' } }, MOCK_ARTICLE]) {
      const { svg } = renderSocialCard(a, { format: f });
      assert.ok(!/<text[\s>]/.test(svg), 'sem <text>');
      assert.ok(!/<script|<foreignObject/i.test(svg));
      assert.ok(!/(?:href|src)\s*=\s*["'](?!#|data:)/i.test(svg), 'sem href/src externo');
    }
  }
});

test('cards: materia usa fundo primário e análise usa menta; status do brandkit acompanha', () => {
  const m = renderSocialCard(MATERIA);
  const a = renderSocialCard(ANALISE);
  assert.ok(m.svg.includes(`<rect width="1200" height="627" fill="${TOKENS.colors.primary}"/>`));
  assert.ok(a.svg.includes(`<rect width="1200" height="627" fill="${TOKENS.colors.mint}"/>`));
  assert.equal(m.brandStatus, 'approved');
  assert.ok(m.svg.includes('data-brand-status="approved"') && m.svg.includes(`data-brand-version="${TOKENS.brand_version}"`));
  assert.equal(m.contextKey, 'travel');
  assert.equal(a.contextKey, 'payments');
});

test('selo de autoral: só no card de análise; matéria comum nunca leva o selo', () => {
  const m = renderSocialCard(MATERIA);
  const a = renderSocialCard(ANALISE);
  assert.ok(m.svg.includes('data-kind="materia"') && a.svg.includes('data-kind="analise"'));
  assert.ok(a.svg.includes('Card de análise autoral da Redação Loyalty News'));
  assert.ok(!/autoral/i.test(m.svg));
  assert.equal(AUTORAL_LABEL, 'CONTEÚDO AUTORAL');
  // o selo é desenhado em curvas: o card de análise tem mais formas que o de matéria sem selo para o mesmo título
  assert.notEqual(renderSocialCard({ ...ANALISE, autoral: undefined } as SocialCardInput, { kind: 'materia' }).svg, a.svg);
});

test('selo de autoral: recusas (análise sem autoral, autoral sem selo, autoral patrocinado)', () => {
  assert.equal(rule(() => renderSocialCard(MATERIA, { kind: 'analise' })), 'sem_autoral');
  assert.equal(rule(() => renderSocialCard(ANALISE, { kind: 'materia' })), 'autoral_sem_selo');
  assert.equal(rule(() => renderSocialCard({ ...ANALISE, sponsored: { label: 'Patrocinado' } })), 'autoral_patrocinado');
});

test('cards: os três formatos autorais têm rótulo próprio', () => {
  const labels = (['analise', 'explicador', 'comparativo'] as const).map((formato) => renderSocialCard({ ...ANALISE, autoral: { formato } }).svg.match(/<desc>([^<]*)</)![1]);
  assert.ok(/card de análise/i.test(labels[0]!) && /card de explicador/i.test(labels[1]!) && /card de comparativo/i.test(labels[2]!));
});

test('cards: patrocínio é rotulado no card e no texto alternativo; MOCK avisa "não publicar"', () => {
  const p = renderSocialCard({ ...MATERIA, sponsored: { label: 'Conteúdo patrocinado' } });
  assert.ok(p.svg.includes('Conteúdo patrocinado.'));
  assert.notEqual(p.svg, renderSocialCard(MATERIA).svg);
  assert.ok(!renderSocialCard(MATERIA).svg.includes('#b3261e'));
  const mk = renderSocialCard(MOCK_ARTICLE);
  assert.equal(mk.mock, true);
  assert.ok(mk.svg.includes('#b3261e') && mk.svg.includes('Exemplo de demonstração'));
});

test('cards: manchete nunca é encurtada; se não couber, recusa', () => {
  const longa = 'Cartão Gama passa a oferecer 1,5 ponto por dólar gasto a partir de janeiro, informou o banco; a anuidade não mudou';
  for (const f of FORMATS) assert.doesNotThrow(() => renderSocialCard({ ...MATERIA, title: longa }, { format: f }));
  const absurda = 'palavra '.repeat(80);
  assert.equal(rule(() => renderSocialCard({ ...MATERIA, title: absurda })), 'manchete_longa');
  assert.equal(rule(() => renderSocialCard({ ...MATERIA, title: 'Supercalifragilisticoespialidosoextraordinariamenteinquebravelmente' })), 'manchete_longa');
  assert.equal(rule(() => renderSocialCard({ ...MATERIA, title: '   ' })), 'sem_manchete');
});

test('cards: apoio longo vira 2 linhas com reticências; sem espaço, o apoio sai e a manchete fica', () => {
  const deck = 'Texto de apoio '.repeat(30);
  const withDeck = renderSocialCard(MATERIA, { deck }).svg;
  assert.notEqual(withDeck, renderSocialCard({ ...MATERIA, deck: undefined }).svg);
  assert.doesNotThrow(() => renderSocialCard({ ...MATERIA, title: 'Cartão Gama passa a oferecer 1,5 ponto por dólar gasto a partir de janeiro, informou o banco; a anuidade não mudou' }, { deck }));
});

test('cards: caractere que a fonte não cobre é recusado (sem quadradinho .notdef)', () => {
  assert.equal(rule(() => renderSocialCard({ ...MATERIA, title: 'Programa Alfa 🎉 bônus' })), 'glifo_ausente');
  assert.equal(rule(() => renderSocialCard({ ...MATERIA, title: 'Programa Alfa 日本 bônus' })), 'glifo_ausente');
  // pontuação e símbolos do português do Brasil são cobertos
  assert.doesNotThrow(() => renderSocialCard({ ...MATERIA, title: 'R$ 1.250,00 — “aspas” · 2 pontos/real… à vista, ção, ñ' }));
});

test('texto em curvas: medida real com kerning, quebra pela largura e alinhamento à direita', () => {
  const o = { weight: 700 } as const;
  // kerning da fonte aplicado pelo opentype.js 1.3.4 (dígitos e pontuação; o kerning de letras da Inter fica em tabela de extensão que a biblioteca não lê)
  assert.ok(measure('41', 40, o) < measure('4', 40, o) + measure('1', 40, o), 'kerning de 41');
  assert.ok(measure('Loyalty', 40, o) > measure('Loyalty', 30, o));
  assert.ok(measure('Loyalty News', 40, { weight: 700, tracking: -20 }) < measure('Loyalty News', 40, o));
  const lines = wrap('Programa Alfa oferece bônus de 100% em transferências', 40, 500, o);
  assert.ok(lines.length >= 2 && lines.every((l) => measure(l, 40, o) <= 500));
  assert.equal(lines.join(' '), 'Programa Alfa oferece bônus de 100% em transferências');
  assert.notEqual(textPath('Olá', 100, 100, 30, { weight: 400, fill: '#000' }), textPath('Olá', 100, 100, 30, { weight: 400, fill: '#000', anchor: 'end' }));
  assert.equal(textPath('Olá', 10, 50, 30, { weight: 600, fill: '#fff' }), textPath('Olá', 10, 50, 30, { weight: 600, fill: '#fff' }));
});
