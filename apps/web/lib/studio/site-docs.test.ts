import { describe, expect, it } from 'vitest';
import { HOME_PADRAO, MENU_PADRAO, descreverBloco, idUnico, linhasParaLista, mover, novoBloco, remover, retornoSeguro } from './site-docs';

describe('edição de documentos do site', () => {
  it('mover e remover não mutam e respeitam os limites', () => {
    const l = ['a', 'b', 'c'];
    expect(mover(l, 0, -1)).toEqual(['a', 'b', 'c']);
    expect(mover(l, 2, 1)).toEqual(['a', 'b', 'c']);
    expect(mover(l, 1, -1)).toEqual(['b', 'a', 'c']);
    expect(mover(l, 1, 1)).toEqual(['a', 'c', 'b']);
    expect(remover(l, 1)).toEqual(['a', 'c']);
    expect(l).toEqual(['a', 'b', 'c']);
  });
  it('ids únicos no formato do Backend', () => {
    expect(idUnico('Últimas Notícias', [])).toBe('ultimas-noticias');
    expect(idUnico('destaque', ['destaque'])).toBe('destaque-2');
    expect(idUnico('destaque', ['destaque', 'destaque-2'])).toBe('destaque-3');
    expect(idUnico('!!!', [])).toBe('bloco');
  });
  it('monta cada tipo de bloco com padrões e deixa a validação para o Backend', () => {
    expect(novoBloco('ultimas', {}, [])).toEqual({ tipo: 'ultimas', id: 'ultimas', limite: 10 });
    expect(novoBloco('destaque', { materiaSlugs: 'a-b, c-d  e-f', titulo: 'Em foco' }, [])).toEqual({ tipo: 'destaque', id: 'destaque', titulo: 'Em foco', materiaSlugs: ['a-b', 'c-d', 'e-f'] });
    expect(novoBloco('lista_editoria', { editoria: 'pontos', limite: 'x' }, [])).toMatchObject({ editoria: 'pontos', limite: 6 });
    expect(novoBloco('agenda', { limite: '3' }, ['agenda'])).toMatchObject({ id: 'agenda-2', limite: 3 });
    expect(novoBloco('publicidade', { posicao: 'TOP' }, [])).toEqual({ tipo: 'publicidade', id: 'publicidade', posicao: 'TOP' });
  });
  it('descreve blocos em português', () => {
    expect(descreverBloco({ tipo: 'publicidade', id: 'p', posicao: 'TOP' })).toBe('Publicidade na posição TOP');
    expect(descreverBloco(HOME_PADRAO.blocos[0]!)).toBe('Últimas (10)');
  });
  it('padrões válidos para começar um documento', () => {
    expect(HOME_PADRAO.blocos).toHaveLength(1);
    expect(MENU_PADRAO.itens[0]).toMatchObject({ rotulo: 'Início', destino: '/' });
  });
  it('retorno só para dentro do Studio', () => {
    expect(retornoSeguro('/studio/home-menus?tipo=home', '/studio')).toBe('/studio/home-menus?tipo=home');
    expect(retornoSeguro('https://evil.com', '/studio')).toBe('/studio');
    expect(retornoSeguro('//evil.com', '/studio')).toBe('/studio');
    expect(retornoSeguro('/api/x', '/studio')).toBe('/studio');
    expect(retornoSeguro(undefined, '/studio/seo')).toBe('/studio/seo');
  });
  it('linhas viram lista sem vazios', () => {
    expect(linhasParaLista(' a \r\n\r\n b\nc ')).toEqual(['a', 'b', 'c']);
    expect(linhasParaLista(undefined)).toEqual([]);
  });
});
