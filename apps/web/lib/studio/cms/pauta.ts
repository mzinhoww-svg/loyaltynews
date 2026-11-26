// Pauta AUTORAL (DP-29) no Studio: a redação propõe, âncoras em fontes PRIMÁRIAS habilitadas, a Fábrica editorial redige em comando próprio
// (editorial-factory --autoral, hoje só em simulação) e a matéria cai na fila de revisão comum. Funções puras; quem valida de verdade é o Backend (POST /api/studio/editorial/pautas, zod estrito, âncora em fonte
// primária do cadastro). Aqui só se evita mandar o que já se sabe inválido e se descreve o estado.

/** Fonte do registro da Fábrica (GET /sources), no que a pauta usa. */
export interface FonteRegistro {
  id: string;
  nome: string;
  kind: string;
  host: string;
  pathPrefix: string | null;
  habilitada: boolean;
  elegivel: boolean;
  acesso?: string;
}

export const FORMATOS: readonly { valor: string; rotulo: string }[] = [
  { valor: 'analise', rotulo: 'Análise' },
  { valor: 'explicador', rotulo: 'Explicador' },
  { valor: 'comparativo', rotulo: 'Comparativo' },
];
export const MIN_ANCORAS = 2;
export const MAX_ANCORAS = 8;

/** Fontes onde uma âncora pode cair: primárias, habilitadas e elegíveis. `ehPrimaria` vem de sourceTier de @ln/editorial. */
export function fontesDeAncora(fontes: readonly FonteRegistro[], ehPrimaria: (kind: string) => boolean): FonteRegistro[] {
  return fontes.filter((f) => f.habilitada && f.elegivel && ehPrimaria(f.kind));
}

/** A URL cai na fonte (mesmo host e prefixo de caminho), como a regra do Backend (primarySourceFor). */
export function urlCaiNaFonte(f: Pick<FonteRegistro, 'host' | 'pathPrefix'>, url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (u.host.toLowerCase() !== f.host.toLowerCase()) return false;
  const prefix = f.pathPrefix ?? '';
  return !prefix || u.pathname === prefix || u.pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

export const slugDoTitulo = (titulo: string): string =>
  titulo.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/g, '');

export interface PautaEntrada {
  id: string;
  titulo: string;
  angulo: string;
  formato: string;
  editoria: string;
  /** Pares (fonte escolhida, URL da página) na ordem do formulário; linha sem URL é ignorada. */
  ancoras: { fonteId: string; url: string }[];
}
export type ResultadoPauta = { ok: true; corpo: { id: string; titulo: string; angulo: string; formato: string; editoria: string; ancoras: string[] } } | { ok: false; erro: string };

/** Monta o corpo do POST. Âncora precisa cair na fonte escolhida E a fonte precisa estar entre as habilitadas; sem repetir URL. */
export function montarPauta(e: PautaEntrada, permitidas: readonly FonteRegistro[]): ResultadoPauta {
  const titulo = e.titulo.trim();
  if (titulo.length < 10 || titulo.length > 140) return { ok: false, erro: 'Título: de 10 a 140 caracteres.' };
  const id = (e.id.trim() || slugDoTitulo(e.titulo)).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length < 3 || id.length > 64) return { ok: false, erro: 'Identificador da pauta: use 3 a 64 caracteres, minúsculas, números e hífens.' };
  const angulo = e.angulo.trim();
  if (angulo.length < 20 || angulo.length > 600) return { ok: false, erro: 'Ângulo: de 20 a 600 caracteres.' };
  if (!FORMATOS.some((f) => f.valor === e.formato)) return { ok: false, erro: 'Escolha o formato da pauta.' };
  if (!e.editoria) return { ok: false, erro: 'Escolha a editoria.' };
  const usadas = e.ancoras.filter((a) => a.url.trim());
  if (usadas.length < MIN_ANCORAS) return { ok: false, erro: `Âncoras: escolha de ${MIN_ANCORAS} a ${MAX_ANCORAS} páginas de fontes primárias habilitadas (há ${usadas.length}).` };
  if (usadas.length > MAX_ANCORAS) return { ok: false, erro: `Âncoras: no máximo ${MAX_ANCORAS}.` };
  const urls: string[] = [];
  for (const [i, a] of usadas.entries()) {
    const fonte = permitidas.find((f) => f.id === a.fonteId);
    if (!fonte) return { ok: false, erro: `Âncora ${i + 1}: a fonte escolhida não é uma fonte primária habilitada.` };
    const url = a.url.trim();
    if (!urlCaiNaFonte(fonte, url)) return { ok: false, erro: `Âncora ${i + 1}: a página precisa ser https e ficar em ${fonte.host}${fonte.pathPrefix ?? ''} (fonte ${fonte.nome}).` };
    if (urls.includes(url)) return { ok: false, erro: `Âncora ${i + 1}: página repetida.` };
    urls.push(url);
  }
  return { ok: true, corpo: { id, titulo, angulo, formato: e.formato, editoria: e.editoria, ancoras: urls } };
}

export interface PautaVista {
  id: string;
  titulo: string;
  angulo: string;
  formato: string;
  editoria: string;
  ancoras: string[];
  submetidaPor: string | null;
  em: string;
  estado: 'pendente' | 'processada';
  resultado?: { status: string; articleId: string | null; blockers: string[]; findings: string[]; em: string };
}

export type EstadoPauta = 'fila' | 'aprovada' | 'bloqueada' | 'outro';

/** Estado para a tela: pendente (a Fábrica editorial ainda não rodou o comando), aprovada (matéria na revisão) ou bloqueada (com os motivos). */
export function estadoDaPauta(p: PautaVista): { chave: EstadoPauta; rotulo: string } {
  if (p.estado === 'pendente') return { chave: 'fila', rotulo: 'Pendente (aguardando a Fábrica editorial rodar em comando próprio)' };
  const s = p.resultado?.status ?? '';
  if (s === 'aprovado') return { chave: 'aprovada', rotulo: 'Aprovada (matéria na fila de revisão)' };
  if (s === 'bloqueado') return { chave: 'bloqueada', rotulo: 'Bloqueada' };
  return { chave: 'outro', rotulo: s ? `Processada: ${s}` : 'Processada' };
}
