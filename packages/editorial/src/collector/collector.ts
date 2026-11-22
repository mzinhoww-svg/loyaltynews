import type { Evidence, Source } from '../types';
import { eligibility } from '../sources/registry';
import { canonicalUrl, sha256 } from '../dedupe/dedupe';
import { assertAllowedUrl, UrlRejected } from './ssrf';
import { isAllowedByRobots, parseRobots } from './robots';
import { detectGate } from './paywall';
import { parseFeed, parseHtml } from './parse';
import { sanitize } from './sanitize';
import type { EditorialFlagOverrides } from '../flags';
import { requireFlag } from '../flags';
import type { Family, Resolver } from './net';
import { resolvePublic, systemResolver } from './net';

/**
 * Porta de rede. O Fetcher DEVE conectar em `address` (IP já validado como público pelo coletor), sem resolver DNS de novo,
 * sem seguir redirecionamentos e sem credenciais (ver http-fetcher.ts). Isso fecha o DNS rebinding.
 */
export interface HttpResponse { status: number; headers: Record<string, string>; body: string }
export interface FetchOptions { userAgent: string; address: string; family: Family }
export interface Fetcher { get(url: string, opts: FetchOptions): Promise<HttpResponse> }

export const USER_AGENT = 'LoyaltyNewsBot/0.1 (+coletor determinístico; respeita robots.txt)';
const MAX_REDIRECTS = 3;
const MAX_BODY_CHARS = 2_000_000;

export type SkipCode =
  | 'source_not_eligible' | 'url_rejected' | 'robots_disallow' | 'robots_unavailable' | 'gated'
  | 'http_error' | 'too_many_redirects' | 'empty_content' | 'body_too_large' | 'rate_limited' | 'crawl_delay_excessive';

export interface Skip { url: string; code: SkipCode; detail: string }
export interface CollectResult { evidences: Evidence[]; skipped: Skip[] }

export interface CollectorOptions {
  now?: () => Date; userAgent?: string; resolver?: Resolver; flags?: EditorialFlagOverrides;
  /** Espera entre requisições (injetável para teste). Padrão: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Crawl-delay acima disto (segundos) não é esperado: a coleta da fonte é pulada ('crawl_delay_excessive'). Padrão 120. */
  maxCrawlDelaySec?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Códigos de UrlRejected que viram motivo de skip próprio (os demais viram 'url_rejected'). */
const OWN_SKIP_CODES = ['too_many_redirects', 'rate_limited', 'crawl_delay_excessive'] as const;
const skipCodeOf = (e: unknown): SkipCode =>
  e instanceof UrlRejected ? ((OWN_SKIP_CODES as readonly string[]).includes(e.code) ? (e.code as SkipCode) : 'url_rejected') : 'http_error';

/** Coletor determinístico: sem LLM, sem decisão editorial. Só rede + parse + saneamento + hash. */
export class Collector {
  private readonly fetcher: Fetcher;
  private readonly now: () => Date;
  private readonly ua: string;
  private readonly resolver: Resolver;
  private readonly flags: EditorialFlagOverrides | undefined;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxCrawlDelaySec: number;
  /** Instante (ms) da última requisição por host e janela de 1 h de requisições, para Crawl-delay e limite por hora. */
  private readonly lastRequestAt = new Map<string, number>();
  private readonly hourWindow = new Map<string, number[]>();
  private readonly robotsCache = new Map<string, ReturnType<typeof parseRobots> | null>();
  constructor(fetcher: Fetcher, opts: CollectorOptions = {}) {
    this.fetcher = fetcher;
    this.now = opts.now ?? (() => new Date());
    this.ua = opts.userAgent ?? USER_AGENT;
    this.resolver = opts.resolver ?? systemResolver;
    this.flags = opts.flags;
    this.sleep = opts.sleep ?? realSleep;
    this.maxCrawlDelaySec = opts.maxCrawlDelaySec ?? 120;
  }

