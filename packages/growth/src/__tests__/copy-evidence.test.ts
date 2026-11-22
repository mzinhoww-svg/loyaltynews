import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CopyRefusal, generateLinkedInCopy, SIGNATURE, validateCopy } from '../copy/engine';
import { generateInstagramCaption } from '../package/instagram';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';
import type { Article } from '../types';

// Todo número do texto final precisa estar vinculado a um FATO COM FONTE; título e deck não são evidência (QA ft-growth-mlabs).

test('número do título sem fato com fonte é recusado', () => {
  const a: Article = { ...MOCK_ARTICLE, title: 'Programa muda regra em 2027', facts: [{ text: 'Regra muda para os associados.', source: 's' }] };
  assert.throws(() => generateLinkedInCopy(a), (e: unknown) => {
    return e instanceof CopyRefusal && e.violations.some((v) => v.rule === 'numero_sem_evidencia' && v.detail.includes('2027'));
  });
});

test('número do deck sem fato com fonte é recusado', () => {
  const a: Article = { ...MOCK_ARTICLE, deck: 'Mudança afeta 3 milhões de clientes.' };
  assert.throws(() => generateLinkedInCopy(a), (e: unknown) => {
    return e instanceof CopyRefusal && e.violations.some((v) => v.rule === 'numero_sem_evidencia' && v.detail.includes('"3"'));
  });
});

test('Instagram: a mesma regra vale na legenda (número do título sem fato)', () => {
  const a: Article = { ...MOCK_ARTICLE, title: 'Programa muda regra em 2027', facts: [{ text: 'Regra muda para os associados.', source: 's' }] };
  assert.throws(() => generateInstagramCaption(a), (e: unknown) => {
    return e instanceof CopyRefusal && e.violations.some((v) => v.rule === 'numero_sem_evidencia');
  });
});

test('número que só aparece em fato SEM fonte não conta como evidência', () => {
  const a: Article = {
    ...MOCK_ARTICLE,
    title: 'Regra em 2027',
    facts: [{ text: 'Regra vale em 2027.', source: '   ' }, { text: 'Outro fato.', source: 's' }],
  };
  const text = `${a.title}\n• Outro fato.\nhttps://x.invalid/a?utm_source=linkedin&utm_campaign=c\nImagem: ${a.approvedImage?.credit}\n${SIGNATURE}`;
  const v = validateCopy(text, a, []);
  assert.ok(v.some((x) => x.rule === 'fato_sem_fonte'));
  assert.ok(v.some((x) => x.rule === 'numero_sem_evidencia' && x.detail.includes('2027')));
});

test('número do título COM fato com fonte correspondente passa (vínculo explícito)', () => {
  const a: Article = { ...MOCK_ARTICLE, title: 'Regra muda em 2027', facts: [{ text: 'A regra vale a partir de 2027.', source: 's' }] };
  assert.equal(generateLinkedInCopy(a).violations.length, 0);
});

test('crédito da imagem com ano não conta como afirmação numérica', () => {
  const a: Article = { ...MOCK_ARTICLE, approvedImage: { ref: 'r', credit: 'Foto: Agência Exemplo 2026' } };
  assert.equal(generateLinkedInCopy(a).violations.length, 0);
});
