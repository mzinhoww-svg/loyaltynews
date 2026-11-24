/**
 * Métricas e ranking (Diretiva V3 §11). Ranking: qualidade 35%, sucesso 25%, custo 20%, latência 15%, frescor 5%.
 * Elegibilidade legal/segurança é eliminatória (provedor com violação sai do ranking). Registros `mock` nunca entram.
 */
import type { AttemptRecord } from './types';

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx] ?? null;
}

export interface ProviderMetrics {
  provider: string;
  n: number;
  technicalSuccessRate: number;
  editorialSuccessRate: number;
  contentCompleteness: number; // mediana do tamanho do texto válido / 3000, limitada a 1
  titleAccuracy: number | null;
  sourceAccuracy: number | null;
  dateAccuracy: number | null; // só entre os verificáveis
  dateVerifiable: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  rate403: number;
  rate429: number;
  timeoutRate: number;
  retryRate: number;
  duplicateRate: number;
  cacheHitRate: number;
  creditsUsed: number;
  costEstimatedUsd: number;
  costPerValidArticleUsd: number | null;
  freshness: number | null; // fração de válidos com data ≤ 7 dias da coleta
  eligible: boolean;
}

export function computeMetrics(records: AttemptRecord[], opts: { ineligible?: Set<string>; referenceDates?: Map<string, string | null> } = {}): ProviderMetrics[] {
  const real = records.filter((r) => !r.mock && r.errorClass !== 'billing_unconfirmed' && r.errorClass !== 'budget_blocked' && r.errorClass !== 'disabled');
  const by = new Map<string, AttemptRecord[]>();
  for (const r of real) by.set(r.provider, [...(by.get(r.provider) ?? []), r]);
  const out: ProviderMetrics[] = [];
  for (const [provider, rs] of by) {
    const n = rs.length;
    const valid = rs.filter((r) => r.editorialSuccess);
    const frac = (f: (r: AttemptRecord) => boolean, base = rs) => (base.length ? base.filter(f).length / base.length : 0);
    const dated = valid.filter((r) => r.dateMatch !== null && r.dateMatch !== undefined);
    const lens = valid.map((r) => r.textLength).sort((a, b) => a - b);
    const hashes = new Map<string, number>();
    for (const r of valid) if (r.contentHash) hashes.set(r.contentHash, (hashes.get(r.contentHash) ?? 0) + 1);
    const dupes = [...hashes.values()].reduce((a, c) => a + (c > 1 ? c - 1 : 0), 0);
    const cost = rs.reduce((a, r) => a + (r.costEffectiveUsd ?? r.costEstimatedUsd), 0);
    // frescor: data extraída; sem ela (provedores que só devolvem texto), a data da descoberta da mesma URL
    const dateOf = (r: AttemptRecord) => r.publishedAt ?? opts.referenceDates?.get(r.urlId) ?? null;
    const fresh = valid.filter((r) => { const d = dateOf(r); return !!d && Date.parse(r.at) - Date.parse(d) <= 7 * 864e5; });
    out.push({
      provider,
      n,
      technicalSuccessRate: frac((r) => r.technicalSuccess),
      editorialSuccessRate: frac((r) => r.editorialSuccess),
      contentCompleteness: lens.length ? Math.min(1, (lens[Math.floor(lens.length / 2)] ?? 0) / 3000) : 0,
      // sobre as extrações com texto (não só as válidas: a validade já exige título, o que tornaria a métrica circular)
      titleAccuracy: rs.some((r) => r.technicalSuccess) ? frac((r) => (r.titleMatch ?? 0) >= 0.5, rs.filter((r) => r.technicalSuccess)) : null,
      sourceAccuracy: valid.some((r) => r.sourceMatch !== undefined) ? frac((r) => r.sourceMatch === true, valid.filter((r) => r.sourceMatch !== undefined)) : null,
      dateAccuracy: dated.length ? frac((r) => r.dateMatch === true, dated) : null,
      dateVerifiable: dated.length,
      p50: percentile(rs.map((r) => r.durationMs), 50),
      p95: percentile(rs.map((r) => r.durationMs), 95),
      p99: percentile(rs.map((r) => r.durationMs), 99),
      rate403: frac((r) => r.httpStatus === 403 || r.errorClass === 'http_403'),
      rate429: frac((r) => r.httpStatus === 429 || r.errorClass === 'http_429'),
      timeoutRate: frac((r) => r.errorClass === 'timeout'),
      retryRate: frac((r) => r.retries > 0),
      duplicateRate: valid.length ? dupes / valid.length : 0,
      cacheHitRate: frac((r) => r.cacheState === 'hit'),
      creditsUsed: rs.reduce((a, r) => a + r.creditsUsed, 0),
      costEstimatedUsd: +cost.toFixed(6),
      costPerValidArticleUsd: valid.length ? +(cost / valid.length).toFixed(6) : null,
      freshness: valid.length ? fresh.length / valid.length : null,
      eligible: !opts.ineligible?.has(provider),
    });
  }
  return out;
}

export interface RankRow {
  provider: string;
  score: number;
  parts: { quality: number; success: number; cost: number; latency: number; freshness: number };
  n: number;
  lowSample: boolean;
}

export const WEIGHTS = { quality: 0.35, success: 0.25, cost: 0.2, latency: 0.15, freshness: 0.05 } as const;

/** Normaliza custo e latência entre os provedores elegíveis (menor = 1). Amostra < 20 é marcada `lowSample`. */
export function rank(ms: ProviderMetrics[]): RankRow[] {
  const el = ms.filter((m) => m.eligible && m.n > 0);
  const costs = el.map((m) => m.costPerValidArticleUsd).filter((c): c is number => c !== null);
  const lats = el.map((m) => m.p50).filter((c): c is number => c !== null);
  // custo normalizado entre os PAGOS (o leitor direto, custo 0, recebe 1 e não zera os demais)
  const minC = Math.min(...costs.filter((c) => c > 0));
  const minL = Math.min(...lats);
  return el
    .map((m) => {
      const quality = (m.editorialSuccessRate + (m.titleAccuracy ?? 0) + (m.dateAccuracy ?? m.titleAccuracy ?? 0) + m.contentCompleteness) / 4;
      const success = m.technicalSuccessRate;
      const cost = m.costPerValidArticleUsd === null ? 0 : m.costPerValidArticleUsd === 0 ? 1 : minC / m.costPerValidArticleUsd;
      const latency = m.p50 ? minL / m.p50 : 0;
      const freshness = m.freshness ?? 0;
      const score = WEIGHTS.quality * quality + WEIGHTS.success * success + WEIGHTS.cost * cost + WEIGHTS.latency * latency + WEIGHTS.freshness * freshness;
      return { provider: m.provider, score: +score.toFixed(4), parts: { quality, success, cost, latency, freshness }, n: m.n, lowSample: m.n < 20 };
    })
    .sort((a, b) => b.score - a.score);
}

/** Projeção mensal (Diretiva V3 §10) a partir do custo por artigo válido medido. */
export function projectMonthly(costPerValid: number | null): Record<'1000' | '10000' | '50000' | '100000', number | null> {
  const f = (n: number) => (costPerValid === null ? null : +(costPerValid * n).toFixed(2));
  return { '1000': f(1000), '10000': f(10_000), '50000': f(50_000), '100000': f(100_000) };
}
