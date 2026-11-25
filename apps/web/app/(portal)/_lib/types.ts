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

/** Tipos de organização do Entity Intelligence (CHECK de intelligence.organization.kind). */
export type CompanyKind = 'company' | 'program' | 'association' | 'regulator' | 'media' | 'other';
export const COMPANY_KINDS: readonly CompanyKind[] = ['company', 'program', 'association', 'regulator', 'media', 'other'];

/** Fonte pública de um fato: nome, link e data de coleta. Nunca o trecho literal (termos J-14). */
export interface EvidenceSource {
  name: string;
  url: string;
  retrievedAt: string;
}

export interface CompanyListItem {
  id: string;
  name: string;
  legalName: string;
  kind: CompanyKind;
  relationCount: number;
  validatedAt: string;
  mock?: boolean;
}

export type CompanyRelationType = 'parent_of' | 'partner_of' | 'supplier_of' | 'coalition_member' | 'acquired' | 'other';
export interface CompanyRelation {
  id: string;
  type: CompanyRelationType;
  /** `from`: esta empresa é a origem da relação; `to`: é o destino. */
  direction: 'from' | 'to';
  other: { id: string; name: string; kind: CompanyKind };
  validFrom: string;
  validatedAt: string;
  source: EvidenceSource;
  mock?: boolean;
}

export interface CompanyProfile {
  id: string;
  name: string;
  legalName: string;
  kind: CompanyKind;
  source: EvidenceSource;
  relations: CompanyRelation[];
  /** Pessoas só com a flag `intelligencePessoas` (J-01); desligada = indisponível. */
  peopleAvailable: boolean;
  mock?: boolean;
}

/** `unavailable` = a API falhou: a página diz isso, não finge que não há empresas. */
export type CompanyDirectory =
  | { status: 'ok'; items: CompanyListItem[]; total: number; kinds: { kind: CompanyKind; total: number }[] }
  | { status: 'unavailable' };
export type CompanyLookup = { status: 'ok'; company: CompanyProfile } | { status: 'not_found' } | { status: 'unavailable' };

/** Cargo público declarado (nunca inferido no portal). */
export interface PersonRole {
  id: string;
  title: string;
  company: { id: string; name: string };
  validFrom: string;
  validTo: string | null;
  validatedAt: string;
  source: EvidenceSource;
  /** A fonte declara o início (campo inicioDeclarado da API, M-04). Ausente = API antiga: o portal deduz pela data. */
  startDeclared?: boolean;
  /** Período em texto livre vindo de uma correção do titular (DP-38); quando existe, substitui o período calculado. */
  periodText?: string;
  /** O cargo tem correção aplicada a pedido do titular. */
  correctedByHolder?: boolean;
  mock?: boolean;
}
export interface PersonListItem {
  id: string;
  name: string;
  /** Cargos vigentes segundo o Backend (inclui cargo com fim no futuro). */
  roles: PersonRole[];
  correctedByHolder?: boolean;
  mock?: boolean;
}
/** Uma leitura de fonte pública num Move (antes ou depois). */
export interface MoveReading {
  title: string;
  company: { id: string; name: string };
  validFrom: string;
  validTo: string | null;
  validatedAt: string;
  source: EvidenceSource;
}
export type MoveKind = 'appointment' | 'departure' | 'title_change' | 'org_change';
/** Move confirmado por revisão (o portal nunca recebe outro status). */
export interface MoveEntry {
  id: string;
  kind: MoveKind;
  basis: 'announcement' | 'observed_diff';
  person: { id: string; name: string };
  /** Só quando a fonte declara; senão null (não inventamos a data). */
  effectiveDate: string | null;
  observedOn: string;
  before: MoveReading | null;
  after: MoveReading | null;
  mock?: boolean;
}
export interface PersonProfile {
  id: string;
  name: string;
  profileUrl: string | null;
  source: EvidenceSource;
  currentRoles: PersonRole[];
  history: PersonRole[];
  moves: MoveEntry[];
  correctedByHolder?: boolean;
  mock?: boolean;
}
/**
 * `available: false` = dados de pessoas desligados (flag `intelligencePessoas`, J-01): não é falha nem "sem registro".
 * `withheld` = itens que EXISTEM na resposta mas não podem ser publicados nesta versão (só quando available=false). Separa
 * "ainda não há perfis" (withheld ausente/0) de "existem perfis, ainda não publicados nesta versão" (>0), sem sumir com eles.
 */
export type PeopleDirectory = { status: 'ok'; items: PersonListItem[]; total: number; available: boolean; withheld?: number } | { status: 'unavailable' };
export type PersonLookup = { status: 'ok'; person: PersonProfile } | { status: 'not_found' } | { status: 'unavailable' };
/** Mesma regra do diretório de pessoas: `withheld` = Moves existentes que não estão publicados nesta versão. */
export type MovesFeed = { status: 'ok'; items: MoveEntry[]; total: number; available: boolean; withheld?: number } | { status: 'unavailable' };
export type MoveLookup = { status: 'ok'; move: MoveEntry } | { status: 'not_found' } | { status: 'unavailable' };

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
  /** Diretório do Entity Intelligence (filtro por tipo e texto). */
  getCompanyDirectory(filter?: { kind?: CompanyKind; q?: string }): Promise<CompanyDirectory>;
  /** Empresa com relações declaradas e a fonte de cada uma. */
  getCompany(id: string): Promise<CompanyLookup>;
  /** Pessoas com cargos públicos vigentes (filtro por texto e empresa). */
  getPeopleDirectory(filter?: { q?: string; companyId?: string }): Promise<PeopleDirectory>;
  getPerson(id: string): Promise<PersonLookup>;
  /** Moves confirmados, do mais recente para o mais antigo. */
  getMovesFeed(filter?: { companyId?: string; personId?: string }): Promise<MovesFeed>;
  getMove(id: string): Promise<MoveLookup>;
}
