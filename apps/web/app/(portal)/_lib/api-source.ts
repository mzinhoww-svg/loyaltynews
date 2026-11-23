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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/**
 * Item da listagem pública em formato aceitável (campos mínimos que a tela usa). Item nulo, fora do formato ou com data inválida
 * é DESCARTADO: um item ruim nunca derruba a página (formatDate lança com data inválida) nem vira "MOCK".
 */
export function isRawListItem(v: unknown): v is RawListItem {
  return (
    isObj(v) &&
    isStr(v.slug) &&
    isStr(v.titulo) &&
    typeof v.resumo === 'string' &&
    isStr(v.editoria) &&
    isStr(v.assinatura) &&
    isDate(v.publicadoEm) &&
    (v.subtitulo == null || typeof v.subtitulo === 'string') &&
    (v.tipoConteudo == null || typeof v.tipoConteudo === 'string') &&
    (v.tempoLeituraMin == null || (typeof v.tempoLeituraMin === 'number' && Number.isFinite(v.tempoLeituraMin))) &&
    (v.imagem == null || isObj(v.imagem))
  );
}

export function isRawArticle(v: unknown): v is RawArticle {
  return isRawListItem(v) && typeof (v as { corpo?: unknown }).corpo === 'string';
}

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
  const erratas = (Array.isArray(r.erratas) ? r.erratas : []).filter((e) => isObj(e) && isStr(e.nota) && isDate(e.em));
  const fontes = (Array.isArray(r.fontes) ? r.fontes : []).filter((f) => isObj(f) && isStr(f.url));
  return {
    ...mapListItem(r),
    updatedAt: erratas.at(-1)?.em,
    image: mapImage(r.imagem),
    body: bodyToBlocks(r.corpo),
    sources: fontes.map((f) => ({ label: host(f.url), url: f.url, publishedAt: isDate(f.capturadoEm) ? f.capturadoEm : undefined })),
    corrections: erratas.map((e) => ({ at: e.em, text: e.nota as string })),
  };
}

export type ApiSlice = Pick<PortalSource, 'getHighlights' | 'getTrending' | 'getLatest' | 'getArticle' | 'getRelated' | 'search'>;

const emptyPage = (page: number, pageSize: number): Page<Article> => ({ items: [], page, pageSize, total: 0 });

/** Tempo máximo de espera pela API pública: página lenta não pode travar o portal. */
const API_TIMEOUT_MS = 5000;
/** Intervalo mínimo entre logs do mesmo tipo (a API fora do ar não pode inundar o log a cada requisição). */
const LOG_EVERY_MS = 60_000;

/**
 * HTTP tolerante a falha da API pública, compartilhado pelo adaptador de matérias e pelo da configuração do site:
 * `get` devolve a resposta ou null (rede, recusa de conexão, timeout); `logFalha` registra só classe/status, 1 por minuto e tipo.
 */
export function createApiHttp(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  const base = baseUrl.replace(/\/$/, '');
  const lastLog = new Map<string, number>();
  const logFalha = (what: string, motivo: string) => {
    const now = Date.now();
    if (now - (lastLog.get(what) ?? 0) < LOG_EVERY_MS) return;
    lastLog.set(what, now);
    console.error(`[portal] API pública indisponível (${what}): ${motivo}; exibindo estado vazio`);
  };
  const get = async (path: string, what: string): Promise<Response | null> => {
    try {
      // no-store: leitura sempre dinâmica (nunca congela uma resposta da API no build).
      return await fetchImpl(`${base}${path}`, { cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    } catch (e) {
      logFalha(what, e instanceof Error ? e.name : 'erro de rede');
      return null;
    }
  };
  return { get, logFalha };
}

/**
 * Falha da API (decisão do Security, regra A6): rede, timeout, status não-OK ou JSON inválido NUNCA derrubam a página.
 * Listagens viram estado vazio honesto; matéria vira "não encontrada". O log leva só a classe do erro e o status
 * (nunca URL, corpo da resposta, cabeçalhos ou dados do leitor) e é limitado a um por minuto e tipo.
 */
export function createApiSlice(baseUrl: string, fetchImpl: typeof fetch = fetch): ApiSlice {
  const { get, logFalha } = createApiHttp(baseUrl, fetchImpl);

  async function list(params: Record<string, string | number | undefined>): Promise<{ items: RawListItem[]; total: number }> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
    const res = await get(`/api/publico/materias?${qs}`, 'matérias');
    if (!res) return { items: [], total: 0 };
    if (!res.ok) {
      logFalha('matérias', `status ${res.status}`);
      return { items: [], total: 0 };
    }
    try {
      const j = (await res.json()) as { data?: unknown; total?: unknown };
      // Formato do envelope: data é lista e total é número finito não negativo; "total": "12" (texto) é resposta inválida.
      if (!Array.isArray(j.data) || typeof j.total !== 'number' || !Number.isFinite(j.total) || j.total < 0) throw new Error('formato');
      const items = j.data.filter(isRawListItem);
      if (items.length < j.data.length) logFalha('matérias', `${j.data.length - items.length} item(ns) inválido(s) descartado(s)`);
      return { items, total: j.total };
    } catch {
      logFalha('matérias', 'resposta inválida');
      return { items: [], total: 0 };
    }
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
      const res = await get(`/api/publico/materias/${encodeURIComponent(slug)}`, 'matéria');
      if (!res || res.status === 404) return null;
      if (!res.ok) {
        // Falha da API não é "matéria inexistente", mas a página só tem duas saídas honestas: 404 do portal (sem 500).
        logFalha('matéria', `status ${res.status}`);
        return null;
      }
      try {
        const data = ((await res.json()) as { data?: unknown }).data;
        if (!isRawArticle(data)) throw new Error('formato');
        return mapArticle(data);
      } catch {
        logFalha('matéria', 'resposta inválida');
        return null;
      }
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
