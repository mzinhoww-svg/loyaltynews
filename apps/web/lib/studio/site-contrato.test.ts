import { describe, expect, it } from 'vitest';
import { CONTEUDO } from '../../app/api/_lib/site/content';
import { HOME_PADRAO, LINKS_PADRAO, MENU_PADRAO, SEO_PADRAO, editarBloco, editarItem, novoBloco, removerFilho, type Bloco, type HomeConteudo, type SeoConteudo } from './site-docs';

// O que o Studio grava como rascunho precisa ser aceito pelo contrato do Backend (/api/site/**), que é o que alimenta /api/publico/site.
const valida = (tipo: keyof typeof CONTEUDO, conteudo: unknown) => CONTEUDO[tipo]!.safeParse(conteudo);

describe('conteúdo do Studio × contrato do Backend', () => {
  it('padrões de home, menus e links são aceitos', () => {
    expect(valida('home', HOME_PADRAO).success).toBe(true);
    expect(valida('menu_principal', MENU_PADRAO).success).toBe(true);
    expect(valida('menu_rodape', MENU_PADRAO).success).toBe(true);
    expect(valida('links_internos', LINKS_PADRAO).success).toBe(true);
  });

  it('cada tipo de bloco montado pelo formulário é aceito', () => {
    const blocos: Bloco[] = [
      novoBloco('destaque', { materiaSlugs: 'materia-a, materia-b', titulo: 'Em destaque' }, []),
      novoBloco('lista_editoria', { editoria: 'pontos', limite: '4' }, ['destaque']),
      novoBloco('ultimas', { limite: '8' }, ['destaque', 'lista-editoria']),
      novoBloco('agenda', { limite: '3' }, ['destaque', 'lista-editoria', 'ultimas']),
      novoBloco('publicidade', { posicao: 'TOP' }, ['destaque', 'lista-editoria', 'ultimas', 'agenda']),
    ];
    const home: HomeConteudo = { blocos };
    const r = valida('home', home);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it('blocos editados no lugar continuam válidos', () => {
    const b = editarBloco({ tipo: 'lista_editoria', id: 'pontos', editoria: 'pontos', limite: 6 }, { titulo: 'Pontos', editoria: 'bancos', limite: '3' });
    expect(valida('home', { blocos: [b] }).success).toBe(true);
  });

  it('menus com subitens, edição de item e remoção de subitem', () => {
    const itens = [{ rotulo: 'Início', destino: '/', filhos: [{ rotulo: 'Pontos', destino: '/editoria/pontos' }, { rotulo: 'Milhas', destino: 'https://exemplo.com.br/milhas' }] }];
    expect(valida('menu_principal', { itens }).success).toBe(true);
    expect(valida('menu_principal', { itens: editarItem(itens, 0, { rotulo: 'Home', destino: '/' }) }).success).toBe(true);
    expect(valida('menu_principal', { itens: removerFilho(itens, 0, 1) }).success).toBe(true);
  });

  it('destino reservado (/api, /studio) é recusado pelo Backend: o Studio só repassa a recusa', () => {
    expect(valida('menu_principal', { itens: [{ rotulo: 'X', destino: '/api/segredo', filhos: [] }] }).success).toBe(false);
    expect(valida('links_internos', { regras: [{ termo: 'milhas', destino: '/studio' }] }).success).toBe(false);
  });

  it('SEO global como o formulário monta (campos opcionais omitidos) é aceito; o formulário em branco é recusado', () => {
    const seo: SeoConteudo = {
      tituloPadrao: 'Loyalty News',
      descricaoPadrao: 'Notícias de fidelidade.',
      imagemOgUrl: 'https://portal.example.test/og.png',
      indexacao: 'indexar',
      sitemap: { incluirMaterias: true },
      dadosEstruturados: { organizacao: { nome: 'Loyalty News', url: 'https://portal.example.test', sameAs: ['https://www.linkedin.com/company/x'] } },
    };
    const r = valida('seo_global', seo);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(valida('seo_global', SEO_PADRAO).success).toBe(false); // sem descrição e sem URL: nada é inventado
  });

  it('links internos: termo repetido (sem diferenciar maiúscula) é recusado', () => {
    expect(valida('links_internos', { regras: [{ termo: 'Milhas', destino: '/a' }, { termo: 'milhas', destino: '/b' }] }).success).toBe(false);
  });
});
