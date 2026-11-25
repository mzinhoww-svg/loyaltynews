import type { AudienceSnapshot, MetricState, MetricValue } from './types';

/**
 * Dados comerciais do portal em modo `api`: lê a rota pública do Backend (`GET /api/commercial/mediakit`, sem login).
 * Tudo que chega passa por um parser defensivo: qualquer campo fora do formato derruba a leitura inteira (null) e a página cai
 * no estado vazio honesto. Nenhum número é montado aqui: só se repete o que a API devolveu com origem, janela e data de coleta.
 *
 * Regra do PM (staging com banco): métrica comercial só conta conteúdo REAL. Se a API devolver uma métrica marcada como demonstração
 * (seed `seed-stg-*`, rótulo `[DEMO · staging]`, ou campo `demo`/`mock`), o número é descartado: o cartão mostra "—" e "sem dado real".
 */

export type FormatStatus = 'disponivel' | 'sob_consulta' | 'indisponivel';
/**
 * `ressalva`: do dado da API, não escrita no portal. Formato liberado para proposta com o canal ainda desligado (DP-54) vem
 * com a ressalva e nunca é apresentado como "Disponível" puro.
 */
export interface MediaKitFormat { id: string; section: string; name: string; price: string; scope: string; status: FormatStatus; ressalva: string | null }
export type CoverageMetric = MetricValue & { id?: string };
/** Posição de anúncio para o mapa do mídia kit. `dimension` 'LxA' em pixels, ou null quando o inventário ainda não definiu. */
export interface MapPosition { id: string; name: string; dimension: string | null }
export interface MediaKitData {
  audience: AudienceSnapshot;
  /** Posições do inventário (nome e dimensão) para o mapa visual. Vazia se a API não trouxe. */
  positions: MapPosition[];
  /** Cobertura coletada do CMS (matérias em 30/90 dias, eventos futuros). Vazia se a API não trouxe. */
  coverage: CoverageMetric[];
  formats: MediaKitFormat[];
  /** Aviso de integridade da entrega de anúncios (períodos não auditáveis); null = nenhum. */
  integrityNote: string | null;
  generatedAt: string;
}

const STATES: readonly MetricState[] = ['ok', 'unavailable', 'stale'];
const STATUSES: readonly FormatStatus[] = ['disponivel', 'sob_consulta', 'indisponivel'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 400): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

// ---------- demonstração ----------
const DEMO_TEXT = /seed-stg|\[\s*demo\b|\bdemo\b|demonstra[cç][aã]o|\bmock\b/i;
/** A métrica é de demonstração? Texto marcado em qualquer campo visível/identificador, ou campo booleano explícito. */
export function isDemoMarked(v: Record<string, unknown>): boolean {
  if (v.demo === true || v.mock === true || v.isMock === true || v.isDemo === true) return true;
  return ['id', 'label', 'source', 'window'].some((k) => typeof v[k] === 'string' && DEMO_TEXT.test(v[k] as string));
}
/** Tira o rótulo de demonstração do texto que ainda vai aparecer ao leitor (o número já foi descartado). */
const stripDemo = (s: string, fallback: string): string => {
  const out = s.replace(/\[[^\]]*demo[^\]]*\]/gi, '').replace(/seed-stg[\w-]*/gi, '').replace(/\s{2,}/g, ' ').trim();
  return out.length > 0 && !DEMO_TEXT.test(out) ? out : fallback;
};

function parseMetric(v: unknown): CoverageMetric | null {
  if (!isObj(v)) return null;
  const label = str(v.label); const source = str(v.source);
  if (!label || !source) return null;
  const id = v.id === undefined ? undefined : str(v.id, 80) ?? undefined;
  if (isDemoMarked(v)) {
    // Dado de demonstração: nunca vira número. Fica só o rótulo (limpo) e "indisponível".
    return { ...(id && !DEMO_TEXT.test(id) ? { id } : {}), label: stripDemo(label, 'Métrica'), value: null, state: 'unavailable', source: stripDemo(source, 'CMS') };
  }
  const value = v.value === null ? null : str(v.value, 40);
  if ((v.value !== null && value === null) || !STATES.includes(v.state as MetricState)) return null;
  // Coerência: sem valor só pode ser "indisponível"; com valor precisa de data de coleta (origem, janela e data sempre juntas).
  const state = v.state as MetricState;
  const collectedAt = v.collectedAt === undefined ? undefined : str(v.collectedAt, 40) ?? undefined;
  if ((value === null) !== (state === 'unavailable')) return null;
  if (value !== null && !collectedAt) return null;
  const window = v.window === undefined ? undefined : str(v.window, 80) ?? undefined;
  return { ...(id ? { id } : {}), label, value, state, source, ...(window ? { window } : {}), ...(collectedAt ? { collectedAt } : {}) };
}
function parseMetrics(v: unknown): CoverageMetric[] | null {
  if (!Array.isArray(v) || v.length > 40) return null;
  const out: CoverageMetric[] = [];
  for (const m of v) { const p = parseMetric(m); if (!p) return null; out.push(p); }
  return out;
}

