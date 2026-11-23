import type { AudienceSnapshot, MetricState, MetricValue } from './types';

/**
 * Dados comerciais do portal em modo `api`: lê a rota pública do Backend (`GET /api/commercial/mediakit`, sem login).
 * Tudo que chega passa por um parser defensivo: qualquer campo fora do formato derruba a leitura inteira (null) e a página cai
 * no estado vazio honesto. Nenhum número é montado aqui: só se repete o que a API devolveu com origem, janela e data de coleta.
 */

export type FormatStatus = 'disponivel' | 'sob_consulta' | 'indisponivel';
export interface MediaKitFormat { id: string; section: string; name: string; price: string; scope: string; status: FormatStatus }
export interface MediaKitData {
  audience: AudienceSnapshot;
  formats: MediaKitFormat[];
  /** Aviso de integridade da entrega de anúncios (períodos não auditáveis); null = nenhum. */
  integrityNote: string | null;
  generatedAt: string;
}

const STATES: readonly MetricState[] = ['ok', 'unavailable', 'stale'];
const STATUSES: readonly FormatStatus[] = ['disponivel', 'sob_consulta', 'indisponivel'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 400): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

function parseMetric(v: unknown): MetricValue | null {
  if (!isObj(v)) return null;
  const label = str(v.label); const source = str(v.source);
  const value = v.value === null ? null : str(v.value, 40);
  if (!label || !source || (v.value !== null && value === null) || !STATES.includes(v.state as MetricState)) return null;
  // Coerência: sem valor só pode ser "indisponível"; com valor precisa de data de coleta (origem, janela e data sempre juntas).
  const state = v.state as MetricState;
  const collectedAt = v.collectedAt === undefined ? undefined : str(v.collectedAt, 40) ?? undefined;
  if ((value === null) !== (state === 'unavailable')) return null;
  if (value !== null && !collectedAt) return null;
  const window = v.window === undefined ? undefined : str(v.window, 80) ?? undefined;
  return { label, value, state, source, ...(window ? { window } : {}), ...(collectedAt ? { collectedAt } : {}) };
}
function parseMetrics(v: unknown): MetricValue[] | null {
  if (!Array.isArray(v) || v.length > 40) return null;
  const out: MetricValue[] = [];
  for (const m of v) { const p = parseMetric(m); if (!p) return null; out.push(p); }
  return out;
}

export function parseMediaKit(json: unknown): MediaKitData | null {
  if (!isObj(json) || !isObj(json.audience) || !isObj(json.blocks)) return null;
  const realtime = parseMetrics(json.audience.realtime); const historical = parseMetrics(json.audience.historical);
  const cat = isObj(json.blocks.catalogo) ? json.blocks.catalogo : null;
  if (!realtime || !historical || !cat || !Array.isArray(cat.formats) || cat.formats.length > 200) return null;
  const formats: MediaKitFormat[] = [];
  for (const f of cat.formats) {
    if (!isObj(f)) return null;
    const id = str(f.id, 120); const section = str(f.section, 80); const name = str(f.name, 120); const price = str(f.price, 80); const scope = str(f.scope, 300);
    if (!id || !section || !name || !price || !scope || !STATUSES.includes(f.status as FormatStatus)) return null;
    formats.push({ id, section, name, price, scope, status: f.status as FormatStatus });
  }
  const gen = str(json.generatedAt, 40);
  if (!gen) return null;
  const integrity = isObj(json.deliveryIntegrity) ? json.deliveryIntegrity : null;
  const note = integrity && typeof integrity.note === 'string' && integrity.note.length <= 500 ? integrity.note : null;
  return { audience: { realtime, historical }, formats, integrityNote: note, generatedAt: gen };
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
export interface CoverageCard {
  key: 'articles' | 'events' | 'editorias';
  label: string;
  /** null => "—". */
  value: string | null;
  origin: string;
  /** ISO da consulta quando o número é real; null caso contrário. */
  checkedAt: string | null;
  /** Número de demonstração: o selo MOCK é obrigatório ao lado dele. */
  mock: boolean;
}

/**
 * Cobertura do mídia kit. Regra (auditoria V-05): métrica comercial nunca vem de demonstração como se fosse real.
 *  - fonte `mock` (vitrine/dev): o número aparece com selo MOCK e origem "Demonstração";
 *  - fonte real (`api`/`empty`): número só se houver contagem real, com origem e horário da consulta; senão "—".
 * "Editorias" é a taxonomia do portal (fato de projeto, não métrica de audiência).
 */
export function coverageCards(i: { kind: SourceKind; articles: number; events: number; editorias: number; now: string }): CoverageCard[] {
  const mock = i.kind === 'mock';
  const real = (n: number, label: string, key: 'articles' | 'events', origin: string): CoverageCard => ({
    key, label, value: n > 0 ? String(n) : null, origin: mock ? 'Demonstração' : origin, checkedAt: !mock && n > 0 ? i.now : null, mock: mock && n > 0,
  });
  return [
    real(i.articles, 'Matérias publicadas (acervo)', 'articles', 'CMS'),
    real(i.events, 'Eventos futuros verificados', 'events', 'Agenda'),
    { key: 'editorias', label: 'Editorias', value: String(i.editorias), origin: 'Taxonomia do portal', checkedAt: null, mock: false },
  ];
}

/** Mesma base que `getSource()` usa para o adaptador api (PORTAL_API_BASE_URL ou o próprio servidor). */
export const portalApiBase = (env: Record<string, string | undefined> = process.env): string =>
  env.PORTAL_API_BASE_URL || `http://127.0.0.1:${env.PORT || 3000}`;
