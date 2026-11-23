import { z } from 'zod';
import { readOnlyTransport, type McpTransport } from '../mlabs/live';

// Métricas do canal LinkedIn lidas do mLabs, SOMENTE LEITURA, para o painel social do Studio (Social Dashboard).
// Regras: (1) só passam ferramentas da lista de leitura (`readOnlyTransport`); nenhuma escrita, nada é publicado; (2) nenhum número
// inventado: campo que o mLabs não devolve fica `null`, nunca 0; falha da leitura vira `indisponivel` com um motivo curto, sem
// derrubar o painel e sem repassar o texto do erro; (3) cada leitura carrega período, origem e horário (fetchedAt); (4) cache curto
// com relógio injetado, para o painel não martelar o mLabs. Os IDs do mLabs são opacos (ext_*): descobertos por leitura, nunca chutados.
// NÃO VERIFICADO: os nomes dos campos de cada post publicado (a conta ainda tem 0 posts; só a forma `{posts, totalCount, hasMore}` e a de
// `get_follower_growth` foram observadas em 23/11/2026). Por isso o mapeamento dos posts é defensivo e tudo o que não for achado fica null.

export type MetricStatus = 'ok' | 'sem_dados' | 'indisponivel';

export interface PublishedPostMetric {
  id: string | null;
  publishedAt: string | null;
  type: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
}

export interface SocialMetrics {
  source: 'mlabs';
  channel: 'linkedin';
  fetchedAt: string;
  period: { start: string; end: string };
  published: {
    status: MetricStatus;
    reason?: string;
    /** `totalCount` informado pelo mLabs (ou o tamanho da lista); null se a leitura falhou. */
    count: number | null;
    items: PublishedPostMetric[];
    /** A lista foi cortada (limite de páginas deste leitor); `count` continua sendo o total informado. */
    truncated: boolean;
    /** Soma só quando TODOS os posts trazem o campo; senão null (nunca soma parcial). */
    totals: { likes: number | null; comments: number | null; views: number | null };
  };
  followers: {
    status: MetricStatus;
    reason?: string;
    current: number | null;
    start: number | null;
    growth: number | null;
    /** Data da última observação do mLabs (a coleta não é diária: pode ter intervalo). */
    observedAt: string | null;
    observations: number;
  };
}

export interface SocialMetricsSource {
  read(): Promise<SocialMetrics>;
}

export interface MlabsMetricsOptions {
  transport: McpTransport;
  now: () => Date;
  /** IDs opacos já conhecidos; se omitidos, são descobertos por `list_profiles`/`list_channels`. */
  profileId?: string;
  channelId?: string;
  /** Janela em dias (1–425, máximo do mLabs). Padrão 90. */
  days?: number;
  /** Cache em ms. Padrão 5 min; 0 desliga. */
  ttlMs?: number;
  /** Máximo de páginas de posts (100 por página). Padrão 5. */
  maxPages?: number;
}

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

const ProfilesSchema = z.object({ items: z.array(z.object({ id: z.string(), active: z.boolean().optional(), connectedChannels: z.array(z.string()).optional() }).loose()) }).loose();
const ChannelsSchema = z.array(z.object({ id: z.string(), channel: z.string(), active: z.boolean().optional() }).loose());
const PostsPageSchema = z.object({
  posts: z.array(z.unknown()).optional(),
  totalCount: z.number().int().min(0).optional(),
  hasMore: z.boolean().optional(),
  nextCursor: z.string().nullish(),
  responsePage: z.object({ hasMore: z.boolean().optional(), nextCursor: z.string().nullish() }).loose().optional(),
}).loose();
const GrowthSchema = z.object({
  status: z.string().optional(),
  timeline: z.array(z.object({ date: z.string().optional(), followerCount: z.number().optional() }).loose()).optional(),
  summary: z.object({ startFollowers: z.number().nullish(), endFollowers: z.number().nullish(), totalGrowth: z.number().nullish() }).loose().nullish(),
}).loose();

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, 200) : null);
const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {});

/** Mapeamento defensivo de um post publicado. Nada é inventado: o que não for achado fica null. */
export function mapPublishedPost(raw: unknown): PublishedPostMetric {
  const p = rec(raw);
  const inter = { ...rec(p.interactions), ...rec(p.metrics), ...rec(p.stats) };
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = num(p[k]) ?? num(inter[k]);
      if (v !== null) return v;
    }
    return null;
  };
  return {
    id: str(p.id) ?? str(p.postId),
    publishedAt: str(p.publishedAt) ?? str(p.publishedDate) ?? str(p.publishDate) ?? str(p.date),
    type: str(p.type) ?? str(p.mediaType),
    likes: pick('likes', 'curtidas', 'reactions'),
    comments: pick('comments', 'comentarios', 'comentários'),
    views: pick('views', 'visualizacoes', 'visualizações', 'impressions'),
  };
}

const sumAll = (items: PublishedPostMetric[], k: 'likes' | 'comments' | 'views'): number | null => {
  if (items.length === 0) return 0;
  let s = 0;
  for (const i of items) {
    if (i[k] === null) return null;
    s += i[k];
  }
  return s;
};

const reasonOf = (e: unknown): string => (e instanceof z.ZodError ? 'resposta_inesperada' : 'leitura_falhou');

