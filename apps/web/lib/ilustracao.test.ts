import { EDITORIAS } from '@ln/contracts';
import { describe, expect, it } from 'vitest';
import { ILUSTRACAO_POR_EDITORIA, imagemDoCard, TIPOS_COM_ILUSTRACAO } from '../app/(portal)/_lib/ilustracao';
import type { Article, ContentType } from '../app/(portal)/_lib/types';

/** F-04: ilustração conceitual padrão só de exibição, só para matéria sem imagem (parecer da Editorial). */
function artigo(p: Partial<Article> = {}): Article {
  return {
    slug: 'a', title: 'T', summary: 'S', editoriaSlug: 'travel', contentType: 'noticia', authorLabel: 'Redação Loyalty News',
    publishedAt: '2026-11-20T10:00:00-03:00', readingMinutes: 3, body: [], sources: [], corrections: [], tags: [], ...p,
  } as Article;
}

describe('imagemDoCard (F-04)', () => {
  it('as 10 editorias têm ilustração e só as 3 do Brandkit são usadas', () => {
    expect(EDITORIAS.every((e) => ILUSTRACAO_POR_EDITORIA[e.slug])).toBe(true);
    expect(new Set(Object.values(ILUSTRACAO_POR_EDITORIA))).toEqual(new Set(['viagem', 'varejo', 'pagamentos']));
  });

  it('sem imagem publicada, notícia/flash/estudo ganham a ilustração da editoria com rótulo, crédito e alt sem citar IA', () => {
    for (const t of ['noticia', 'flash', 'estudo'] as ContentType[]) {
      const img = imagemDoCard(artigo({ contentType: t, editoriaSlug: 'bancos' }));
      expect(img).toMatchObject({ src: '/ilustracoes/pagamentos.svg', label: 'Ilustração conceitual', credit: 'Loyalty News' });
      expect(img?.alt).toMatch(/^Ilustração conceitual de /);
      expect(img?.alt).not.toMatch(/\bIA\b|modelo|prompt|gerad/i);
    }
  });

  it('a imagem publicada sempre vence (foto de terceiro continua com o crédito dela e sem rótulo)', () => {
    const foto = { src: '/api/publico/midia/foto-1', alt: 'x', credit: 'Fotógrafo', label: null };
    expect(imagemDoCard(artigo({ image: foto }))).toBe(foto);
  });

  it('análise, entrevista, opinião, patrocinado e cobertura de evento ficam só texto', () => {
    for (const t of ['analise', 'entrevista', 'opiniao', 'patrocinado', 'cobertura_evento'] as ContentType[]) {
      expect(TIPOS_COM_ILUSTRACAO).not.toContain(t);
      expect(imagemDoCard(artigo({ contentType: t }))).toBeUndefined();
    }
  });

  it('matéria com correção fica sem a ilustração padrão', () => {
    expect(imagemDoCard(artigo({ corrections: [{ at: '2026-11-20T16:00:00-03:00', text: 'x' }] }))).toBeUndefined();
  });

  it('editoria desconhecida não inventa ilustração', () => {
    expect(imagemDoCard(artigo({ editoriaSlug: 'inexistente' }))).toBeUndefined();
  });
});
