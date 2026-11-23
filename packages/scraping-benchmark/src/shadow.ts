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
  provider_error: 'provider_error',
};

export class ReplayReader implements ReaderPort {
  calls = 0;
  constructor(
    readonly provider: string,
    private readonly byUrl: Map<string, AttemptRecord>,
  ) {}
  async read(req: { url: string }): Promise<ReadResult> {
    this.calls++;
    const a = this.byUrl.get(req.url);
    if (!a) return { ok: false, url: req.url, provider: this.provider, failure: 'disabled' };
    return a.editorialSuccess
      ? { ok: true, url: req.url, provider: this.provider, creditsUsed: a.creditsUsed, httpStatus: a.httpStatus, text: 'x'.repeat(Math.max(600, a.textLength)) }
      : { ok: false, url: req.url, provider: this.provider, creditsUsed: a.creditsUsed, httpStatus: a.httpStatus, failure: FAIL[a.errorClass] ?? 'provider_error' };
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
  const router = new AdaptiveRouter(readers, { env: {}, sleep: async () => {}, maxRetriesPerProvider: 0, breakerThreshold: 1e9 });
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
  for (const u of urls) {
    const out = await router.route(u);
    const tries = out.decisions.filter((d) => d.step === 'attempt');
    attempts += tries.length;
    fallbacks += Math.max(0, tries.length - 1);
    if (out.decisions.some((d) => d.step === 'stop_restriction')) stops++;
    if (out.result?.ok) valid++;
    for (const d of tries) {
      const rec = records.find((r) => r.url === u && r.provider === d.provider);
      if (rec) usd += rec.creditsUsed * (usdPerCredit[d.provider!] ?? 0);
    }
  }
  return { path: label, urls: urls.length, valid, attempts, fallbacks, creditsUsdEquiv: +usd.toFixed(5), usdPerValid: valid ? +(usd / valid).toFixed(6) : null, stopsByRestriction: stops, decisions: router.log.length };
}
