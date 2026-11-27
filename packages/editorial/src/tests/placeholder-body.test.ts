import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { COLLECT_ON, MOCK_SOURCE, MockFetcher, mockResolver } from '../../fixtures/mock-web.mock';
import { isPlaceholderBody, placeholderSignals } from '../collector/placeholder';

// Corpos medidos em 26/11/2026 com parseHtml+sanitize: Bradesco RI placeholder (420 palavras, 2 frases Lorem,
// latinShare 0,143), A4A real (247 palavras, 0), Bradesco RI real (72 palavras, 0).
const PLACEHOLDER = [
  'Solução Inovadora de Cash Management. Compartilhe este post: Introduction Mi tincidunt elit, id quisque ligula ac diam, amet.',
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
].join(' ');

const A4A_REAL = [
  'Airlines for America (A4A) is honored to receive the PRNEWS Platinum Award in the Campaign Look and Feel/Identity category for Red, Flight & Blue, recognizing the creative vision and campaign identity behind the initiative.',
  'A4A also received honorable mentions in three additional categories, highlighting the breadth of the organization communications and advocacy work.',
  'As the nation prepared to celebrate its anniversary, Red, Flight & Blue brought a patriotic spirit to the communications, celebrating the history and the role aviation plays in connecting people, packages, places and the country.',
  'The campaign cohesive visual identity helped bring the initiative to life, demonstrating the power of creative storytelling and thoughtful design to engage audiences around a major national milestone.',
  'In addition to that award, A4A received honorable mentions in the following categories: Nonprofit Communications Team of the Year, Best Regional Campaign and Best on a Shoestring Budget Campaign.',
  'These recognitions underscore the commitment to developing creative and strategic communications that advance aviation priorities and connect with audiences across the country.',
].join(' ');

test('placeholder: Bradesco RI Lorem é barrado; A4A real passa', () => {
  const ph = placeholderSignals(PLACEHOLDER);
  assert.ok(ph.loremHits >= 2, JSON.stringify(ph));
  assert.ok(ph.latinShare >= 0.10, JSON.stringify(ph));
  assert.equal(isPlaceholderBody(PLACEHOLDER), true);
  const real = placeholderSignals(A4A_REAL);
  assert.equal(real.loremHits, 0, JSON.stringify(real));
  assert.ok(real.latinShare < 0.15, JSON.stringify(real));
  assert.equal(isPlaceholderBody(A4A_REAL), false);
});

test('placeholder: corpo curto real e uma menção de Lorem em texto real não são barrados', () => {
  const curto = 'O banco anunciou nesta quinta-feira o calendário de resultados do quarto trimestre, com divulgação prevista para fevereiro e teleconferência com analistas.';
  assert.equal(isPlaceholderBody(curto), false, 'menos de 20 palavras fica para empty_content');
  const citacao = `${A4A_REAL} O manual de identidade usa "Lorem ipsum" como exemplo de texto de preenchimento.`;
  assert.equal(isPlaceholderBody(citacao), false);
});

test('placeholder: ingestão barra a página e registra fonte, URL e motivo', async () => {
  const host = 'ri.mock.example';
  const page = (title: string, body: string) => `<html><head><title>${title}</title></head><body><article><h1>${title}</h1>${body}</article></body></html>`;
  const fetcher = new MockFetcher({
    [`https://${host}/robots.txt`]: 'User-agent: *\nDisallow: /privado/',
    [`https://${host}/noticias/placeholder`]: page('Solução Inovadora', `<p>${PLACEHOLDER}</p>`),
    [`https://${host}/noticias/real`]: page('A4A recebe prêmio', `<p>${A4A_REAL}</p>`),
  });
  const c = new Collector(fetcher, { minSpacingMs: 0, now: () => new Date('2026-11-26T12:00:00Z'), resolver: mockResolver(), flags: COLLECT_ON });
  const ruim = await c.collectUrl(MOCK_SOURCE, `https://${host}/noticias/placeholder`);
  assert.equal(ruim.evidence, undefined);
  assert.equal(ruim.skip?.code, 'placeholder_body');
  assert.match(ruim.skip!.detail, /source=mock-ri/);
  assert.match(ruim.skip!.detail, /lorem=[2-9]/);
  const bom = await c.collectUrl(MOCK_SOURCE, `https://${host}/noticias/real`);
  assert.ok(bom.evidence, JSON.stringify(bom.skip));
  assert.match(bom.evidence!.text, /Airlines for America/);
});