export function createMlabsMetricsSource(opts: MlabsMetricsOptions): SocialMetricsSource {
  const tx = readOnlyTransport(opts.transport);
  const days = Math.min(425, Math.max(1, Math.trunc(opts.days ?? 90)));
  const ttl = opts.ttlMs ?? 5 * 60_000;
  const maxPages = Math.max(1, opts.maxPages ?? 5);
  let ids: { profileId: string; channelId: string } | null = opts.profileId && opts.channelId ? { profileId: opts.profileId, channelId: opts.channelId } : null;
  let cache: { at: number; value: SocialMetrics } | null = null;

  async function resolveIds(): Promise<{ profileId: string; channelId: string }> {
    if (ids) return ids;
    const profiles = ProfilesSchema.parse(await tx.call('list_profiles', {})).items.filter((p) => p.active !== false && (p.connectedChannels ?? []).some((c) => c.toLowerCase() === 'linkedin'));
    const found: { profileId: string; channelId: string }[] = [];
    for (const p of profiles) {
      for (const c of ChannelsSchema.parse(await tx.call('list_channels', { profileId: p.id }))) {
        if (c.channel.toLowerCase() === 'linkedin' && c.active !== false) found.push({ profileId: p.id, channelId: c.id });
      }
    }
    if (found.length === 0) throw new MetricsUnavailable('canal_linkedin_nao_encontrado');
    if (found.length > 1) throw new MetricsUnavailable('canal_linkedin_ambiguo'); // não escolhe sozinho
    ids = found[0]!;
    return ids;
  }

  async function readPosts(i: { profileId: string; channelId: string }, start: string, end: string): Promise<SocialMetrics['published']> {
    const items: PublishedPostMetric[] = [];
    let total: number | null = null;
    let cursor: string | undefined;
    let truncated = false;
    for (let page = 0; page < maxPages; page++) {
      let raw = PostsPageSchema.parse(await tx.call('list_published_posts', { profileId: i.profileId, channelId: i.channelId, startDate: start, endDate: end, limit: 100, ...(cursor ? { cursor } : {}) }));
      let posts = [...(raw.posts ?? [])];
      // resposta partida em partes (responsePage): junta todas antes de interpretar, até o limite de partes
      for (let part = 0; raw.responsePage?.hasMore && raw.responsePage.nextCursor && part < maxPages; part++) {
        raw = PostsPageSchema.parse(await tx.call('list_published_posts', { profileId: i.profileId, channelId: i.channelId, startDate: start, endDate: end, limit: 100, ...(cursor ? { cursor } : {}), responseCursor: raw.responsePage.nextCursor }));
        posts = posts.concat(raw.posts ?? []);
      }
      items.push(...posts.map(mapPublishedPost));
      total = raw.totalCount ?? total;
      if (!(raw.hasMore && raw.nextCursor)) break;
      cursor = raw.nextCursor;
      if (page === maxPages - 1) truncated = true;
    }
    return {
      status: 'ok', count: total ?? items.length, items, truncated,
      totals: { likes: sumAll(items, 'likes'), comments: sumAll(items, 'comments'), views: sumAll(items, 'views') },
    };
  }

  async function readFollowers(i: { profileId: string; channelId: string }, start: string, end: string): Promise<SocialMetrics['followers']> {
    const g = GrowthSchema.parse(await tx.call('get_follower_growth', { profileId: i.profileId, channelId: i.channelId, startDate: start, endDate: end }));
    const tl = g.timeline ?? [];
    if (g.status === 'no_data' || tl.length === 0 || !g.summary) {
      return { status: 'sem_dados', reason: 'sem_observacoes_no_periodo', current: null, start: null, growth: null, observedAt: null, observations: 0 };
    }
    const last = tl[tl.length - 1]!;
    return {
      status: 'ok', current: num(g.summary.endFollowers) ?? num(last.followerCount), start: num(g.summary.startFollowers), growth: typeof g.summary.totalGrowth === 'number' ? g.summary.totalGrowth : null,
      observedAt: str(last.date), observations: tl.length,
    };
  }

  async function fresh(): Promise<SocialMetrics> {
    const now = opts.now();
    const end = isoDay(now);
    const start = isoDay(new Date(now.getTime() - days * DAY));
    const base = { source: 'mlabs' as const, channel: 'linkedin' as const, fetchedAt: now.toISOString(), period: { start, end } };
    const emptyPosts = (reason: string): SocialMetrics['published'] => ({ status: 'indisponivel', reason, count: null, items: [], truncated: false, totals: { likes: null, comments: null, views: null } });
    const emptyFollowers = (reason: string): SocialMetrics['followers'] => ({ status: 'indisponivel', reason, current: null, start: null, growth: null, observedAt: null, observations: 0 });
    let i: { profileId: string; channelId: string };
    try {
      i = await resolveIds();
    } catch (e) {
      const reason = e instanceof MetricsUnavailable ? e.reason : reasonOf(e);
      return { ...base, published: emptyPosts(reason), followers: emptyFollowers(reason) };
    }
    const [published, followers] = await Promise.all([
      readPosts(i, start, end).catch((e: unknown) => emptyPosts(reasonOf(e))),
      readFollowers(i, start, end).catch((e: unknown) => emptyFollowers(reasonOf(e))),
    ]);
    return { ...base, published, followers };
  }

  return {
    async read() {
      const t = opts.now().getTime();
      if (cache && ttl > 0 && t - cache.at < ttl) return cache.value;
      const value = await fresh();
      // falha não fica em cache (a próxima leitura tenta de novo); só resultado completo é guardado
      if (value.published.status !== 'indisponivel' && value.followers.status !== 'indisponivel') cache = { at: t, value };
      return value;
    },
  };
}

class MetricsUnavailable extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'MetricsUnavailable';
  }
}
