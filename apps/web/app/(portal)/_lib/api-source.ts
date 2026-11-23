import { imageLabel } from '@ln/contracts';
import type { Article, ArticleBlock, ArticleImage, ContentType, Page, PortalSource } from './types';

/**
 * Adaptador `api`: lê as rotas públicas do Backend (`/api/publico/*`, sem login).
 * Formato conforme apps/web/app/api/_lib/articles.ts (publicListArticles, publicGetArticle).
 * O portal nunca vê id, status, versão nem classe de dado: só os campos públicos explícitos.
 */

const CONTENT_TYPES: readonly ContentType[] = ['noticia', 'flash', 'analise', 'entrevista', 'opiniao', 'estudo', 'patrocinado', 'cobertura_evento'];
const asContentType = (v: unknown): ContentType => (CONTENT_TYPES.includes(v as ContentType) ? (v as ContentType) : 'noticia');

export interface RawImage {
  url: string;
  /** Presente na leitura da matéria; a listagem pública traz só o rótulo pronto. */
  origem?: string;
  credito: string;
  link?: string;
  textoAlternativo: string;
  /** Rótulo visível calculado pelo Backend (imageLabel); null = sem rótulo. */
  rotulo?: string | null;
}
export interface RawListItem {
  slug: string;
  titulo: string;
  subtitulo?: string | null;
  resumo: string;
  tipoConteudo?: string | null;
  tempoLeituraMin?: number;
  editoria: string;
  assinatura: string;
  patrocinado?: boolean;
  publicadoEm: string;
  corrigida?: boolean;
  /** Imagem do card (url pública, alt, crédito, rótulo) ou null. */
  imagem?: RawImage | null;
}
export interface RawArticle extends Omit<RawListItem, 'corrigida'> {
  corpo: string;
  imagem?: RawImage | null;
  fontes?: { sourceId?: string; url: string; capturadoEm?: string }[];
  erratas?: { nota: string | null; em: string }[];
}

const AVISOS = '\n\nAvisos:\n';
const FONTES = '\n\nFontes:\n';

/**
 * O corpo publicado traz, ao final, os blocos "Avisos:" e "Fontes:" (ADR-019). O portal os exibe em seções próprias
 * (errata em destaque, fontes com link), então aqui eles saem do texto corrido.
 */
export function mainBody(corpo: string): string {
  const cuts = [AVISOS, FONTES].map((m) => corpo.indexOf(m)).filter((i) => i >= 0);
  return (cuts.length ? corpo.slice(0, Math.min(...cuts)) : corpo).trim();
}