/** Dimensão válida 'LxA' (inteiros positivos até 4000); qualquer outra coisa = null (posição "em definição"). */
export function safeDimension(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{1,4})x(\d{1,4})$/.exec(v);
  if (!m) return null;
  const w = Number(m[1]); const h = Number(m[2]);
  return w > 0 && h > 0 && w <= 4000 && h <= 4000 ? v : null;
}
/** Posições vindas da API. Ausente = []; formato inválido = null (a leitura inteira cai, como no resto do parser). */
function parsePositions(v: unknown): MapPosition[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 30) return null;
  const out: MapPosition[] = [];
  for (const p of v) {
    if (!isObj(p)) return null;
    const id = str(p.id, 40); const name = str(p.name, 120);
    if (!id || !name) return null;
    out.push({ id, name, dimension: safeDimension(p.desktop) });
  }
  return out;
}

/**
 * Posições públicas de reserva (quando a API não está disponível ou é a fonte vazia/mock). Espelham o inventário de @ln/commercial
 * (TOP, SIDEBAR_1-3 e FOOTER têm dimensão; as demais ainda estão em definição). Um teste compara esta lista com o inventário real.
 */
export const PUBLIC_POSITIONS: readonly MapPosition[] = [
  { id: 'TOP', name: 'Banner topo', dimension: '1280x150' },
  { id: 'SIDEBAR_1', name: 'Sidebar 1', dimension: '336x280' },
  { id: 'SIDEBAR_2', name: 'Sidebar 2', dimension: '336x280' },
  { id: 'SIDEBAR_3', name: 'Sidebar 3', dimension: '336x280' },
  { id: 'FOOTER', name: 'Banner rodapé', dimension: '1280x200' },
  { id: 'ARTICLE_INLINE', name: 'Banner dentro do artigo', dimension: null },
  { id: 'HOME_BETWEEN', name: 'Banner entre seções da home', dimension: null },
  { id: 'AGENDA', name: 'Banner na agenda', dimension: null },
  { id: 'DATA', name: 'Patrocínio Loyalty Market Data', dimension: null },
];

export function parseMediaKit(json: unknown): MediaKitData | null {
  if (!isObj(json) || !isObj(json.audience) || !isObj(json.blocks)) return null;
  const realtime = parseMetrics(json.audience.realtime); const historical = parseMetrics(json.audience.historical);
  const coverage = json.coverage === undefined ? [] : parseMetrics(json.coverage);
  const cat = isObj(json.blocks.catalogo) ? json.blocks.catalogo : null;
  if (!realtime || !historical || !coverage || !cat || !Array.isArray(cat.formats) || cat.formats.length > 200) return null;
  const formats: MediaKitFormat[] = [];
  for (const f of cat.formats) {
    if (!isObj(f)) return null;
    const id = str(f.id, 120); const section = str(f.section, 80); const name = str(f.name, 120); const price = str(f.price, 80); const scope = str(f.scope, 300);
    if (!id || !section || !name || !price || !scope || !STATUSES.includes(f.status as FormatStatus)) return null;
    // Ressalva é opcional no contrato (campo aditivo): ausente = formato sem ressalva.
    const ressalva = f.ressalva === undefined || f.ressalva === null ? null : str(f.ressalva, 300);
    if (f.ressalva !== undefined && f.ressalva !== null && !ressalva) return null;
    formats.push({ id, section, name, price, scope, status: f.status as FormatStatus, ressalva });
  }
  const positions = parsePositions(isObj(json.blocks.especificacoes) ? json.blocks.especificacoes.positions : undefined);
  if (!positions) return null;
  const gen = str(json.generatedAt, 40);
  if (!gen) return null;
  const integrity = isObj(json.deliveryIntegrity) ? json.deliveryIntegrity : null;
  const note = integrity && typeof integrity.note === 'string' && integrity.note.length <= 500 ? integrity.note : null;
  return { audience: { realtime, historical }, positions, coverage, formats, integrityNote: note, generatedAt: gen };
}

