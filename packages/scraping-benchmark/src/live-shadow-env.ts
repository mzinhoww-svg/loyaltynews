/**
 * Fábrica do shadow ao vivo para o worker editorial (pedido da Editorial, ft/editorial 9462555):
 *   createLiveShadowFromEnv(env) → { observe(url, {name,status,body?,ms}), drain() }
 * Monta o LiveShadow com o AdaptiveRouter, leitores dos provedores com chaves vindas do AMBIENTE (cofre do staging; nunca do código),
 * orçamento com corte automático (só cota gratuita) e o JSONL de `SCRAPING_SHADOW_SINK`.
 * Ritmo próprio (DP-31/DP-32), porque a Editorial não vê o roteador: ≥ 10 s por host, teto diário por host, 429 = host
 * suspenso no dia; login/paywall param no roteador. Só grava status/tamanho/hash/latência/créditos/provedor.
 */
import { createReader, ScrapflyReader, ZyteReader, ExaContentsReader, BrightDataUnlockerReader, ApifyRagBrowserReader } from '@ln/intelligence';
import type { KeyedReader } from '@ln/intelligence';
import { AdaptiveRouter, type RoutedProvider } from './router';
import { BudgetGuard, type ProviderBudget } from './budget';
import { DirectReader } from './direct-reader';
import { FirecrawlReader } from './firecrawl';
import { LiveShadow } from './live-shadow';

type Env = Record<string, string | undefined>;

interface Spec { name: string; keyed?: () => KeyedReader; envKey?: string; worst: number; usd: number; cap: number; quota: number; unit: string }
/** Ordem global recomendada pelo benchmark (critério v2): direct → Zyte → Scrapfly → Exa → Bright Data → Firecrawl → Apify. Tavily fora. */
export const SHADOW_PROVIDERS = (env: Env): Spec[] => [
  { name: 'direct', worst: 0, usd: 0, cap: Infinity, quota: Infinity, unit: '—' },
  { name: 'zyte-http', keyed: () => new ZyteReader('http'), envKey: 'LN_ZYTE_API_KEY', worst: 13, usd: 0.0001, cap: 3_000, quota: 50_000, unit: 'US$ 0,0001 (estimado)' },
  { name: 'scrapfly-basic', keyed: () => new ScrapflyReader('basic'), envKey: 'LN_SCRAPFLY_API_KEY', worst: 6, usd: 30 / 200_000, cap: 300, quota: 1_000, unit: 'crédito Scrapfly' },
  { name: 'exa-contents', keyed: () => new ExaContentsReader(), envKey: 'LN_EXA_API_KEY', worst: 1, usd: 0.001, cap: 300, quota: 10_000, unit: 'US$ 0,001' },
  { name: 'brightdata-unlocker', keyed: () => new BrightDataUnlockerReader(env.LN_BRIGHTDATA_ZONE ?? 'web_unlocker1'), envKey: 'LN_BRIGHTDATA_API_KEY', worst: 1, usd: 0.0015, cap: 300, quota: 5_000, unit: 'requisição' },
  { name: 'firecrawl-scrape', keyed: () => new FirecrawlReader(), envKey: 'LN_FIRECRAWL_API_KEY', worst: 1, usd: 19 / 5000, cap: 150, quota: 1_000, unit: 'crédito Firecrawl' },
  { name: 'apify-rag-web-browser', keyed: () => new ApifyRagBrowserReader(), envKey: 'LN_APIFY_API_TOKEN', worst: 5, usd: 0.001, cap: 300, quota: 5_000, unit: 'US$ 0,001 (estimado)' },
];

export interface ShadowHandle {
  observe(url: string, primary: { name: string; status: number; body?: string; ms: number }): void;
  drain(): Promise<void>;
  readonly enabled: boolean;
  readonly providers: string[];
}