/** Texto simples em blocos: "## título" vira subtítulo, "> citação" vira citação, o resto é parágrafo. */
export function bodyToBlocks(corpo: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  for (const chunk of mainBody(corpo).split(/\n{2,}/)) {
    const text = chunk.trim();
    if (!text) continue;
    if (/^#{1,3}\s+/.test(text) && !text.includes('\n')) blocks.push({ type: 'heading', text: text.replace(/^#{1,3}\s+/, '') });
    else if (text.startsWith('> ')) blocks.push({ type: 'quote', text: text.replace(/^>\s?/gm, '') });
    else blocks.push({ type: 'paragraph', text });
  }
  return blocks;
}

/** `imagem: null` (vencida, sem base de direito ou sem arquivo) vira ausência de imagem; nunca imagem quebrada. */
export function mapImage(img: RawImage | null | undefined): ArticleImage | undefined {
  if (!img || typeof img.url !== 'string' || !img.url) return undefined;
  return {
    src: img.url,
    alt: img.textoAlternativo,
    credit: img.credito,
    // O rótulo vem pronto do Backend; sem ele (resposta antiga), calcula pela origem (ADR-018).
    label: img.rotulo !== undefined ? img.rotulo : img.origem ? imageLabel({ origem: img.origem as never }) : null,
    link: img.link,
  };
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function mapListItem(r: RawListItem): Article {
  return {
    slug: r.slug,
    title: r.titulo,
    subtitle: r.subtitulo ?? undefined,
    summary: r.resumo,
    editoriaSlug: r.editoria,
    contentType: asContentType(r.tipoConteudo),
    authorLabel: r.assinatura,
    publishedAt: r.publicadoEm,
    readingMinutes: r.tempoLeituraMin ?? 1,
    image: mapImage(r.imagem),
    body: [],
    sources: [],
    corrections: [],
    tags: [],
    sponsored: r.patrocinado,
  };
}

export function mapArticle(r: RawArticle): Article {
  const erratas = (r.erratas ?? []).filter((e) => e.nota);
  return {
    ...mapListItem(r),
    updatedAt: erratas.at(-1)?.em,
    image: mapImage(r.imagem),
    body: bodyToBlocks(r.corpo),
    sources: (r.fontes ?? []).map((f) => ({ label: host(f.url), url: f.url, publishedAt: f.capturadoEm })),
    corrections: erratas.map((e) => ({ at: e.em, text: e.nota as string })),
  };
}

export type ApiSlice = Pick<PortalSource, 'getHighlights' | 'getTrending' | 'getLatest' | 'getArticle' | 'getRelated' | 'search'>;

const emptyPage = (page: number, pageSize: number): Page<Article> => ({ items: [], page, pageSize, total: 0 });

export function createApiSlice(baseUrl: string, fetchImpl: typeof fetch = fetch): ApiSlice {
  const base = baseUrl.replace(/\/$/, '');
  // no-store: leitura sempre dinâmica (nunca congela uma resposta da API no build).
  const get = async (path: string): Promise<Response> => fetchImpl(`${base}${path}`, { cache: 'no-store', headers: { accept: 'application/json' } });

  async function list(params: Record<string, string | number | undefined>): Promise<{ items: RawListItem[]; total: number }> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const res = await get(`/api/publico/materias?${qs}`);
    if (!res.ok) throw new Error(`API pública de matérias respondeu ${res.status}`);
    const j = (await res.json()) as { data: RawListItem[]; total: number };
    return { items: j.data, total: j.total };
  }

  async function page(q: { page?: number; pageSize?: number; editoriaSlug?: string; contentType?: ContentType; q?: string }): Promise<Page<Article>> {
    const pageNo = Math.max(1, q.page ?? 1);
    const size = q.pageSize ?? 12;
    if (q.contentType) {
      // A API filtra por editoria e texto, não por tipo: filtra aqui (até 100 itens recentes) e pagina localmente.
      const r = await list({ limit: 100, offset: 0, editoria: q.editoriaSlug, q: q.q });
      const all = r.items.filter((i) => asContentType(i.tipoConteudo) === q.contentType);
      return { items: all.slice((pageNo - 1) * size, pageNo * size).map(mapListItem), page: pageNo, pageSize: size, total: all.length };
    }
    const r = await list({ limit: size, offset: (pageNo - 1) * size, editoria: q.editoriaSlug, q: q.q });
    return { items: r.items.map(mapListItem), page: pageNo, pageSize: size, total: r.total };
  }

  return {
    async getHighlights() {
      return (await page({ pageSize: 6 })).items;
    },
    // Sem ranking de leitura real não há "em alta": estado vazio honesto (nada é simulado).
    async getTrending() {
      return [];
    },
    getLatest: (q) => page(q ?? {}),
    async getArticle(slug) {
      const res = await get(`/api/publico/materias/${encodeURIComponent(slug)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`API pública de matéria respondeu ${res.status}`);
      return mapArticle(((await res.json()) as { data: RawArticle }).data);
    },
    async getRelated(article, limit = 3) {
      const r = await page({ pageSize: limit + 1, editoriaSlug: article.editoriaSlug });
      return r.items.filter((a) => a.slug !== article.slug).slice(0, limit);
    },
    async search(q, pageNo = 1) {
      const term = q.trim().slice(0, 120);
      return term ? page({ q: term, page: pageNo }) : emptyPage(pageNo, 12);
    },
  };
}