  /**
   * Cortesia com a fonte, antes de cada requisição que não seja o robots.txt:
   * (a) limite por hora da fonte (maxRequestsPerHour) — acima dele, 'rate_limited' (não espera horas);
   * (b) Crawl-delay do robots.txt — espera o intervalo desde a última requisição ao host; se o delay exceder
   *     maxCrawlDelaySec, a fonte é pulada ('crawl_delay_excessive') em vez de travar o worker.
   */
  private async throttle(source: Source): Promise<void> {
    const host = source.host;
    const nowMs = () => this.now().getTime();
    const win = (this.hourWindow.get(host) ?? []).filter((t) => nowMs() - t < 3_600_000);
    if (win.length >= source.maxRequestsPerHour) {
      this.hourWindow.set(host, win);
      throw new UrlRejected('rate_limited', `limite de ${source.maxRequestsPerHour} requisições/hora atingido para ${host}`);
    }
    const delaySec = this.robotsCache.get(host)?.crawlDelaySec ?? 0;
    if (delaySec > this.maxCrawlDelaySec) throw new UrlRejected('crawl_delay_excessive', `Crawl-delay de ${delaySec}s excede o máximo de ${this.maxCrawlDelaySec}s`);
    const last = this.lastRequestAt.get(host);
    if (delaySec > 0 && last !== undefined) {
      const wait = last + delaySec * 1000 - nowMs();
      if (wait > 0) await this.sleep(wait);
    }
    this.hourWindow.set(host, win);
  }

  private record(host: string): void {
    const t = this.now().getTime();
    this.lastRequestAt.set(host, t);
    const w = this.hourWindow.get(host) ?? [];
    w.push(t);
    this.hourWindow.set(host, w);
  }

  /**
   * Busca com validação anti-SSRF em CADA salto: URL literal (host/prefixo) + resolução DNS com TODOS os IPs públicos;
   * a conexão é fixada no IP validado (sem nova resolução entre validar e conectar).
   */
  private async safeGet(url: string, source: Source): Promise<HttpResponse> {
    let cur = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const isRobots = new URL(cur).pathname === '/robots.txt';
      assertAllowedUrl(cur, [source.host], source.pathPrefix, { allowRobots: isRobots });
      if (!isRobots) await this.throttle(source);
      const { pinned } = await resolvePublic(new URL(cur).hostname, this.resolver);
      const r = await this.fetcher.get(cur, { userAgent: this.ua, address: pinned.address, family: pinned.family });
      this.record(source.host);
      if (r.status >= 300 && r.status < 400 && r.headers['location']) {
        cur = new URL(r.headers['location'], cur).toString();
        continue;
      }
      return r;
    }
    throw new UrlRejected('too_many_redirects', `mais de ${MAX_REDIRECTS} redirecionamentos`);
  }

  private async robotsFor(source: Source): Promise<ReturnType<typeof parseRobots> | null> {
    if (this.robotsCache.has(source.host)) return this.robotsCache.get(source.host)!;
    let rules: ReturnType<typeof parseRobots> | null;
    try {
      const r = await this.safeGet(`https://${source.host}/robots.txt`, source);
      if (r.status === 200) rules = parseRobots(r.body, this.ua);
      else if (r.status === 404) rules = { allow: [], disallow: [], crawlDelaySec: null }; // sem robots = sem restrição
      else rules = null; // 401/403/5xx: tratar como indisponível => não coletar (fail closed)
    } catch { rules = null; }
    this.robotsCache.set(source.host, rules);
    return rules;
  }

