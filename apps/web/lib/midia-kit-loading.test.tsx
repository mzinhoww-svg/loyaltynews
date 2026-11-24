import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Loading from '../app/(portal)/midia-kit/loading';

describe('esqueleto de carregamento do mídia kit (N-05)', () => {
  const html = renderToStaticMarkup(<Loading />);
  it('é um estado de carregando acessível, com texto só para leitor de tela', () => {
    expect(html).toContain('data-testid="portal-loading"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Carregando o mídia kit…');
  });
  it('imita a estrutura do mídia kit (faixa do topo, chips, métricas e tabela), não uma lista de matérias', () => {
    expect(html).toContain('data-skeleton="midia-kit"');
    // faixa do topo (240 px), 4 chips de 44 px, 3 cartões de métrica e 5 linhas de tabela
    expect(html).toContain('height:240px');
    expect((html.match(/border-radius:22px/g) ?? []).length).toBe(4);
    expect((html.match(/border:1px solid var\(--ln-color-border\)/g) ?? []).length).toBe(3);
    // a lista de matérias do esqueleto genérico tem miniatura de 120×72: não pode aparecer aqui
    expect(html).not.toContain('width:120px;height:72px');
  });
  it('não traz dado de exemplo nem texto de marca', () => {
    expect(html.replace(/<[^>]+>/g, '')).toBe('Carregando o mídia kit…');
  });
});
