import { DEVICE_CLASSES, REFERRER_CATEGORIES, type DeviceClass, type ReferrerCategory } from './event';

// Agregação em contagens. O que é guardado: (dia, caminho normalizado, categoria de origem, classe de dispositivo) → n.
// Nenhum evento individual, nenhum identificador, nenhum horário além do DIA (America/Sao_Paulo) é persistido.

export const TIMEZONE = 'America/Sao_Paulo';
export const METHODOLOGY_VERSION = 'ln-analytics-1';
export const SOURCE = 'ln_first_party';
/** Limite de caminhos distintos por dia: acima disso o excedente cai em `:outros` (evita crescimento sem fim por caminhos aleatórios). */
export const MAX_PATHS_PER_DAY = 2000;
export const OVERFLOW_PATH = ':outros';
/** Células com menos de K visualizações não são exibidas por dimensão (anti-reidentificação); o total sempre é exibido. */
export const DEFAULT_K = 5;
/** Retenção proposta dos agregados: ~26 meses. Não há dado bruto para reter. */
export const RETENTION_DAYS = 790;

export interface Bucket {
  day: string; // YYYY-MM-DD em America/Sao_Paulo
  path: string;
  ref: ReferrerCategory;
  device: DeviceClass;
}

export interface BucketRow extends Bucket {
  views: number;
}

export interface AggregateStore {
  increment(b: Bucket): Promise<void>;
  rows(fromDay: string, toDay: string): Promise<BucketRow[]>;
  /** Apaga dias anteriores a `beforeDay`; devolve quantas linhas apagou. */
  purgeBefore(beforeDay: string): Promise<number>;
}

const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Dia civil em America/Sao_Paulo (YYYY-MM-DD). */
export function dayOf(d: Date): string {
  return DAY_FMT.format(d);
}

export class InMemoryAggregateStore implements AggregateStore {
  private readonly cells = new Map<string, BucketRow>();
  private readonly pathsPerDay = new Map<string, Set<string>>();

  private key(b: Bucket): string {
    return `${b.day}|${b.path}|${b.ref}|${b.device}`;
  }

  async increment(b: Bucket): Promise<void> {
    let path = b.path;
    const seen = this.pathsPerDay.get(b.day) ?? new Set<string>();
    if (!seen.has(path) && seen.size >= MAX_PATHS_PER_DAY) path = OVERFLOW_PATH;
    else seen.add(path);
    this.pathsPerDay.set(b.day, seen);
    const k = this.key({ ...b, path });
    const cur = this.cells.get(k);
    if (cur) cur.views += 1;
    else this.cells.set(k, { ...b, path, views: 1 });
  }

  async rows(fromDay: string, toDay: string): Promise<BucketRow[]> {
    return [...this.cells.values()].filter((r) => r.day >= fromDay && r.day <= toDay).map((r) => ({ ...r }));
  }

  async purgeBefore(beforeDay: string): Promise<number> {
    let n = 0;
    for (const [k, r] of this.cells) {
      if (r.day < beforeDay) {
        this.cells.delete(k);
        n += 1;
      }
    }
    for (const day of this.pathsPerDay.keys()) if (day < beforeDay) this.pathsPerDay.delete(day);
    return n;
  }
}

export type ReportStatus = 'available' | 'unavailable';

export interface Cell<K extends string> {
  key: K;
  views: number;
}

export interface AnalyticsReport {
  status: ReportStatus;
  /** Motivo quando `unavailable` (coleta desligada, sem dados no período). Nunca zero falso. */
  reason?: string;
  source: typeof SOURCE;
  methodology_version: typeof METHODOLOGY_VERSION;
  period_start: string; // dia inicial (YYYY-MM-DD)
  period_end: string;
  fetched_at: string; // ISO
  /** Total do período; `null` quando não há dados. Exibido mesmo abaixo de K. */
  totalViews: number | null;
  byDay: Cell<string>[];
  topPaths: Cell<string>[];
  referrers: Cell<ReferrerCategory>[];
  devices: Cell<DeviceClass>[];
  /** Visualizações em células abaixo de K, somadas e sem detalhe. */
  suppressedViews: number;
  k: number;
}

function foldCells<K extends string>(map: Map<K, number>, k: number): { cells: Cell<K>[]; suppressed: number } {
  const cells: Cell<K>[] = [];
  let suppressed = 0;
  for (const [key, views] of map) {
    if (views >= k) cells.push({ key, views });
    else suppressed += views;
  }
  cells.sort((a, b) => b.views - a.views || a.key.localeCompare(b.key));
  return { cells, suppressed };
}

export function emptyReport(args: { from: string; to: string; fetchedAt: string; reason: string; k?: number }): AnalyticsReport {
  return {
    status: 'unavailable', reason: args.reason, source: SOURCE, methodology_version: METHODOLOGY_VERSION,
    period_start: args.from, period_end: args.to, fetched_at: args.fetchedAt,
    totalViews: null, byDay: [], topPaths: [], referrers: [], devices: [], suppressedViews: 0, k: args.k ?? DEFAULT_K,
  };
}

/** Monta o relatório a partir das linhas agregadas. Sem linhas: `unavailable` com `totalViews: null` (nunca zero). */
export function buildReport(rows: readonly BucketRow[], args: { from: string; to: string; fetchedAt: string; k?: number }): AnalyticsReport {
  const k = Math.max(1, args.k ?? DEFAULT_K);
  if (rows.length === 0) return emptyReport({ ...args, reason: 'sem dados no período', k });

  const byDay = new Map<string, number>();
  const paths = new Map<string, number>();
  const refs = new Map<ReferrerCategory, number>();
  const devs = new Map<DeviceClass, number>();
  let total = 0;
  for (const r of rows) {
    total += r.views;
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.views);
    paths.set(r.path, (paths.get(r.path) ?? 0) + r.views);
    refs.set(r.ref, (refs.get(r.ref) ?? 0) + r.views);
    devs.set(r.device, (devs.get(r.device) ?? 0) + r.views);
  }
  const p = foldCells(paths, k);
  const rf = foldCells(refs, k);
  const dv = foldCells(devs, k);
  const days = [...byDay.entries()].map(([key, views]) => ({ key, views })).sort((a, b) => a.key.localeCompare(b.key));
  // O total por dia também respeita K: dia com menos de K entra no agregado `suppressed`, sem detalhe.
  const daysShown = days.filter((d) => d.views >= k);
  return {
    status: 'available', source: SOURCE, methodology_version: METHODOLOGY_VERSION,
    period_start: args.from, period_end: args.to, fetched_at: args.fetchedAt,
    totalViews: total, byDay: daysShown, topPaths: p.cells, referrers: rf.cells, devices: dv.cells,
    suppressedViews: p.suppressed, k,
  };
}

export const ALL_REFERRERS = REFERRER_CATEGORIES;
export const ALL_DEVICES = DEVICE_CLASSES;
