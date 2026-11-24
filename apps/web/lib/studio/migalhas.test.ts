import { describe, expect, it } from 'vitest';
import { MODULES } from './modules';
import { migalhasDe } from './migalhas';

const rotulos = (p: string) => migalhasDe(p).map((m) => m.label);
const links = (p: string) => migalhasDe(p).map((m) => m.href ?? null);

describe('migalhasDe (Studio › Seção › Página)', () => {
  it('a raiz é /studio e a página atual não tem link', () => {
    expect(migalhasDe('/studio')).toEqual([{ label: 'Studio' }]);
    expect(migalhasDe('/studio/')).toEqual([{ label: 'Studio' }]);
    expect(migalhasDe('/studio/cms')).toEqual([{ label: 'Studio', href: '/studio' }, { label: 'CMS editorial' }]);
  });

  it('seção e página interna, com links nos níveis de cima', () => {
    expect(rotulos('/studio/cms/nova')).toEqual(['Studio', 'CMS editorial', 'Nova matéria']);
    expect(links('/studio/cms/nova')).toEqual(['/studio', '/studio/cms', null]);
    expect(rotulos('/studio/fontes/fabrica')).toEqual(['Studio', 'Banco de fontes', 'Fontes da Fábrica']);
    expect(rotulos('/studio/cms/checagem')).toEqual(['Studio', 'CMS editorial', 'Fila de checagem']);
  });

  it('páginas dinâmicas viram um rótulo, sem mostrar o identificador', () => {
    expect(rotulos('/studio/cms/3f2a9c1e-8d7b-4a55-9c0e-1b2c3d4e5f60')).toEqual(['Studio', 'CMS editorial', 'Matéria']);
    expect(rotulos('/studio/cms/abc/corrigir-fabrica')).toEqual(['Studio', 'CMS editorial', 'Matéria', 'Corrigir matéria da Fábrica']);
    expect(links('/studio/cms/abc/corrigir-fabrica')).toEqual(['/studio', '/studio/cms', '/studio/cms/abc', null]);
    expect(rotulos('/studio/fontes/rapida-aa11bb22')).toEqual(['Studio', 'Banco de fontes', 'Fonte']);
    expect(rotulos('/studio/campanhas/c1')).toEqual(['Studio', 'Campanhas', 'Campanha']);
  });

  it('agrupador sem página (pessoa) aparece sem link', () => {
    expect(rotulos('/studio/entidades/pessoa/p1')).toEqual(['Studio', 'Entity intelligence', 'Pessoas', 'Pessoa']);
    expect(links('/studio/entidades/pessoa/p1')).toEqual(['/studio', '/studio/entidades', null, null]);
    expect(rotulos('/studio/entidades/e1')).toEqual(['Studio', 'Entity intelligence', 'Empresa']);
  });

  it('seção fora do registro (conta) e caminho desconhecido têm rótulo legível', () => {
    expect(rotulos('/studio/conta')).toEqual(['Studio', 'Minha conta']);
    expect(rotulos('/studio/nova-area/pagina-x')).toEqual(['Studio', 'Nova area', 'Pagina x']);
  });

  it('ignora query, barra final e codificação inválida', () => {
    expect(rotulos('/studio/cms/?status=aprovado')).toEqual(['Studio', 'CMS editorial']);
    expect(rotulos('/studio/%E0%A4%A')).toHaveLength(2);
  });

  it('toda seção do registro de módulos tem o próprio nome na migalha', () => {
    for (const m of MODULES) expect(rotulos(`/studio/${m.slug}`)).toEqual(['Studio', m.nome]);
  });
});
