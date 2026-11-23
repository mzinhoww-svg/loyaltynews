import { describe, expect, it } from 'vitest';
import { Article, ASSINATURA, ILLUSTRATION_CREDIT, ILLUSTRATION_LABEL, ILLUSTRATION_LABEL_AI, ImageRights, imageLabel, isImagePublishable } from './index';
import { publishedContentSha256 } from './hash';

const ilustracao = {
  url: 'https://cdn.example.org/ilustracao.webp',
  origem: 'ilustracao_gerada',
  credito: ILLUSTRATION_CREDIT,
  baseDeDireito: 'gerada_ia',
  textoAlternativo: 'Ilustração conceitual: cartões de fidelidade sobre um gráfico de pontos',
} as const;

const materia = {
  id: 'a1', slug: 'programa-x-muda-regra', titulo: 'Programa X muda regra', resumo: 'Resumo.', editoria: 'pontos', status: 'publicado',
  assinatura: ASSINATURA, corpo: 'Texto.', versao: 1,
  fontes: [{ sourceId: 'src-1', url: 'https://example.org/n', capturadoEm: '2026-11-22T10:00:00.000Z', sha256: 'a'.repeat(64) }],
} as const;

describe('ilustração gerada (ADR-018)', () => {
  it('aceita origem ilustracao_gerada com base gerada_ia e crédito institucional, e é publicável', () => {
    const img = ImageRights.parse(ilustracao);
    expect(isImagePublishable(img)).toBe(true);
  });

  it('base gerada_ia e origem ilustracao_gerada andam juntas', () => {
    expect(ImageRights.safeParse({ ...ilustracao, baseDeDireito: 'propria' }).success).toBe(false);
    expect(ImageRights.safeParse({ ...ilustracao, origem: 'propria' }).success).toBe(false);
  });

  it('crédito é só o institucional: sem nome de ferramenta ou modelo (D09)', () => {
    expect(ImageRights.safeParse({ ...ilustracao, credito: 'Gerada com ModeloX' }).success).toBe(false);
  });

  it('rótulo visível obrigatório; menção a IA só com rotulagemIa', () => {
    expect(imageLabel(ilustracao)).toBe(ILLUSTRATION_LABEL);
    expect(ILLUSTRATION_LABEL).not.toMatch(/\bIA\b/);
    expect(imageLabel(ilustracao, { rotulagemIa: true })).toBe(ILLUSTRATION_LABEL_AI);
    expect(imageLabel({ origem: 'fonte_terceiro' })).toBeNull();
    expect(imageLabel(null)).toBeNull();
  });

  it('cobertura de evento não usa ilustração gerada', () => {
    expect(Article.safeParse({ ...materia, imagem: ilustracao }).success).toBe(true);
    expect(Article.safeParse({ ...materia, tipoConteudo: 'cobertura_evento', imagem: ilustracao }).success).toBe(false);
  });

  it('trocar foto por ilustração (ou o contrário) muda o hash do conteúdo publicado', () => {
    const base = {
      titulo: 't', resumo: 'r', tipoConteudo: 'noticia', editoria: 'pontos', corpo: 'c', classeDeDado: 'public', patrocinado: false, fontes: ['ev-1'],
    };
    const foto = { ...ilustracao, origem: 'propria', baseDeDireito: 'propria', credito: 'Loyalty News' };
    expect(publishedContentSha256({ ...base, imagem: ilustracao })).not.toBe(publishedContentSha256({ ...base, imagem: foto }));
  });
});
