/**
 * Shadow mode por replay (Diretiva V3 §14): o roteador decide sobre as respostas REAIS já registradas no benchmark
 * (attempts.jsonl), sem nenhuma chamada nova e sem escrever no banco. Não é mock: cada leitura devolve o resultado medido
 * daquele provedor naquela URL. Compara com o caminho atual (coletor direto + Tavily via-provedor).
 */
import type { ReaderPort, ReadResult, ReaderFailure } from '@ln/intelligence';
import type { AttemptRecord, ErrorClass } from './types';
import { AdaptiveRouter, type RoutedProvider } from './router';

const FAIL: Partial<Record<ErrorClass, ReaderFailure>> = {
  http_429: 'rate_limited',
  timeout: 'timeout',
  captcha: 'captcha_unsolved',
  login_required: 'login_required',
  paywall: 'paywall',
  quota_exhausted: 'quota_exhausted',
  auth_failed: 'auth_failed',
  http_4xx: 'provider_error',
  http_403: 'provider_error',
  http_5xx: 'provider_error',
  empty_content: 'provider_error',
  title_mismatch: 'provider_error',
  not_found: 'not_found',
  provider_error: 'provider_error',
  robots: 'robots_disallow',
  source_refused: 'robots_disallow',
};

export class ReplayReader implements ReaderPort {
  calls = 0;
  onRead?: (durationMs: number) => void;
  constructor(
    readonly provider: string,
    private readonly byUrl: Map<string, AttemptRecord>,
  ) {}
  async read(req: { url: string }): Promise<ReadResult> {
    this.calls++;
    const a = this.byUrl.get(req.url);
    this.onRead?.(a?.durationMs ?? 0);
    if (!a) return { ok: false, url: req.url, provider: this.provider, failure: 'disabled' };
    return a.editorialSuccess
      ? { ok: true, url: req.url, provider: this.provider, creditsUsed: a.creditsUsed, httpStatus: a.httpStatus, text: 'x'.repeat(Math.max(600, a.textLength)) }
      : { ok: false, url: req.url, provider: this.provider, creditsUsed: a.creditsUsed, httpStatus: a.httpStatus, failure: a.errorClass === 'not_found' || a.httpStatus === 404 || a.httpStatus === 410 ? 'not_found' : (FAIL[a.errorClass] ?? 'provider_error') };
  }
}

export interface ShadowSummary {
  path: string;
  urls: number;
  valid: number;
  attempts: number;
  fallbacks: number;
  creditsUsdEquiv: number;
  usdPerValid: number | null;
  stopsByRestriction: number;
  latencyP50Ms?: number | null;
  latencyP95Ms?: number | null;
  perUrl?: Array<{ url: string; valid: boolean; provider?: string; latencyMs: number; attempts: number }>;
}

/** Executa um caminho (lista ordenada de provedores) ou o roteador adaptativo sobre as URLs, usando as respostas medidas. */
export async function shadowRun(
  label: string,
  urls: string[],
  records: AttemptRecord[],
  providerNames: string[],
  usdPerCredit: Record<string, number>,
  opts: { adaptive: boolean; seedFrom?: AttemptRecord[] },
): Promise<ShadowSummary & { decisions: number }> {
  const readers = providerNames.map((p) => {
    const m = new Map<string, AttemptRecord>();
    for (const r of records) if (r.provider === p && r.errorClass !== 'budget_blocked') m.set(r.url, r);
    return { name: p, reader: new ReplayReader(p, m), worstCaseCredits: 1, usdPerCredit: usdPerCredit[p] ?? 0 } satisfies RoutedProvider & { reader: ReplayReader };
  });
  // relógio SIMULADO (ressalva QA 3): avança pela duração medida de cada tentativa + 15 s de ritmo por URL, para o disjuntor
  // (3 falhas seguidas → 10 min fechado) se comportar como na rodada real, e não fechar para o resto do replay instantâneo.
  let clock = Date.parse('2026-11-23T13:00:00Z');
  for (const r of readers) r.reader.onRead = (ms) => (clock += ms);
  const router = new AdaptiveRouter(readers, { env: {}, sleep: async (ms) => void (clock += ms), maxRetriesPerProvider: 0, now: () => clock });
  if (!opts.adaptive) router.order = () => readers; // ordem fixa (caminho atual)
  if (opts.adaptive && opts.seedFrom) {
    for (const r of opts.seedFrom) {
      if (!providerNames.includes(r.provider) || r.errorClass === 'budget_blocked') continue;
      const key = { attempts: 1, valid: r.editorialSuccess ? 1 : 0, credits: r.creditsUsed };
      const cur = (router as unknown as { stats: Map<string, { attempts: number; valid: number; credits: number }> }).stats.get(`${r.domain}|${r.provider}`);
      router.seed(r.domain, r.provider, cur ? { attempts: cur.attempts + 1, valid: cur.valid + key.valid, credits: cur.credits + key.credits } : key);
    }
  }
  let valid = 0, attempts = 0, fallbacks = 0, usd = 0, stops = 0;
  const perUrl: NonNullable<ShadowSummary['perUrl']> = [];
  for (const u of urls) {
    clock += 15_000;
    const out = await router.route(u);
    const tries = out.decisions.filter((d) => d.step === 'attempt');
    attempts += tries.length;
    fallbacks += Math.max(0, tries.length - 1);
    if (out.decisions.some((d) => d.step === 'stop_restriction')) stops++;
    if (out.result?.ok) valid++;
    let lat = 0;
    for (const d of tries) {
      const rec = records.find((r) => r.url === u && r.provider === d.provider);
      if (rec) {
        usd += rec.creditsUsed * (usdPerCredit[d.provider!] ?? 0);
        lat += rec.durationMs;
      }
    }
    perUrl.push({ url: u, valid: !!out.result?.ok, provider: out.result?.ok ? out.provider : undefined, latencyMs: lat, attempts: tries.length });
  }
  const lats = perUrl.map((p) => p.latencyMs).sort((a, b) => a - b);
  const q = (x: number) => (lats.length ? lats[Math.min(lats.length - 1, Math.ceil(x * lats.length) - 1)]! : null);
  return { path: label, urls: urls.length, valid, attempts, fallbacks, creditsUsdEquiv: +usd.toFixed(5), usdPerValid: valid ? +(usd / valid).toFixed(6) : null, stopsByRestriction: stops, decisions: router.log.length, latencyP50Ms: q(0.5), latencyP95Ms: q(0.95), perUrl };
}