  /** Coleta uma URL de uma fonte elegível. */
  async collectUrl(source: Source, url: string, hint?: { title?: string; publishedAt?: string | null }): Promise<{ evidence?: Evidence; skip?: Skip }> {
    requireFlag(this.flags, 'editorialCollector'); // desligada por padrão (contratos)
    const el = eligibility(source);
    if (!el.ok) return { skip: { url, code: 'source_not_eligible', detail: el.reasons.join(',') } };
    let u: URL;
    try { u = assertAllowedUrl(url, [source.host], source.pathPrefix); } catch (e) {
      return { skip: { url, code: 'url_rejected', detail: e instanceof UrlRejected ? e.code : 'invalid' } };
    }
    const rules = await this.robotsFor(source);
    if (!rules) return { skip: { url, code: 'robots_unavailable', detail: 'robots.txt indisponível; não coletar' } };
    if (!isAllowedByRobots(rules, u.pathname + u.search)) return { skip: { url, code: 'robots_disallow', detail: u.pathname } };
    let r: HttpResponse;
    try { r = await this.safeGet(u.toString(), source); } catch (e) {
      return { skip: { url, code: skipCodeOf(e), detail: e instanceof Error ? e.message : 'erro' } };
    }
    const gate = detectGate(r);
    if (gate.gated) return { skip: { url, code: 'gated', detail: gate.reasons.join(',') } };
    if (r.status < 200 || r.status >= 300) return { skip: { url, code: 'http_error', detail: String(r.status) } };
    if (r.body.length > MAX_BODY_CHARS) return { skip: { url, code: 'body_too_large', detail: String(r.body.length) } };
    const meta = parseHtml(r.body);
    const san = sanitize(meta.bodyHtml);
    if (!san.text) return { skip: { url, code: 'empty_content', detail: '' } };
    let canon: string;
    try { canon = canonicalUrl(meta.canonical ? new URL(meta.canonical, u).toString() : u.toString()); } catch { canon = canonicalUrl(u.toString()); }
    const hash = sha256(r.body);
    const fetchedAt = this.now().toISOString();
    const evidence: Evidence = {
      id: `ev_${hash.slice(0, 16)}`, sourceId: source.id, url: u.toString(), canonicalUrl: canon, fetchedAt,
      contentSha256: hash, title: meta.title || hint?.title || '', text: san.text,
      publishedAt: meta.publishedAt ?? hint?.publishedAt ?? null,
      suspicious: san.suspicious, suspiciousReasons: san.reasons,
    };
    return { evidence };
  }

  /** Coleta o feed da fonte e cada item (limite configurável). */
  async collectFeed(source: Source, limit = 20): Promise<CollectResult> {
    requireFlag(this.flags, 'editorialCollector');
    const out: CollectResult = { evidences: [], skipped: [] };
    const el = eligibility(source);
    if (!el.ok) { out.skipped.push({ url: source.feedUrl ?? source.host, code: 'source_not_eligible', detail: el.reasons.join(',') }); return out; }
    if (!source.feedUrl) { out.skipped.push({ url: source.host, code: 'empty_content', detail: 'fonte sem feedUrl cadastrado' }); return out; }
    const f = await this.collectRaw(source, source.feedUrl);
    if (f.skip) { out.skipped.push(f.skip); return out; }
    for (const it of parseFeed(f.body!).slice(0, limit)) {
      const r = await this.collectUrl(source, it.link, { title: it.title, publishedAt: it.publishedAt });
      if (r.evidence) out.evidences.push(r.evidence);
      else if (r.skip) {
        out.skipped.push(r.skip);
        // sem insistir quando a fonte pede pausa: limite por hora ou Crawl-delay excessivo
        if (r.skip.code === 'rate_limited' || r.skip.code === 'crawl_delay_excessive') break;
      }
    }
    return out;
  }

  private async collectRaw(source: Source, url: string): Promise<{ body?: string; skip?: Skip }> {
    let u: URL;
    try { u = assertAllowedUrl(url, [source.host], source.pathPrefix); } catch (e) {
      return { skip: { url, code: 'url_rejected', detail: e instanceof UrlRejected ? e.code : 'invalid' } };
    }
    const rules = await this.robotsFor(source);
    if (!rules) return { skip: { url, code: 'robots_unavailable', detail: 'robots.txt indisponível' } };
    if (!isAllowedByRobots(rules, u.pathname + u.search)) return { skip: { url, code: 'robots_disallow', detail: u.pathname } };
    try {
      const r = await this.safeGet(u.toString(), source);
      const gate = detectGate(r);
      if (gate.gated) return { skip: { url, code: 'gated', detail: gate.reasons.join(',') } };
      if (r.status !== 200) return { skip: { url, code: 'http_error', detail: String(r.status) } };
      return { body: r.body };
    } catch (e) {
      return { skip: { url, code: skipCodeOf(e), detail: e instanceof Error ? e.message : 'erro' } };
    }
  }
}

/** Evidência sem URL, data ou hash é rejeitada (ADR-007). */
export function validateEvidence(e: Partial<Evidence>): string[] {
  const errs: string[] = [];
  if (!e.url) errs.push('missing_url');
  if (!e.fetchedAt || Number.isNaN(Date.parse(e.fetchedAt))) errs.push('missing_date');
  if (!e.contentSha256 || !/^[0-9a-f]{64}$/.test(e.contentSha256)) errs.push('missing_hash');
  if (!e.sourceId) errs.push('missing_source');
  return errs;
}
