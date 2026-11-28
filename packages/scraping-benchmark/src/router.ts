/**
 * Roteador multiprovedor com fallback por domínio (Prompt-Mestre Fase F; Diretiva V3 §12).
 *  1. cache → 2. permissão (DP-32: login/paywall param) → 3. ordem por menor custo esperado por artigo válido no domínio
 *  4. fallback só em falha técnica elegível (recusa, CAPTCHA, robots e 429 do site param; ADR-007) → 5. Retry-After / backoff exponencial com jitter → 6. circuit breaker por provedor
 *  7. corte por orçamento (BudgetGuard) → 8. dedupe em voo e por URL vista → 9. provedor desligável → 10. decisão registrada.
 * Não publica nada: devolve o resultado para o pipeline existente decidir (shadow mode por padrão).
 */
import type { ReaderPort, ReadResult, ReaderFailure } from '@ln/intelligence';
import type { BudgetGuard } from './budget';
import { isProviderDisabled } from './flags';

export interface RoutedProvider {
  name: string;
  reader: ReaderPort;
  worstCaseCredits: number;
  usdPerCredit: number;
}

/** Falhas em que vale tentar OUTRO provedor. Login/paywall/not_found e qualquer recusa (ADR-007) NÃO. */
export const FALLBACK_ELIGIBLE: ReadonlySet<ReaderFailure> = new Set<ReaderFailure>([
  'unlock_forbidden', // este provedor não pode ser usado; não é recusa do site
  'timeout',
  'provider_error',
  'quota_exhausted',
  'rate_limited',
  'auth_failed',
  'disabled',
]);
export const STOP_FAILURES: ReadonlySet<ReaderFailure> = new Set<ReaderFailure>([
  'login_required', 'paywall', 'not_found',
  'captcha_unsolved', 'captcha_solved_by_provider', 'robots_disallow', 'robots_unavailable',
]);
/** Status que indicam recusa/bloqueio da página: outro provedor não é tentado (seria contornar). 429 para depois das tentativas no mesmo. */
export const REFUSAL_STATUS: ReadonlySet<number> = new Set([401, 402, 403, 451, 503, 520, 521]);
export const isRefusal = (r: { failure?: ReaderFailure; httpStatus?: number }): boolean =>
  (!!r.failure && STOP_FAILURES.has(r.failure)) || (!!r.failure && r.httpStatus !== undefined && REFUSAL_STATUS.has(r.httpStatus));

export const ATTEMPT_OVERHEAD_USD = 0.0002;

export interface DomainStat {
  attempts: number;
  valid: number;
  credits: number;
}

export interface RouteDecision {
  at: string;
  url: string;
  domain: string;
  step: 'cache_hit' | 'duplicate' | 'skip_disabled' | 'skip_circuit_open' | 'skip_budget' | 'skip_billing' | 'attempt' | 'fallback' | 'stop_restriction' | 'success' | 'exhausted' | 'wait_retry_after';
  provider?: string;
  detail?: string;
}

export interface RouterOptions {
  budget?: BudgetGuard;
  env?: Record<string, string | undefined>;
  breakerThreshold?: number; // falhas técnicas seguidas para abrir
  breakerCooldownMs?: number;
  maxRetriesPerProvider?: number; // só para rate_limited/timeout
  baseBackoffMs?: number;
  maxWaitMs?: number; // Retry-After acima disso = pula para o próximo provedor
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  isValid?: (r: ReadResult) => boolean; // validação editorial; padrão: ok && texto ≥ 600
}

export interface RouteOutcome {
  result: ReadResult | null;
  provider?: string;
  decisions: RouteDecision[];
  creditsUsed: number;
  fromCache: boolean;
}

const domainOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export class AdaptiveRouter {
  private stats = new Map<string, DomainStat>(); // `${domain}|${provider}`
  private breaker = new Map<string, { fails: number; openUntil: number }>();
  private cache = new Map<string, ReadResult>();
  private inflight = new Map<string, Promise<RouteOutcome>>();
  readonly log: RouteDecision[] = [];
  private o: Required<Omit<RouterOptions, 'budget'>> & { budget?: BudgetGuard };

  constructor(
    private readonly providers: RoutedProvider[],
    opts: RouterOptions = {},
  ) {
    this.o = {
      budget: opts.budget,
      env: opts.env ?? process.env,
      breakerThreshold: opts.breakerThreshold ?? 3,
      breakerCooldownMs: opts.breakerCooldownMs ?? 10 * 60_000,
      maxRetriesPerProvider: opts.maxRetriesPerProvider ?? 1,
      baseBackoffMs: opts.baseBackoffMs ?? 2_000,
      maxWaitMs: opts.maxWaitMs ?? 60_000,
      now: opts.now ?? Date.now,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      random: opts.random ?? Math.random,
      isValid: opts.isValid ?? ((r) => r.ok && (r.text?.trim().length ?? 0) >= 600),
    };
  }

  /** Semente a partir do benchmark (estatística real por domínio × provedor). */
  seed(domain: string, provider: string, s: DomainStat) {
    this.stats.set(`${domain}|${provider}`, { ...s });
  }

  /** Custo esperado por artigo válido no domínio (Laplace: provedores sem histórico não ficam com 0 nem ∞). */
  expectedCostPerValid(domain: string, p: RoutedProvider): number {
    const s = this.stats.get(`${domain}|${p.name}`) ?? { attempts: 0, valid: 0, credits: 0 };
    // provedor com ≥ 2 tentativas e nenhum sucesso no domínio vai para o fim (gratuito que sempre falha só gasta tempo)
    if (s.attempts >= 2 && s.valid === 0) return 1e3 + s.attempts;
    const pValid = (s.valid + 1) / (s.attempts + 2);
    const creditsPerAttempt = s.attempts ? s.credits / s.attempts : p.worstCaseCredits;
    // custo fixo por tentativa (US$ equiv. da latência/oportunidade): evita que custo ~0 ignore a taxa de falha
    return (creditsPerAttempt * p.usdPerCredit + ATTEMPT_OVERHEAD_USD) / pValid;
  }

  /**
   * Faixas por domínio (ressalva QA 3, M2): 0 = já teve sucesso; 1 = sem histórico; 2 = só falhou (mesmo com UMA observação).
   * Dentro da faixa, menor custo esperado por artigo válido. Antes, com uma única falha, um empate de custo podia pôr 1º quem falhou.
   */
  tier(domain: string, p: RoutedProvider): 0 | 1 | 2 {
    const s = this.stats.get(`${domain}|${p.name}`);
    if (!s || s.attempts === 0) return 1;
    return s.valid > 0 ? 0 : 2;
  }

  order(domain: string): RoutedProvider[] {
    return [...this.providers].sort((a, b) => this.tier(domain, a) - this.tier(domain, b) || this.expectedCostPerValid(domain, a) - this.expectedCostPerValid(domain, b));
  }

  private note(d: Omit<RouteDecision, 'at'>) {
    const full = { at: new Date(this.o.now()).toISOString(), ...d };
    this.log.push(full);
    return full;
  }

  private bump(domain: string, provider: string, valid: boolean, credits: number) {
    const k = `${domain}|${provider}`;
    const s = this.stats.get(k) ?? { attempts: 0, valid: 0, credits: 0 };
    s.attempts++;
    if (valid) s.valid++;
    s.credits += credits;
    this.stats.set(k, s);
  }

  // disjuntor por provedor × DOMÍNIO: um site que bloqueia não desliga o provedor para os outros sites (achado no replay)
  private breakerOpen(p: string) {
    const b = this.breaker.get(p);
    return !!b && b.openUntil > this.o.now();
  }
  private breakerResult(p: string, technicalFail: boolean) {
    const b = this.breaker.get(p) ?? { fails: 0, openUntil: 0 };
    if (!technicalFail) {
      b.fails = 0;
      b.openUntil = 0;
    } else if (++b.fails >= this.o.breakerThreshold) {
      b.openUntil = this.o.now() + this.o.breakerCooldownMs;
    }
    this.breaker.set(p, b);
  }

  route(url: string): Promise<RouteOutcome> {
    const key = url.trim();
    const pending = this.inflight.get(key);
    if (pending) {
      this.note({ url, domain: domainOf(url), step: 'duplicate', detail: 'requisição em voo reaproveitada' });
      return pending;
    }
    const p = this.doRoute(key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async doRoute(url: string): Promise<RouteOutcome> {
    const domain = domainOf(url);
    const decisions: RouteDecision[] = [];
    const push = (d: Omit<RouteDecision, 'at'>) => decisions.push(this.note(d));
    const cached = this.cache.get(url);
    if (cached) {
      push({ url, domain, step: 'cache_hit', provider: cached.provider });
      return { result: cached, provider: cached.provider, decisions, creditsUsed: 0, fromCache: true };
    }
    let credits = 0;
    let last: ReadResult | null = null;
    for (const p of this.order(domain)) {
      if (isProviderDisabled(p.name, this.o.env)) {
        push({ url, domain, step: 'skip_disabled', provider: p.name });
        continue;
      }
      if (this.breakerOpen(`${p.name}|${domain}`)) {
        push({ url, domain, step: 'skip_circuit_open', provider: p.name });
        continue;
      }
      if (this.o.budget) {
        const b = this.o.budget.check(p.name, p.worstCaseCredits);
        if (!b.ok) {
          push({ url, domain, step: b.reason === 'billing_unconfirmed' ? 'skip_billing' : 'skip_budget', provider: p.name });
          continue;
        }
      }
      for (let attempt = 0; attempt <= this.o.maxRetriesPerProvider; attempt++) {
        push({ url, domain, step: attempt === 0 ? 'attempt' : 'fallback', provider: p.name, detail: attempt ? `retry ${attempt}` : undefined });
        const r = await p.reader.read({ url, purpose: 'read' });
        const used = r.creditsUsed ?? 0;
        credits += used;
        if (used && this.o.budget) this.o.budget.record(p.name, used);
        last = r;
        const valid = this.o.isValid(r);
        if (valid) {
          this.bump(domain, p.name, true, used);
          this.breakerResult(`${p.name}|${domain}`, false);
          this.cache.set(url, r);
          push({ url, domain, step: 'success', provider: p.name });
          return { result: r, provider: p.name, decisions, creditsUsed: credits, fromCache: false };
        }
        this.bump(domain, p.name, false, used);
        if (isRefusal(r)) {
          push({ url, domain, step: 'stop_restriction', provider: p.name, detail: r.failure });
          return { result: r, provider: p.name, decisions, creditsUsed: credits, fromCache: false };
        }
        const technical = !r.failure || FALLBACK_ELIGIBLE.has(r.failure);
        this.breakerResult(`${p.name}|${domain}`, technical && r.failure !== 'rate_limited');
        const retryable = (r.failure === 'rate_limited' || r.failure === 'timeout') && attempt < this.o.maxRetriesPerProvider;
        if (!retryable) break;
        const wait =
          r.failure === 'rate_limited' && r.retryAfterSeconds
            ? r.retryAfterSeconds * 1000
            : this.o.baseBackoffMs * 2 ** attempt * (0.5 + this.o.random()); // backoff exponencial com jitter
        if (wait > this.o.maxWaitMs) break; // Retry-After longo: respeita, não força; tenta o próximo provedor
        push({ url, domain, step: 'wait_retry_after', provider: p.name, detail: `${Math.round(wait)}ms` });
        await this.o.sleep(wait);
      }
      if (last?.failure === 'rate_limited' && last.httpStatus === 429) { // o SITE pediu pausa: não trocar de provedor
        push({ url, domain, step: 'stop_restriction', provider: p.name, detail: 'rate_limited' });
        return { result: last, provider: last.provider, decisions, creditsUsed: credits, fromCache: false };
      }
    }
    push({ url, domain, step: 'exhausted', detail: last?.failure ?? 'sem provedor elegível' });
    return { result: last, provider: last?.provider, decisions, creditsUsed: credits, fromCache: false };
  }

  /** Matriz de roteamento: provedor preferido por domínio, com custo esperado. */
  matrix(domains: string[]): Array<{ domain: string; order: Array<{ provider: string; expectedUsdPerValid: number }> }> {
    return domains.map((d) => ({ domain: d, order: this.order(d).map((p) => ({ provider: p.name, expectedUsdPerValid: +this.expectedCostPerValid(d, p).toFixed(6) })) }));
  }
}
