/**
 * Tipos de leitura do portal.
 * TODO(contracts): substituir por tipos de `packages/contracts` quando publicados (Chief Architect).
 * O portal só depende de `PortalSource` (ver source.ts); trocar a fonte não altera as páginas.
 */
export type ContentType = 'noticia' | 'flash' | 'analise' | 'entrevista' | 'opiniao';
export type TrendingWindow = '24h' | '7d' | '30d';

export interface Editoria {
  slug: string;
  name: string;
  description: string;
}

export interface ArticleImage {
  src: string;
  alt: string;
  /** Crédito obrigatório (blueprint §6): nunca omitir. */
  credit: string;
}

export interface ArticleSource {
  label: string;
  url: string;
  publishedAt?: string;
}

export interface ArticleCorrection {
  at: string;
  text: string;
}

export type ArticleBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string; attribution?: string };

export interface Article {
  slug: string;
  title: string;
  subtitle?: string;
  summary: string;
  editoriaSlug: string;
  contentType: ContentType;
  /** Assinatura institucional; nunca inventar repórter. */
  authorLabel: string;
  publishedAt: string;
  updatedAt?: string;
  readingMinutes: number;
  image?: ArticleImage;
  body: ArticleBlock[];
  sources: ArticleSource[];
  corrections: ArticleCorrection[];
  tags: string[];
  /** Conteúdo patrocinado precisa de rótulo ostensivo. */
  sponsored?: boolean;
  /** Dado de teste. Nunca verdadeiro em fonte real. */
  mock?: boolean;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface EventItem {
  slug: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  timezone: string;
  city?: string;
  online: boolean;
  organizer: string;
  officialUrl: string;
  sourceUrl: string;
  status: 'validado' | 'cancelado';
  priceNote?: string;
  mock?: boolean;
}

export interface MoveItem {
  id: string;
  personName: string;
  companyName: string;
  fromRole?: string;
  toRole: string;
  announcedAt: string;
  sourceUrl: string;
  /** Só movimentações confirmadas são públicas. */
  confirmed: true;
  mock?: boolean;
}

export interface EntitySummary {
  slug: string;
  name: string;
  segment?: string;
  lastReviewedAt?: string;
  mock?: boolean;
}

export type MetricState = 'ok' | 'unavailable' | 'stale';
export interface MetricValue {
  label: string;
  value: string | null;
  state: MetricState;
  source: string;
  window?: string;
  collectedAt?: string;
}
export interface AudienceSnapshot {
  realtime: MetricValue[];
  historical: MetricValue[];
}

export type AdSlotId = 'topo' | 'entre-secoes' | 'sidebar-1' | 'sidebar-2' | 'sidebar-3' | 'in-article' | 'rodape';
export interface AdCreative {
  slot: AdSlotId;
  href: string;
  imageSrc: string;
  alt: string;
  advertiser: string;
}

export interface LatestQuery {
  page?: number;
  pageSize?: number;
  editoriaSlug?: string;
  contentType?: ContentType;
}

/** Camada de acesso trocável: empty (padrão), mock (dev/teste) e, depois, API. */
export interface PortalSource {
  readonly kind: 'empty' | 'mock' | 'api';
  getHighlights(): Promise<Article[]>;
  getTrending(window: TrendingWindow): Promise<Article[]>;
  getLatest(q?: LatestQuery): Promise<Page<Article>>;
  getArticle(slug: string): Promise<Article | null>;
  getRelated(article: Article, limit?: number): Promise<Article[]>;
  search(q: string, page?: number): Promise<Page<Article>>;
  listEvents(): Promise<EventItem[]>;
  getEvent(slug: string): Promise<EventItem | null>;
  listMoves(): Promise<MoveItem[]>;
  listCompanies(): Promise<EntitySummary[]>;
  listPeople(): Promise<EntitySummary[]>;
  getAudience(): Promise<AudienceSnapshot>;
  getAd(slot: AdSlotId): Promise<AdCreative | null>;
}
