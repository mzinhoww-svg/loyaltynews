// Migalhas (breadcrumbs) do Studio: Studio › Seção › Página, com /studio como raiz clicável. Montadas a partir do CAMINHO, para valer em todas as telas
// sem cada página repetir o seu: o nome da seção vem do registro de módulos; as páginas internas, de uma tabela de rotas (abaixo).
import { findModule } from './modules';

export interface Migalha {
  label: string;
  /** Ausente na página atual (e em níveis do caminho que não têm página própria). */
  href?: string;
}

/** Seções que não são módulos do registro. */
const SECOES_EXTRA: Record<string, string> = { conta: 'Minha conta' };

/** Páginas internas, pelo caminho depois de /studio/ (a primeira que casar vale: as estáticas vêm antes das dinâmicas). */
const PAGINAS: readonly (readonly [RegExp, string])[] = [
  [/^cms\/nova$/, 'Nova matéria'],
  [/^cms\/checagem$/, 'Fila de checagem'],
  [/^cms\/checagem\/[^/]+$/, 'Checagem da matéria'],
  [/^cms\/correcoes$/, 'Correções e direito de resposta'],
  [/^cms\/correcoes\/[^/]+$/, 'Caso de correção'],
  [/^cms\/pautas$/, 'Pautas autorais'],
  [/^cms\/[^/]+$/, 'Matéria'],
  [/^cms\/[^/]+\/corrigir-fabrica$/, 'Corrigir matéria da Fábrica'],
  [/^fontes\/fabrica$/, 'Fontes da Fábrica'],
  [/^fontes\/[^/]+$/, 'Fonte'],
  [/^entidades\/pessoa$/, 'Pessoas'],
  [/^entidades\/pessoa\/[^/]+$/, 'Pessoa'],
  [/^entidades\/[^/]+$/, 'Empresa'],
  [/^campanhas\/[^/]+$/, 'Campanha'],
  [/^campanhas\/[^/]+\/relatorio$/, 'Relatório da campanha'],
  [/^crm\/anunciantes$/, 'Anunciantes'],
  [/^crm\/anunciantes\/[^/]+$/, 'Anunciante'],
  [/^correcoes-titular\/[^/]+$/, 'Pedido do titular'],
  [/^organizacao\/[^/]+$/, 'Agente'],
  [/^social\/[^/]+$/, 'Pacote social'],
  [/^piloto\/importar$/, 'Importar folha do leitor 2'],
  [/^piloto\/violacoes$/, 'Violações do piloto'],
  [/^piloto\/[^/]+$/, 'Matéria do piloto'],
];

/** Níveis do caminho que existem só como agrupador (não há página para linkar). */
const SEM_PAGINA = new Set(['entidades/pessoa', 'crm/anunciantes']);

const decodifica = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const legivel = (seg: string) => {
  const t = decodifica(seg).replace(/[-_]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : seg;
};

/** Migalhas de um caminho do Studio. A última (página atual) não tem link; a raiz "Studio" leva a /studio. */
export function migalhasDe(pathname: string): Migalha[] {
  const limpo = pathname.split('?')[0]!.replace(/\/+$/, '');
  const resto = limpo.replace(/^\/studio\/?/, '');
  const segmentos = resto ? resto.split('/').filter(Boolean) : [];
  const itens: Migalha[] = [{ label: 'Studio', href: '/studio' }];
  segmentos.forEach((seg, i) => {
    const caminho = segmentos.slice(0, i + 1).join('/');
    const label =
      i === 0
        ? (findModule(seg)?.nome ?? SECOES_EXTRA[seg] ?? legivel(seg))
        : (PAGINAS.find(([re]) => re.test(caminho))?.[1] ?? legivel(seg));
    itens.push(i < segmentos.length - 1 && !SEM_PAGINA.has(caminho) ? { label, href: `/studio/${caminho}` } : { label });
  });
  // a página atual nunca tem link
  const ultimo = itens.length - 1;
  if (itens[ultimo]!.href) itens[ultimo] = { label: itens[ultimo]!.label };
  return itens;
}
