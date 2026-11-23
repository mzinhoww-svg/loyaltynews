// Edição dos documentos do site (home, menus, links internos) no Studio. Funções PURAS sobre o conteúdo; quem valida e
// persiste é o Backend (/api/site/**): o conteúdo volta como rascunho e o Backend recusa o que for inválido.
export const TIPOS_DOC = ['home', 'menu_principal', 'menu_rodape', 'seo_global', 'links_internos'] as const;
export type TipoDoc = (typeof TIPOS_DOC)[number];

export const ROTULO_TIPO: Record<TipoDoc, string> = {
  home: 'Home',
  menu_principal: 'Menu principal',
  menu_rodape: 'Menu do rodapé',
  seo_global: 'SEO global',
  links_internos: 'Links internos',
};

export type Bloco =
  | { tipo: 'destaque'; id: string; titulo?: string; materiaSlugs: string[] }
  | { tipo: 'lista_editoria'; id: string; titulo?: string; editoria: string; limite: number }
  | { tipo: 'ultimas'; id: string; titulo?: string; limite: number }
  | { tipo: 'agenda'; id: string; titulo?: string; limite: number }
  | { tipo: 'publicidade'; id: string; posicao: string };

export interface HomeConteudo {
  blocos: Bloco[];
}
export interface MenuItem {
  rotulo: string;
  destino: string;
  filhos: { rotulo: string; destino: string }[];
}
export interface MenuConteudo {
  itens: MenuItem[];
}
export interface LinksConteudo {
  regras: { termo: string; destino: string }[];
}

export const HOME_PADRAO: HomeConteudo = { blocos: [{ tipo: 'ultimas', id: 'ultimas', limite: 10 }] };
export const MENU_PADRAO: MenuConteudo = { itens: [{ rotulo: 'Início', destino: '/', filhos: [] }] };
export const LINKS_PADRAO: LinksConteudo = { regras: [] };

export function mover<T>(lista: readonly T[], i: number, dir: -1 | 1): T[] {
  const out = [...lista];
  const j = i + dir;
  if (i < 0 || i >= out.length || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export function remover<T>(lista: readonly T[], i: number): T[] {
  return lista.filter((_, k) => k !== i);
}

/** Id único e legível (`tipo`, `tipo-2`, …) no formato aceito pelo Backend (minúsculas, números e hífens). */
export function idUnico(base: string, usados: readonly string[]): string {
  const limpo = base.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'bloco';
  if (!usados.includes(limpo)) return limpo;
  for (let n = 2; ; n++) {
    const c = `${limpo}-${n}`;
    if (!usados.includes(c)) return c;
  }
}

const inteiro = (v: string | undefined, padrao: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : padrao;
};

/** Monta um bloco novo a partir dos campos do formulário. Valores inválidos passam adiante: o Backend decide e recusa. */
export function novoBloco(tipo: string, campos: Record<string, string>, usados: readonly string[]): Bloco {
  const titulo = campos.titulo?.trim() || undefined;
  const id = idUnico(campos.id?.trim() || tipo, usados);
  const base = titulo ? { titulo } : {};
  switch (tipo) {
    case 'destaque':
      return { tipo, id, ...base, materiaSlugs: (campos.materiaSlugs ?? '').split(/[\s,]+/).filter(Boolean) };
    case 'lista_editoria':
      return { tipo, id, ...base, editoria: campos.editoria ?? '', limite: inteiro(campos.limite, 6) };
    case 'agenda':
      return { tipo, id, ...base, limite: inteiro(campos.limite, 5) };
    case 'publicidade':
      return { tipo, id, posicao: campos.posicao ?? '' };
    default:
      return { tipo: 'ultimas', id, ...base, limite: inteiro(campos.limite, 10) };
  }
}

export function descreverBloco(b: Bloco): string {
  switch (b.tipo) {
    case 'destaque':
      return `Destaque${b.titulo ? ` “${b.titulo}”` : ''}: ${b.materiaSlugs.join(', ') || '(sem matérias)'}`;
    case 'lista_editoria':
      return `Editoria ${b.editoria} (${b.limite})${b.titulo ? ` “${b.titulo}”` : ''}`;
    case 'ultimas':
      return `Últimas (${b.limite})${b.titulo ? ` “${b.titulo}”` : ''}`;
    case 'agenda':
      return `Agenda (${b.limite})${b.titulo ? ` “${b.titulo}”` : ''}`;
    case 'publicidade':
      return `Publicidade na posição ${b.posicao}`;
  }
}

/** Evita redirecionar para fora do Studio a partir de um campo de formulário. */
export const retornoSeguro = (v: string | undefined, padrao: string): string => (v && /^\/studio\/[a-z0-9\-/?=&_]*$/i.test(v) ? v : padrao);

export function linhasParaLista(v: string | undefined): string[] {
  return (v ?? '')
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export interface SeoConteudo {
  tituloPadrao: string;
  descricaoPadrao: string;
  imagemOgUrl?: string;
  indexacao: 'indexar' | 'noindex';
  sitemap: { incluirMaterias: boolean };
  dadosEstruturados: { organizacao: { nome: string; url: string; logoUrl?: string; sameAs: string[] } };
}

/** Formulário em branco quando nada foi gravado: o que falta o Backend recusa ao salvar. Nada é publicado sozinho. */
export const SEO_PADRAO: SeoConteudo = {
  tituloPadrao: 'Loyalty News',
  descricaoPadrao: '',
  indexacao: 'indexar',
  sitemap: { incluirMaterias: true },
  dadosEstruturados: { organizacao: { nome: 'Loyalty News', url: '', sameAs: [] } },
};

/** Edita um bloco no lugar: mantém o tipo e o id, troca os campos do formulário. Valores inválidos passam adiante: o Backend decide. */
export function editarBloco(b: Bloco, campos: Record<string, string>): Bloco {
  return novoBloco(b.tipo, { ...campos, id: b.id }, []);
}

export function editarItem(itens: readonly MenuItem[], i: number, campos: { rotulo: string; destino: string }): MenuItem[] {
  return itens.map((it, k) => (k === i ? { ...it, rotulo: campos.rotulo, destino: campos.destino } : it));
}

export function removerFilho(itens: readonly MenuItem[], i: number, j: number): MenuItem[] {
  return itens.map((it, k) => (k === i ? { ...it, filhos: it.filhos.filter((_, n) => n !== j) } : it));
}
