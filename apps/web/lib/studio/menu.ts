// Menu lateral do Studio: agrupamento e item ativo (puro, testável sem navegador).
export interface NavItem {
  slug: string;
  nome: string;
  grupo: string;
  /** true quando o módulo depende de flag desligada. */
  flagDesligada: boolean;
}

export interface GrupoMenu {
  titulo: string;
  itens: { slug: string; nome: string; href: string; flagDesligada: boolean }[];
}

/** Agrupa na ordem em que os grupos aparecem na lista. */
export const gruposDoMenu = (itens: readonly NavItem[]): GrupoMenu[] =>
  [...new Set(itens.map((i) => i.grupo))].map((titulo) => ({
    titulo,
    itens: itens.filter((i) => i.grupo === titulo).map((i) => ({ slug: i.slug, nome: i.nome, href: `/studio/${i.slug}`, flagDesligada: i.flagDesligada })),
  }));

/** A página é a do item, ou uma página dentro dele (/studio/cms/nova pertence a /studio/cms). A visão geral só vale em /studio. */
export const ativoEm = (pathname: string, href: string): boolean => (href === '/studio' ? pathname === '/studio' : pathname === href || pathname.startsWith(`${href}/`));

/** Título do grupo que contém a página atual (null na visão geral e em páginas fora do menu). */
export const grupoAtivo = (grupos: readonly GrupoMenu[], pathname: string): string | null => grupos.find((g) => g.itens.some((i) => ativoEm(pathname, i.href)))?.titulo ?? null;
