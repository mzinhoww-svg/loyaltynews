import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { Article as ContractArticle } from '@ln/contracts';
import { toSocialArticle } from '../dashboard';
import { CopyRefusal, generateLinkedInCopy } from '../copy/engine';
import { generateInstagramCaption } from '../package/instagram';

// Contrato novo de Article (ft/scaffold 6d29f11): tipoConteudo, resumo, imagem de capa, patrocinado.
const base = {
  id: 'a1', slug: 'a-1', titulo: 'Título', editoria: 'pontos' as const, status: 'aprovado' as const,
  assinatura: 'Redação Loyalty News' as const, corpo: 'corpo',
  fontes: [{ sourceId: 's', url: 'https://x.invalid/', capturadoEm: '2026-11-22T00:00:00Z', sha256: 'a'.repeat(64) }],
  versao: 1,
};
const parse = (over: Record<string, unknown> = {}) => ContractArticle.parse({ ...base, ...over });
const extras = { url: 'https://example.invalid/a', facts: [{ text: 'Fato aprovado.', source: 's' }], gatesPassed: true };
const img = { url: 'https://x.invalid/i.png', origem: 'propria' as const, credito: 'Crédito', baseDeDireito: 'propria' as const, textoAlternativo: 'alt' };

describe('toSocialArticle com o contrato novo', () => {
  test('o contrato aplica tipoConteudo padrão (noticia) e a projeção não marca patrocínio', () => {
    const c = parse();
    assert.equal(c.tipoConteudo, 'noticia');
    assert.equal(toSocialArticle(c, extras).sponsored, undefined);
  });

  test('deck: subtítulo; sem subtítulo, o resumo', () => {
    assert.equal(toSocialArticle(parse({ subtitulo: 'Sub', resumo: 'Res' }), extras).deck, 'Sub');
    assert.equal(toSocialArticle(parse({ resumo: 'Res' }), extras).deck, 'Res');
    assert.equal(toSocialArticle(parse(), extras).deck, undefined);
  });

  test('imagem de capa só vira aprovada com base de direito', () => {
    assert.equal(toSocialArticle(parse({ imagem: img }), extras).approvedImage?.credit, 'Crédito');
    assert.equal(toSocialArticle(parse({ imagem: { ...img, baseDeDireito: 'pendente' } }), extras).approvedImage, undefined);
  });

  test('patrocinado: o rótulo vai no texto do LinkedIn e do Instagram', () => {
    const c = parse({ tipoConteudo: 'patrocinado', patrocinado: true, rotuloPublieditorial: 'Publieditorial Marca X' });
    const a = toSocialArticle(c, extras);
    assert.deepEqual(a.sponsored, { label: 'Publieditorial Marca X' });
    assert.ok(generateLinkedInCopy(a).text.includes('Conteúdo patrocinado: Publieditorial Marca X'));
    assert.ok(generateInstagramCaption(a).includes('Conteúdo patrocinado: Publieditorial Marca X'));
  });

  test('patrocinado sem rótulo (mapeado de forma incompleta): o copy recusa', () => {
    const a = { ...toSocialArticle(parse({ tipoConteudo: 'patrocinado', patrocinado: true, rotuloPublieditorial: 'Rótulo' }), extras), sponsored: { label: '' } };
    assert.throws(() => generateLinkedInCopy(a), (e: unknown) => e instanceof CopyRefusal && e.violations.some((v) => v.rule === 'publieditorial_sem_rotulo'));
    assert.throws(() => generateInstagramCaption(a), (e: unknown) => e instanceof CopyRefusal && e.violations.some((v) => v.rule === 'publieditorial_sem_rotulo'));
  });

  test('o rótulo de patrocínio com número não conta como afirmação numérica', () => {
    const c = parse({ tipoConteudo: 'patrocinado', patrocinado: true, rotuloPublieditorial: 'Publieditorial 2026' });
    assert.equal(generateLinkedInCopy(toSocialArticle(c, extras)).violations.length, 0);
  });

  test('resumo com número sem fato com fonte é recusado (o deck não é evidência)', () => {
    const a = toSocialArticle(parse({ resumo: 'Mudança afeta 3 milhões.' }), extras);
    assert.throws(() => generateLinkedInCopy(a), (e: unknown) => e instanceof CopyRefusal && e.violations.some((v) => v.rule === 'numero_sem_evidencia'));
  });
});
