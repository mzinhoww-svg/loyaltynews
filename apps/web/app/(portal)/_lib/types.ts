/**
 * Tipos de leitura do portal.
 * TODO(contracts): substituir por tipos de `packages/contracts` quando publicados (Chief Architect).
 * O portal só depende de `PortalSource` (ver source.ts); trocar a fonte não altera as páginas.
 */
export type ContentType =
  | 'noticia'
  | 'flash'
  | 'analise'
  | 'entrevista'
  | 'opiniao'
  | 'estudo'
  | 'patrocinado'
  | 'cobertura_evento';
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
  /** Rótulo visível obrigatório junto da imagem (ADR-018: "Ilustração conceitual"); null quando não há. */
  label?: string | null;
  /** Link da fonte (imagem de terceiro). */
  link?: string;
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
  /** Fonte api: a API falhou (rede, timeout, status não-OK, resposta inválida). Diferente de lista vazia legítima. */
  unavailable?: boolean;
}

export interface EventItem {
  /** Fonte api: o id do evento no Studio. */
  slug: string;
  title: string;
  /** `YYYY-MM-DD` (evento do Studio, só data) ou ISO com hora. */
  startsAt: string;
  endsAt?: string;
  /** Só quando a fonte informa; o Studio publica apenas datas. */
  timezone?: string;
  city?: string;
  /** Local como publicado (texto livre do Studio). */
  place?: string;
  /** `undefined` = a fonte não informa se é online ou presencial (nunca inferimos). */
  online?: boolean;
  /** `undefined` = a fonte não informa organizador. */
  organizer?: string;
  officialUrl?: string;
  sourceUrl?: string;
  status: 'validado' | 'cancelado';
  priceNote?: string;
  /** Evento patrocinado: o portal rotula (F-074). */
  sponsored?: boolean;
  /** `startsAt`/`endsAt` são datas sem hora. */
  dateOnly?: boolean;
  mock?: boolean;
}

/** Matéria por slug: `unavailable` = a API falhou (distinto de matéria inexistente). */
export type ArticleResult = { article: Article; unavailable?: false } | { article: null; unavailable?: boolean };

/** Lista de eventos; `unavailable` = a API falhou (distinto de agenda vazia). */
export interface EventList {
  items: EventItem[];
  unavailable?: boolean;
}
/** Evento por id: `unavailable` = a API falhou (distinto de evento inexistente). */
export type EventResult = { event: EventItem; unavailable?: false } | { event: null; unavailable?: boolean };

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

/** Item de menu publicado no Studio (principal e rodapé). `href` é caminho interno ou URL http(s) já validada. */
export interface SiteMenuItem {
  label: string;
  href: string;
  children: { label: string; href: string }[];
}
export interface SiteEvent {
  id: string;
  title: string;
  /** Datas `YYYY-MM-DD` (ou ISO) como publicadas. */
  startsAt: string;
  endsAt?: string;
  place?: string;
  url?: string;
  sponsored: boolean;
}
export type HomeBlock =
  | { type: 'destaque'; id: string; title?: string; articles: Article[] }
  | { type: 'lista_editoria'; id: string; title?: string; editoriaSlug: string; articles: Article[] }
  | { type: 'ultimas'; id: string; title?: string; articles: Article[] }
  | { type: 'agenda'; id: string; title?: string; events: SiteEvent[] }
  | { type: 'publicidade'; id: string; position: string };
export interface SiteSeo {
  title: string;
  description: string;
  ogImage?: string;
  /** `noindex` publicado SOMA-SE ao bloqueio de indexação do ambiente; nunca o relaxa. */
  noindex: boolean;
  organization?: { name: string; url: string; logo?: string; sameAs: string[] };
}
/** Configuração do site publicada no Studio (`/api/publico/site`). Cada parte `null` = nada publicado: vale o padrão do portal. */
export interface SiteConfig {
  home: { version: number; blocks: HomeBlock[] } | null;
  menus: { main: SiteMenuItem[] | null; footer: SiteMenuItem[] | null };
  seo: SiteSeo | null;
  internalLinks: { term: string; href: string }[];
}

/** Camada de acesso trocável: empty (padrão), mock (dev/teste) e, depois, API. */
export interface PortalSource {
  readonly kind: 'empty' | 'mock' | 'api';
  getHighlights(): Promise<Article[]>;
  getTrending(window: TrendingWindow): Promise<Article[]>;
  getLatest(q?: LatestQuery): Promise<Page<Article>>;
  getArticle(slug: string): Promise<ArticleResult>;
  getRelated(article: Article, limit?: number): Promise<Article[]>;
  search(q: string, page?: number): Promise<Page<Article>>;
  listEvents(): Promise<EventList>;
  getEvent(slug: string): Promise<EventResult>;
  listMoves(): Promise<MoveItem[]>;
  listCompanies(): Promise<EntitySummary[]>;
  listPeople(): Promise<EntitySummary[]>;
  getAudience(): Promise<AudienceSnapshot>;
  getAd(slot: AdSlotId): Promise<AdCreative | null>;
  /** Home, menus, SEO e links internos publicados no Studio; `null` quando a fonte não os tem (vazia, MOCK) ou a API falha. */
  getSiteConfig(): Promise<SiteConfig | null>;
}
