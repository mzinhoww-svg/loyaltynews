import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScrollRegion } from '../app/(portal)/_components/ScrollRegion';

describe('ScrollRegion (UI/UX P2-1)', () => {
  const html = renderToStaticMarkup(createElement(ScrollRegion, { label: 'Preços de referência: Banners', children: createElement('table') }));
  it('é focável, tem papel de região e nome acessível com o assunto da tabela', () => {
    expect(html).toContain('class="pt-scroll"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Preços de referência: Banners (tabela com rolagem lateral)"');
  });
  it('o rótulo vindo de dados é escapado', () => {
    const m = renderToStaticMarkup(createElement(ScrollRegion, { label: '"><script>x</script>', children: null }));
    expect(m).not.toContain('<script>');
  });
});
