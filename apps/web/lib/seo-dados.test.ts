import { describe, expect, it } from 'vitest';
import { datasetLd, ogDaPagina } from '../app/(portal)/_lib/seo';

// Parecer QA 11 (42e80ab): og:url ausente nas páginas estáticas e nenhuma marcação Dataset nas páginas de dados.
describe('SEO de dados (parecer QA 11)', () => {
  it('ogDaPagina leva a URL canônica da própria página, não a da home', () => {
    const og = ogDaPagina({ title: 'Em alta', description: 'As mais lidas.', path: '/em-alta' });
    expect(og).toMatchObject({ url: '/em-alta', title: 'Em alta', siteName: 'Loyalty News' });
    expect(Array.isArray(og.images) && og.images.length).toBe(1);
  });

  it('Dataset tem nome, URL absoluta e creator; descrição/período/licença só quando declarados', () => {
    const comDescricao = datasetLd({ name: 'Empresas', description: 'Diretório de empresas.', path: '/intelligence/empresas' });
    expect(comDescricao).toMatchObject({
      '@type': 'Dataset',
      name: 'Empresas',
      description: 'Diretório de empresas.',
      creator: { '@type': 'Organization', name: 'Loyalty News' },
    });
    expect(comDescricao.url).toMatch(/\/(intelligence\/empresas)$/);

    // Sem lastro no corpo, os campos opcionais não aparecem: nada de período ou licença inventados.
    const semNada = datasetLd({ name: 'ACME', path: '/intelligence/empresas/x' });
    expect(semNada).not.toHaveProperty('description');
    expect(semNada).not.toHaveProperty('temporalCoverage');
    expect(semNada).not.toHaveProperty('license');
  });
});