/** Busca o mídia kit na API. Qualquer falha (rede, status, JSON, formato) devolve null: a página mostra estado vazio. */
export async function fetchMediaKit(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<MediaKitData | null> {
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/commercial/mediakit`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 300 },
    } as RequestInit);
    if (!res.ok) return null;
    return parseMediaKit(await res.json());
  } catch {
    return null;
  }
}

// ---------- cartões de cobertura ----------
export type SourceKind = 'empty' | 'mock' | 'api';
export type CoverageKey = 'articles' | 'articles90' | 'events' | 'editorias';
export interface CoverageCard {
  key: CoverageKey;
  label: string;
  /** null => "—". */
  value: string | null;
  origin: string;
  /** Janela medida (ex.: "05/11/2026 a 04/12/2026"), quando a coleta a informa. */
  window?: string;
  /** ISO da coleta quando o número é real; null caso contrário. */
  checkedAt: string | null;
  /** Número de demonstração: o selo MOCK é obrigatório ao lado dele. */
  mock: boolean;
  /** Coleta antiga: o número aparece, marcado como desatualizado. */
  stale?: boolean;
}

const EDITORIAS_CARD = (n: number): CoverageCard => ({ key: 'editorias', label: 'Editorias', value: String(n), origin: 'Taxonomia do portal', checkedAt: null, mock: false });

/**
 * Cobertura nas fontes que NÃO são a API (vitrine/dev e fonte vazia). Regra (auditoria V-05):
 *  - fonte `mock`: o número aparece com selo MOCK e origem "Demonstração";
 *  - fonte vazia (ou `api`, caso alguém chame por engano): "—", porque contagem ao vivo de listagem não é métrica coletada
 *    (em staging ela inclui o seed de demonstração). Em modo api use `apiCoverageCards`.
 * "Editorias" é a taxonomia do portal (fato de projeto, não métrica de audiência).
 */
export function coverageCards(i: { kind: SourceKind; articles: number; events: number; editorias: number; now?: string }): CoverageCard[] {
  const mock = i.kind === 'mock';
  const card = (n: number, label: string, key: 'articles' | 'events', origin: string): CoverageCard => ({
    key, label, value: mock && n > 0 ? String(n) : null, origin: mock ? 'Demonstração' : origin, checkedAt: null, mock: mock && n > 0,
  });
  return [card(i.articles, 'Matérias publicadas (acervo)', 'articles', 'CMS'), card(i.events, 'Eventos futuros verificados', 'events', 'Agenda'), EDITORIAS_CARD(i.editorias)];
}

const COVERAGE_SLOTS: { id: string; key: 'articles' | 'articles90' | 'events'; label: string }[] = [
  { id: 'articles_published_30d', key: 'articles', label: 'Matérias publicadas (30 dias)' },
  { id: 'articles_published_90d', key: 'articles90', label: 'Matérias publicadas (90 dias)' },
  { id: 'upcoming_events', key: 'events', label: 'Eventos futuros' },
];

/**
 * Cobertura em modo api: SÓ o que a API comercial devolveu como coleta (origem, janela, data). Sem coleta, sem API, ou métrica marcada
 * como demonstração => "—" e "sem dado real". Nunca usa a contagem ao vivo da listagem pública.
 */
export function apiCoverageCards(kit: MediaKitData | null, editorias: number): CoverageCard[] {
  const cards = COVERAGE_SLOTS.map((s): CoverageCard => {
    const m = kit?.coverage.find((x) => x.id === s.id);
    const have = !!m && m.value !== null && m.state !== 'unavailable';
    return {
      key: s.key, label: s.label, value: have ? m!.value : null, origin: have ? m!.source : m?.source ?? 'CMS',
      ...(have && m!.window ? { window: m!.window } : {}), checkedAt: have ? m!.collectedAt ?? null : null, mock: false,
      ...(have && m!.state === 'stale' ? { stale: true } : {}),
    };
  });
  return [...cards, EDITORIAS_CARD(editorias)];
}

/** Mesma base que `getSource()` usa para o adaptador api (PORTAL_API_BASE_URL ou o próprio servidor). */
export const portalApiBase = (env: Record<string, string | undefined> = process.env): string =>
  env.PORTAL_API_BASE_URL || `http://127.0.0.1:${env.PORT || 3000}`;
