import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  CopyRefusal,
  generateLinkedInCopy,
  SIGNATURE,
  toPlainText,
  validateCopy,
  withUtm,
} from '../copy/engine';
import { MOCK_ARTICLE } from '../../fixtures/article.mock';
import type { Article } from '../types';

test('copy: usa só fatos e números da matéria; traz UTM, assinatura e crédito', () => {
  const c = generateLinkedInCopy(MOCK_ARTICLE);
  assert.ok(c.text.startsWith(MOCK_ARTICLE.title));
  assert.ok(c.text.includes('24 meses'));
  assert.ok(c.text.includes('utm_source=linkedin'));
  assert.ok(c.text.includes('utm_campaign=mock-2026-0001'));
  assert.ok(c.text.includes(SIGNATURE));
  assert.ok(c.text.includes('Ilustração Loyalty News (demonstrativa)'));
  assert.equal(c.violations.length, 0);
  assert.ok(c.hashtags.length <= 3);
});

test('copy: menção só para entidade verificada; sem verificação, texto puro', () => {
  const c = generateLinkedInCopy(MOCK_ARTICLE);
  assert.deepEqual(c.mentions.map((m) => m.name), ['Empresa Exemplo']);
  assert.deepEqual(c.plainEntities, ['Pessoa Exemplo']);
  assert.ok(c.text.includes('@[Empresa Exemplo]'));
  assert.ok(!c.text.includes('@[Pessoa Exemplo]'));
  assert.equal(c.textOnlyFallback, false);

  const noVerified: Article = {
    ...MOCK_ARTICLE,
    entities: MOCK_ARTICLE.entities?.map((e) => ({ ...e, verified: undefined })),
  };
  const d = generateLinkedInCopy(noVerified);
  assert.equal(d.mentions.length, 0);
  assert.equal(d.textOnlyFallback, true);
  assert.ok(!d.text.includes('@['));
});

test('regra: número que não está nos fatos é rejeitado', () => {
  const c = generateLinkedInCopy(MOCK_ARTICLE);
  const v = validateCopy(c.text.replace('24 meses', '36 meses'), MOCK_ARTICLE, c.mentions);
  assert.ok(v.some((x) => x.rule === 'numero_sem_evidencia' && x.detail.includes('"36"')));
});

test('regra: marcação de entidade não verificada é rejeitada', () => {
  const c = generateLinkedInCopy(MOCK_ARTICLE);
  const v = validateCopy(c.text + '\n@[Pessoa Exemplo]', MOCK_ARTICLE, c.mentions);
  assert.ok(v.some((x) => x.rule === 'mencao_nao_verificada'));
  const v2 = validateCopy(c.text, MOCK_ARTICLE, [{ name: 'Pessoa Exemplo', ref: 'x', source: 'y' }]);
  assert.ok(v2.some((x) => x.rule === 'mencao_nao_verificada'));
});

test('regra: autoria/apuração inventada, sem assinatura, sem UTM, gancho e texto longos', () => {
  const c = generateLinkedInCopy(MOCK_ARTICLE);
  assert.ok(validateCopy(c.text + '\nEntrevistamos o diretor.', MOCK_ARTICLE, c.mentions).some((x) => x.rule === 'autoria_inventada'));
  assert.ok(validateCopy(c.text.replace(SIGNATURE, ''), MOCK_ARTICLE, c.mentions).some((x) => x.rule === 'sem_assinatura'));
  assert.ok(validateCopy(c.text.replace(/\?utm\S*/, ''), MOCK_ARTICLE, c.mentions).some((x) => x.rule === 'link_sem_utm'));
  assert.ok(validateCopy('x'.repeat(300) + '\n' + c.text, MOCK_ARTICLE, c.mentions).some((x) => x.rule === 'gancho_longo'));
  assert.ok(validateCopy(c.text + 'x'.repeat(3000), MOCK_ARTICLE, c.mentions).some((x) => x.rule === 'texto_longo'));
  assert.ok(validateCopy(c.text + ' #a #b #c #d', MOCK_ARTICLE, c.mentions).some((x) => x.rule === 'hashtags_demais'));
  assert.ok(validateCopy(c.text.replace('Ilustração Loyalty News (demonstrativa)', ''), MOCK_ARTICLE, c.mentions).some((x) => x.rule === 'sem_credito_imagem'));
});

test('sem fatos com fonte, não gera copy', () => {
  assert.throws(() => generateLinkedInCopy({ ...MOCK_ARTICLE, facts: [] }), (e: unknown) => {
    return e instanceof CopyRefusal && e.violations.some((v) => v.rule === 'sem_fatos');
  });
  assert.throws(
    () => generateLinkedInCopy({ ...MOCK_ARTICLE, facts: [{ text: 'fato', source: ' ' }] }),
    (e: unknown) => e instanceof CopyRefusal && e.violations.some((v) => v.rule === 'fato_sem_fonte'),
  );
});

test('título com número que o próprio título traz é permitido; fato com número é permitido', () => {
  const a: Article = { ...MOCK_ARTICLE, title: 'Programa muda regra em 2027', facts: [{ text: 'Regra vale em 2027.', source: 's' }] };
  assert.equal(generateLinkedInCopy(a).violations.length, 0);
});

test('UTM é determinístico e preserva a URL', () => {
  const u = new URL(withUtm('https://example.invalid/a?x=1', 'linkedin', MOCK_ARTICLE));
  assert.equal(u.searchParams.get('x'), '1');
  assert.equal(u.searchParams.get('utm_medium'), 'social');
  assert.equal(u.searchParams.get('utm_content'), 'programas-de-fidelidade');
});

test('toPlainText remove marcadores de menção', () => {
  assert.equal(toPlainText('Citados: @[A], @[B C]'), 'Citados: A, B C');
});
