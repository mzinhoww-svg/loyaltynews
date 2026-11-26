import { describe, expect, it } from 'vitest';
import { ativoEm, grupoAtivo, gruposDoMenu, type NavItem } from './menu';

const itens: NavItem[] = [
  { slug: 'cms', nome: 'CMS editorial', grupo: 'Editorial', flagDesligada: false },
  { slug: 'fontes', nome: 'Banco de fontes', grupo: 'Editorial', flagDesligada: false },
  { slug: 'social', nome: 'Social dashboard', grupo: 'Distribuição', flagDesligada: true },
  { slug: 'crm', nome: 'CRM', grupo: 'Comercial', flagDesligada: false },
];

describe('menu do Studio', () => {
  it('agrupa na ordem de aparição e mantém o selo de desligado', () => {
    const g = gruposDoMenu(itens);
    expect(g.map((x) => x.titulo)).toEqual(['Editorial', 'Distribuição', 'Comercial']);
    expect(g[0]!.itens.map((i) => i.href)).toEqual(['/studio/cms', '/studio/fontes']);
    expect(g[1]!.itens[0]!.flagDesligada).toBe(true);
  });

  it('item ativo: a própria página e as de dentro dela; a visão geral só em /studio', () => {
    expect(ativoEm('/studio/cms', '/studio/cms')).toBe(true);
    expect(ativoEm('/studio/cms/nova', '/studio/cms')).toBe(true);
    expect(ativoEm('/studio/cmsx', '/studio/cms')).toBe(false); // prefixo de texto não é de caminho
    expect(ativoEm('/studio/cms', '/studio')).toBe(false);
    expect(ativoEm('/studio', '/studio')).toBe(true);
  });

  it('o grupo da tela atual é o que abre sozinho (nenhum na visão geral)', () => {
    const g = gruposDoMenu(itens);
    expect(grupoAtivo(g, '/studio/cms/checagem')).toBe('Editorial');
    expect(grupoAtivo(g, '/studio/crm')).toBe('Comercial');
    expect(grupoAtivo(g, '/studio')).toBeNull();
    expect(grupoAtivo(g, '/studio/conta')).toBeNull(); // fora do menu
  });
});