/** Ritmo por host (≥ minGapMs entre leituras sombra do mesmo host, teto diário, 429 suspende o host no dia). */
export class ShadowHostGate {
  private last = new Map<string, number>();
  private day = new Map<string, { d: string; n: number }>();
  private suspended = new Map<string, string>();
  constructor(private readonly minGapMs = 10_000, private readonly maxPerHostPerDay = 5, private readonly now: () => number = Date.now) {}
  /** ms a esperar, ou null se o host está fora (teto do dia ou 429). Reserva a vaga quando permite. */
  reserve(host: string): number | null {
    const t = this.now();
    const d = new Date(t).toISOString().slice(0, 10);
    if (this.suspended.get(host) === d) return null;
    const c = this.day.get(host);
    const n = c && c.d === d ? c.n : 0;
    if (n >= this.maxPerHostPerDay) return null;
    const wait = Math.max(0, (this.last.get(host) ?? -Infinity) + this.minGapMs - t);
    this.last.set(host, t + wait);
    this.day.set(host, { d, n: n + 1 });
    return wait;
  }
  suspend(host: string) {
    this.suspended.set(host, new Date(this.now()).toISOString().slice(0, 10));
  }
}

export function createLiveShadowFromEnv(env: Env = process.env, deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): ShadowHandle {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const specs = SHADOW_PROVIDERS(env).filter((s) => !s.envKey || !!env[s.envKey]); // provedor sem chave no ambiente fica fora
  const budgets: Record<string, ProviderBudget> = {};
  for (const s of specs) if (s.envKey) budgets[s.name] = { provider: s.name, billing: 'free-confirmed', billingEvidence: 'DP-33 (cota gratuita)', creditCap: s.cap, usdPerCredit: s.usd, account: 'staging', unit: s.unit, accountQuota: s.quota, alertAt: Math.floor(s.quota * 0.8) };
  const budget = new BudgetGuard(budgets, env.SCRAPING_SHADOW_LEDGER);
  const gate = new ShadowHostGate(Number(env.SCRAPING_SHADOW_MIN_GAP_MS ?? 10_000), Number(env.SCRAPING_SHADOW_MAX_PER_HOST_DAY ?? 5), deps.now);
  const routed: RoutedProvider[] = specs.map((s) => ({
    name: s.name,
    reader: s.keyed
      ? createReader({ keyed: s.keyed(), keys: [{ label: 'staging', secretRef: s.envKey!, monthlyCreditCap: s.cap }], resolveSecret: (ref) => env[ref] }, { enabled: true, pace: false })
      : new DirectReader(),
    worstCaseCredits: s.worst,
    usdPerCredit: s.usd,
  }));
  // o roteador real não precisa esperar Retry-After longos na sombra: 429 suspende o host (abaixo) e passa adiante
  const router = new AdaptiveRouter(routed, { env, budget, maxWaitMs: 0, maxRetriesPerProvider: 0, now: deps.now, sleep });
  const shadow = new LiveShadow({
    router,
    env,
    sinkPath: env.SCRAPING_SHADOW_SINK,
    maxUrlsPerRun: Number(env.SCRAPING_SHADOW_MAX_URLS ?? 200),
    now: deps.now,
    beforeShadow: async (url) => {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        return false;
      }
      const wait = gate.reserve(host);
      if (wait === null) return false; // teto diário ou host suspenso por 429: não lê
      if (wait > 0) await sleep(wait);
      return true;
    },
    afterShadow: (url, c) => {
      if ('failure' in c.shadow && c.shadow.failure === 'rate_limited') gate.suspend(new URL(url).hostname.toLowerCase()); // 429: para o host no dia
      if (c.primary.status === 429) gate.suspend(new URL(url).hostname.toLowerCase()); // o próprio site pediu pausa ao coletor
    },
  });
  return { observe: (u, p) => shadow.observe(u, p), drain: () => shadow.drain(), enabled: shadow.enabled, providers: specs.map((s) => s.name) };
}
