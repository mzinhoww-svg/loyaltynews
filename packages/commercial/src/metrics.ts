// Métricas do mídia kit: sempre com origem, período e horário. Sem conector => "— / não disponível", nunca zero falso.
import type { MetricRecord, MetricStatus } from './types';

export const METHODOLOGY_VERSION = 'mk-1';
/** Idade máxima (ms) por classe antes de marcar 'stale'. Realtime GA4 ~ minutos; histórico ~ dia. */
export const STALE_AFTER_MS = { realtime: 10 * 60_000, historical: 36 * 3_600_000 } as const;

export class MetricError extends Error { code = 'INVALID_METRIC' as const; }

export interface MetricKey { source: string; metric: string }

export function unavailable(key: MetricKey): MetricRecord {
  return { ...key, value: null, period_start: null, period_end: null, fetched_at: null, status: 'unavailable', methodology_version: METHODOLOGY_VERSION };
}

export class MetricStore {
  private last = new Map<string, MetricRecord>();
  private k = (m: MetricKey) => `${m.source}::${m.metric}`;

  /** Registra uma coleta real. Exige origem, período e horário; recusa valor sem esses campos. */
  ingest(r: { source: string; metric: string; value: number; period_start: string; period_end: string; fetched_at: string; methodology_version?: string }): MetricRecord {
    for (const f of ['source', 'metric', 'period_start', 'period_end', 'fetched_at'] as const) {
      if (!r[f]) throw new MetricError(`Métrica sem ${f}: recusada.`);
    }
    for (const f of ['period_start', 'period_end', 'fetched_at'] as const) {
      if (Number.isNaN(Date.parse(r[f]))) throw new MetricError(`Métrica com ${f} inválido: recusada.`);
    }
    if (!Number.isFinite(r.value)) throw new MetricError('Métrica com valor não numérico: recusada.');
    if (Date.parse(r.period_end) < Date.parse(r.period_start)) throw new MetricError('period_end anterior a period_start.');
    const rec: MetricRecord = { ...r, status: 'available', methodology_version: r.methodology_version ?? METHODOLOGY_VERSION };
    this.last.set(this.k(r), rec);
    return rec;
  }
  /** Falha de coleta: preserva a última coleta válida, marcando 'stale'; sem coleta anterior => 'unavailable'. */
  markFailure(key: MetricKey): MetricRecord {
    const prev = this.last.get(this.k(key));
    if (!prev) return unavailable(key);
    const stale = { ...prev, status: 'stale' as MetricStatus };
    this.last.set(this.k(key), stale);
    return stale;
  }
  /** Leitura na hora `now`: aplica envelhecimento por classe. */
  get(key: MetricKey, now: string, klass: keyof typeof STALE_AFTER_MS = 'historical'): MetricRecord {
    const r = this.last.get(this.k(key));
    if (!r) return unavailable(key);
    if (r.status === 'available' && r.fetched_at && Date.parse(now) - Date.parse(r.fetched_at) > STALE_AFTER_MS[klass]) return { ...r, status: 'stale' };
    return r;
  }
  all(): MetricRecord[] { return [...this.last.values()]; }
}

/** Texto de exibição: valor só se há registro disponível/desatualizado; senão "— / não disponível". */
export function displayMetric(r: MetricRecord): string {
  if (r.value === null || r.status === 'unavailable') return '— / não disponível';
  const base = r.value.toLocaleString('pt-BR');
  return r.status === 'stale' ? `${base} (desatualizado)` : base;
}
