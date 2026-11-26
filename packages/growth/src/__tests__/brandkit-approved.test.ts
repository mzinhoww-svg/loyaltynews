import { test } from 'vitest';
import assert from 'node:assert/strict';
import { renderPost, TOKENS } from '../creative/post';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';
import type { Article } from '../types';

// Prova do brandkit aprovado (26/11/2026): o literal de assets/design.tokens.json acompanha a
// aprovação que o @ln/ui já usa (meta.status "approved"). Os 3 thumbnails já saíam approved pelo
// @ln/ui; aqui ficam os 6 cards square/story das mesmas 3 matérias, com o asset real do Growth.
// Dados de TESTE: as matérias são o fixture mock, sem dado de mercado.

const ARTIGOS: Article[] = [
  MOCK_ARTICLE,
  {
    ...MOCK_ARTICLE,
    id: 'MOCK-2026-0002',
    title: 'MOCK: Parceria de teste amplia resgate de pontos no varejo',
    editoria: 'Varejo & Cashback',
    mock: false,
  },
  {
    ...MOCK_ARTICLE,
    id: 'MOCK-2026-0003',
    title: 'MOCK: Companhia de teste anuncia nova regra de acúmulo',
    editoria: 'Travel & Hospitality',
    mock: false,
  },
];

test('brandkit aprovado: 6 cards square/story das 3 matérias saem approved, com o dado real', () => {
  assert.equal(TOKENS.status, 'approved');
  const cards = ARTIGOS.flatMap((artigo) =>
    (['square', 'story'] as const).map((format) => renderPost(artigo, { format })),
  );
  assert.equal(cards.length, 6);
  for (const card of cards) {
    assert.equal(card.brandStatus, 'approved', `${card.format} de ${card.contextKey}`);
    assert.ok(card.svg.includes('data-brand-status="approved"'), card.format);
    assert.ok(card.svg.includes(`data-brand-version="${TOKENS.brand_version}"`), card.format);
  }
});
