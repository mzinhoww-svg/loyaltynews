import type { Evidence, Source } from '../types';
import { ACESSO_DP31, sourceTier } from '../types';
import { eligibility } from '../sources/registry';
import { canonicalUrl, sha256 } from '../dedupe/dedupe';
import { assertAllowedUrl, UrlRejected } from './ssrf';
import { isAllowedByRobots, parseRobots } from './robots';
import { detectGate } from './paywall';
import { detectChallenge } from './crawl-guards.mjs';
import { parseFeed, parseHtml, parseSitemap } from './parse';
import { sanitize, stripHtml } from './sanitize';
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

/**
 * DP-31: leitura de página PÚBLICA por serviço de busca e extração (Tavily ou similar) no lugar da busca direta, só para fontes
 * com acesso 'risco-aceito-dp31'. O serviço NÃO resolve CAPTCHA, não entra em login/paywall e não falsifica navegador: se a
 * página vier com desafio, login ou paywall, o coletor para. status = o da leitura (200 ok; 429 pedido de pausa; 403/5xx falha).
 */
export interface ReaderResult { status: number; body: string; format?: 'html' | 'text'; retryAfterSec?: number | null; /** o serviço não conseguiu ler ESTA URL (site recusou/não renderizou): para a coleta da fonte, sem repetir */ failedUrl?: boolean; /** a COTA do serviço acabou em todas as chaves: não é culpa da fonte, mas a coleta DP-31 não tem como seguir */ quotaExhausted?: boolean }
/**
 * Orçamento de leituras DP-31 por host em janela deslizante. Em produção precisa ser GLOBAL (banco), senão duas instâncias do
 * worker somariam o dobro do teto. reserve() já registra a leitura quando permite; devolve o instante da leitura anterior do host.
 */
export interface ReadBudget {
  /** Reserva a próxima leitura do host: `waitMs` é quanto esperar (espaçamento desde a leitura anterior, de qualquer instância); a leitura fica registrada em nowMs + waitMs. */
  reserve(host: string, nowMs: number, max: number, windowMs: number, spacingMs: number): Promise<{ allowed: boolean; used: number; waitMs: number }>;
}
export class MemoryReadBudget implements ReadBudget {
  private readonly reads = new Map<string, number[]>();
  async reserve(host: string, nowMs: number, max: number, windowMs: number, spacingMs: number) {
    const win = (this.reads.get(host) ?? []).filter((t) => nowMs - t < windowMs);
    if (win.length >= max) { this.reads.set(host, win); return { allowed: false, used: win.length, waitMs: 0 }; }
    const waitMs = Math.max(0, (win.at(-1) ?? -Infinity) + spacingMs - nowMs);
    win.push(nowMs + waitMs); this.reads.set(host, win);
    return { allowed: true, used: win.length, waitMs };
  }
}

export interface ReaderPort {
  readonly name: string;
  read(url: string): Promise<ReaderResult>;
  /** Descoberta de matérias novas da fonte (busca restrita ao domínio). Opcional. */
  discover?(source: Source, limit: number): Promise<Array<{ url: string; title?: string; publishedAt?: string | null }>>;
}

export const USER_AGENT = 'LoyaltyNewsBot/0.1 (+coletor determinístico; respeita robots.txt)';
const MAX_REDIRECTS = 3;
const MAX_BODY_CHARS = 2_000_000;

export type SkipCode =
  | 'source_not_eligible' | 'url_rejected' | 'robots_disallow' | 'robots_unavailable' | 'gated'
  | 'http_error' | 'too_many_redirects' | 'empty_content' | 'body_too_large' | 'rate_limited' | 'crawl_delay_excessive' | 'challenge' | 'reader_unavailable';

/**
 * A fonte pediu para parar (429 / Retry-After, Crawl-delay excessivo), recusou (403) ou serviu página de desafio/CAPTCHA: o laço de coleta
 * da fonte PARA. Nunca insistir, repetir com outro cliente ou contornar.
 */
export const stopsCollection = (k: { code: SkipCode; detail: string }): boolean =>
  k.code === 'rate_limited' || k.code === 'crawl_delay_excessive' || k.code === 'challenge' || k.code === 'reader_unavailable'
  || (k.code === 'http_error' && (k.detail === '403' || k.detail === '401' || k.detail === 'reader_failed'));

/**
 * Guarda de parada de um laço de coleta (feed, sitemap, descoberta, âncoras, autoral). Para SEMPRE em 429, 403, desafio, Crawl-delay
 * excessivo, serviço de leitura ausente ou falha do serviço por URL; e para depois de 2 páginas seguidas com login/paywall
 * (gated) ou 3 falhas seguidas (HTTP de erro / conteúdo vazio): uma fonte que só devolve isso não pode ser martelada.
 * Um sucesso zera as sequências.
 */
export const GATED_LIMIT = 2;
export const FAIL_LIMIT = 3;
export class StopGuard {
  private gated = 0;
  private fails = 0;
  /** Registra o resultado de uma URL; devolve true quando a coleta da fonte deve PARAR. */
  note(skip: Skip | undefined): boolean {
    if (!skip) { this.gated = 0; this.fails = 0; return false; }
    if (stopsCollection(skip)) return true;
    if (skip.code === 'gated') { this.fails = 0; return ++this.gated >= GATED_LIMIT; }
    if (skip.code === 'http_error' || skip.code === 'empty_content') { this.gated = 0; return ++this.fails >= FAIL_LIMIT; }
    return false; // robots/url_rejected/etc.: decisão nossa, não hostilidade da fonte
  }
}

export interface Skip { url: string; code: SkipCode; detail: string }
export interface CollectResult { evidences: Evidence[]; skipped: Skip[] }

export interface CollectorOptions {
  now?: () => Date; userAgent?: string; resolver?: Resolver; flags?: EditorialFlagOverrides;
  /** Espera entre requisições (injetável para teste). Padrão: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Crawl-delay acima disto (segundos) não é esperado: a coleta da fonte é pulada ('crawl_delay_excessive'). Padrão 120. */
  maxCrawlDelaySec?: number;
  /** Intervalo mínimo entre requisições ao MESMO host, mesmo sem Crawl-delay (ms). Padrão 3000. Os testes passam 0. */
  minSpacingMs?: number;
  /** DP-31: serviço de leitura das fontes com acesso 'risco-aceito-dp31'. Sem ele, essas fontes são puladas ('reader_unavailable'). */
  reader?: ReaderPort;
  /** DP-31: contador GLOBAL de leituras por host (ex.: StoreReadBudget, no banco). Padrão: em memória (por instância; só para testes/dev). */
  readBudget?: ReadBudget;
  /** DP-31: intervalo mínimo entre leituras do mesmo host (ms). Padrão 10000 (mínimo do proprietário). */
  dp31SpacingMs?: number;
  /** DP-31: páginas por host em 24 h ("poucas por dia"). Padrão 5; acima disso, 'rate_limited'. */
  dp31MaxPagesPerDay?: number;
  /** DP-31: só se guarda um trecho curto do texto (nunca o texto integral). Padrão 1500 caracteres. */
  dp31MaxStoredChars?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Códigos de UrlRejected que viram motivo de skip próprio (os demais viram 'url_rejected'). */
const OWN_SKIP_CODES = ['too_many_redirects', 'rate_limited', 'crawl_delay_excessive', 'robots_disallow', 'robots_unavailable'] as const;
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
  private readonly minSpacingMs: number;
  private readonly reader: ReaderPort | undefined;
  private readonly dp31SpacingMs: number;
  private readonly dp31MaxPagesPerDay: number;
  private readonly dp31MaxStoredChars: number;
  private readonly readBudget: ReadBudget;
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
    this.minSpacingMs = opts.minSpacingMs ?? 3000;
    this.reader = opts.reader;
    this.readBudget = opts.readBudget ?? new MemoryReadBudget();
    this.dp31SpacingMs = opts.dp31SpacingMs ?? 10_000;
    this.dp31MaxPagesPerDay = opts.dp31MaxPagesPerDay ?? 5;
    this.dp31MaxStoredChars = opts.dp31MaxStoredChars ?? 1500;
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
    this.hourWindow.set(host, win);
  }

  /** Espera o maior entre o Crawl-delay do robots.txt e o intervalo mínimo (padrão 3 s) desde a última requisição ao host. */
  private async space(host: string): Promise<void> {
    const delayMs = Math.max((this.robotsCache.get(host)?.crawlDelaySec ?? 0) * 1000, this.minSpacingMs);
    const last = this.lastRequestAt.get(host);
    if (delayMs > 0 && last !== undefined) {
      const wait = last + delayMs - this.now().getTime();
      if (wait > 0) await this.sleep(wait);
    }
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
      const here = assertAllowedUrl(cur, [source.host], source.pathPrefix, { allowRobots: isRobots });
      if (i > 0 && !isRobots) {
        // Redirecionamento: o destino também precisa passar pelo robots.txt (mesmo host; outro host já é recusado acima).
        const rules = await this.robotsFor(source);
        if (!rules) throw new UrlRejected('robots_unavailable', 'robots.txt indisponível ao seguir redirecionamento');
        if (!isAllowedByRobots(rules, here.pathname + here.search)) throw new UrlRejected('robots_disallow', `redirecionamento para caminho vedado pelo robots.txt: ${here.pathname}`);
      }
      if (!isRobots) await this.throttle(source);
      await this.space(source.host);
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
      if (r.status === 200) {
        // 200 com HTML ou desafio no lugar do robots.txt não é "sem restrição": é falha de leitura (fail closed).
        const html = /<\s*(html|head|body|!doctype)/i.test(r.body.slice(0, 1000));
        rules = html || detectChallenge({ status: 200, headers: r.headers, html: r.body, text: r.body }) ? null : parseRobots(r.body, this.ua);
      }
      else if (r.status === 404) rules = parseRobots('', this.ua); // sem robots = sem restrição (decide pelo módulo comum)
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
    if (source.acesso === ACESSO_DP31) return this.collectUrlViaReader(source, u, hint);
    const rules = await this.robotsFor(source);
    if (!rules) return { skip: { url, code: 'robots_unavailable', detail: 'robots.txt indisponível; não coletar' } };
    if (!isAllowedByRobots(rules, u.pathname + u.search)) return { skip: { url, code: 'robots_disallow', detail: u.pathname } };
    let r: HttpResponse;
    try { r = await this.safeGet(u.toString(), source); } catch (e) {
      return { skip: { url, code: skipCodeOf(e), detail: e instanceof Error ? e.message : 'erro' } };
    }
    // Ordem importa: 429 e erros HTTP vêm ANTES de paywall/desafio (uma página de erro com "faça login" não pode esconder o 429 e manter a coleta insistindo).
    if (r.status === 429) return { skip: { url, code: 'rate_limited', detail: `HTTP 429 da fonte${r.headers['retry-after'] ? ` (Retry-After: ${r.headers['retry-after']})` : ''}` } };
    if (r.status < 200 || r.status >= 300) return { skip: { url, code: 'http_error', detail: String(r.status) } };
    const chal = detectChallenge({ status: r.status, headers: r.headers, html: r.body, text: stripHtml(r.body) });
    if (chal) return { skip: { url, code: 'challenge', detail: chal } };
    const gate = detectGate(r);
    if (gate.gated) return { skip: { url, code: 'gated', detail: gate.reasons.join(',') } };
    if (r.body.length > MAX_BODY_CHARS) return { skip: { url, code: 'body_too_large', detail: String(r.body.length) } };
    return this.toEvidence(source, u, r.body, hint);
  }

  /** Do corpo HTML ao Evidence (parse, saneamento, injeção em comentário, hash). `acesso`/`maxChars` só no caminho DP-31. */
  private toEvidence(source: Source, u: URL, body: string, hint: { title?: string; publishedAt?: string | null } | undefined, dp31 = false): { evidence?: Evidence; skip?: Skip } {
    const url = u.toString();
    const r = { body };
    const meta = parseHtml(r.body, u.toString());
    const san = sanitize(meta.bodyHtml);
    if (!san.text) return { skip: { url, code: 'empty_content', detail: '' } };
    // A extração por parágrafos descarta comentários HTML: confere-os na página inteira (onde se esconde instrução para modelos).
    const comments = [...r.body.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]!).join('\n');
    const csan = comments ? sanitize(comments) : { suspicious: false, reasons: [] as string[] };
    if (csan.suspicious) { san.suspicious = true; san.reasons = [...new Set([...san.reasons, ...csan.reasons])]; }
    let canon: string;
    try { canon = canonicalUrl(meta.canonical ? new URL(meta.canonical, u).toString() : u.toString()); } catch { canon = canonicalUrl(u.toString()); }
    const hash = sha256(r.body);
    const fetchedAt = this.now().toISOString();
    const evidence: Evidence = {
      id: `ev_${hash.slice(0, 16)}`, sourceId: source.id, url: u.toString(), canonicalUrl: canon, fetchedAt,
      contentSha256: hash, title: meta.title || hint?.title || '', text: san.text,
      publishedAt: meta.publishedAt ?? hint?.publishedAt ?? null,
      suspicious: san.suspicious, suspiciousReasons: san.reasons,
      sourceTier: sourceTier(source.kind),
      ...(meta.links.length ? { outboundLinks: meta.links } : {}),
      ...(dp31 ? { acesso: ACESSO_DP31 } : {}),
    };
    if (dp31) evidence.text = capText(evidence.text, this.dp31MaxStoredChars);
    return { evidence };
  }

  /** Coleta o feed da fonte e cada item (limite configurável). */
  async collectFeed(source: Source, limit = 20): Promise<CollectResult> {
    requireFlag(this.flags, 'editorialCollector');
    const out: CollectResult = { evidences: [], skipped: [] };
    const el = eligibility(source);
    if (!el.ok) { out.skipped.push({ url: source.feedUrl ?? source.host, code: 'source_not_eligible', detail: el.reasons.join(',') }); return out; }
    if (source.acesso === ACESSO_DP31) return this.collectDp31(source, limit);
    if (!source.feedUrl) { out.skipped.push({ url: source.host, code: 'empty_content', detail: 'fonte sem feedUrl cadastrado' }); return out; }
    const f = await this.collectRaw(source, source.feedUrl);
    if (f.skip) { out.skipped.push(f.skip); return out; }
    const guard = new StopGuard();
    for (const it of parseFeed(f.body!).slice(0, limit)) {
      const r = await this.collectUrl(source, it.link, { title: it.title, publishedAt: it.publishedAt });
      if (r.evidence) { out.evidences.push(r.evidence); guard.note(undefined); }
      else if (r.skip) { out.skipped.push(r.skip); if (guard.note(r.skip)) break; }
    }
    return out;
  }

  /** Janela de 24 h, espaçamento mínimo e leitura pelo serviço. Nunca repete, nunca tenta outro caminho. */
  private async readViaReader(source: Source, url: string): Promise<{ r?: ReaderResult; skip?: Skip }> {
    if (!this.reader) return { skip: { url, code: 'reader_unavailable', detail: `fonte com acesso ${ACESSO_DP31} e nenhum serviço de leitura configurado` } };
    const host = source.host;
    // Espera o intervalo desde a leitura anterior do host (de QUALQUER instância) e só então reserva a leitura no orçamento global.
    const slot = await this.readBudget.reserve(host, this.now().getTime(), this.dp31MaxPagesPerDay, 86_400_000, this.dp31SpacingMs);
    if (!slot.allowed) return { skip: { url, code: 'rate_limited', detail: `DP-31: limite de ${this.dp31MaxPagesPerDay} páginas por dia atingido para ${host} (${slot.used} nas últimas 24 h)` } };
    if (slot.waitMs > 0) await this.sleep(slot.waitMs);
    let r: ReaderResult;
    try { r = await this.reader.read(url); } catch (e) { return { skip: { url, code: 'http_error', detail: e instanceof Error ? e.message.slice(0, 160) : 'erro do serviço de leitura' } }; }
    if (r.quotaExhausted) return { skip: { url, code: 'reader_unavailable', detail: 'cota do serviço de leitura esgotada em todas as chaves' } };
    if (r.failedUrl) return { skip: { url, code: 'http_error', detail: 'reader_failed' } };
    if (r.status === 429) return { skip: { url, code: 'rate_limited', detail: `HTTP 429 (${this.reader.name})${r.retryAfterSec ? ` (Retry-After: ${r.retryAfterSec})` : ''}` } };
    if (r.status < 200 || r.status >= 300) return { skip: { url, code: 'http_error', detail: String(r.status) } };
    return { r };
  }

  /** Corpo do serviço → HTML mínimo (o serviço devolve texto/markdown): parágrafos escapados dentro de <article>. */
  private asHtml(r: ReaderResult): string {
    if (r.format !== 'text') return r.body;
    const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const paras = r.body.split(/\n{2,}/).map((x) => x.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return `<html><head><title>${esc((paras[0] ?? '').slice(0, 160))}</title></head><body><article>${paras.map((x) => `<p>${esc(x)}</p>`).join('')}</article></body></html>`;
  }

  /** DP-31: ignora robots.txt e a recusa do site; NÃO ignora desafio/CAPTCHA, login/paywall, 429 nem limites de ritmo. */
  private async collectUrlViaReader(source: Source, u: URL, hint?: { title?: string; publishedAt?: string | null }): Promise<{ evidence?: Evidence; skip?: Skip }> {
    const url = u.toString();
    const g = await this.readViaReader(source, url);
    if (g.skip) return { skip: g.skip };
    const html = this.asHtml(g.r!);
    if (html.length > MAX_BODY_CHARS) return { skip: { url, code: 'body_too_large', detail: String(html.length) } };
    const chal = detectChallenge({ status: g.r!.status, headers: {}, html, text: stripHtml(html) });
    if (chal) return { skip: { url, code: 'challenge', detail: chal } };
    const gate = detectGate({ status: g.r!.status, headers: {}, body: html });
    if (gate.gated) return { skip: { url, code: 'gated', detail: gate.reasons.join(',') } };
    return this.toEvidence(source, u, html, hint, true);
  }

  /** DP-31: descoberta por busca restrita ao domínio (discover) ou pelo feed lido pelo serviço; depois lê cada página, parando como na coleta normal. */
  private async collectDp31(source: Source, limit: number): Promise<CollectResult> {
    const out: CollectResult = { evidences: [], skipped: [] };
    if (!this.reader) { out.skipped.push({ url: source.host, code: 'reader_unavailable', detail: `fonte com acesso ${ACESSO_DP31} e nenhum serviço de leitura configurado` }); return out; }
    let items: Array<{ url: string; title?: string; publishedAt?: string | null }> = [];
    if (this.reader.discover) {
      try { items = await this.reader.discover(source, limit); } catch (e) { out.skipped.push({ url: source.host, code: 'http_error', detail: e instanceof Error ? e.message.slice(0, 160) : 'erro na descoberta' }); return out; }
    } else if (source.feedUrl) {
      const f = await this.collectRaw(source, source.feedUrl);
      if (f.skip) { out.skipped.push(f.skip); return out; }
      items = parseFeed(f.body!).map((i) => ({ url: i.link, title: i.title, publishedAt: i.publishedAt }));
    }
    const guard = new StopGuard();
    for (const it of items.slice(0, limit)) {
      const r = await this.collectUrl(source, it.url, { ...(it.title ? { title: it.title } : {}), publishedAt: it.publishedAt ?? null });
      if (r.evidence) { out.evidences.push(r.evidence); guard.note(undefined); }
      else if (r.skip) { out.skipped.push(r.skip); if (guard.note(r.skip)) break; }
    }
    return out;
  }

  /**
   * Coleta por SITEMAP (fontes sem feed que declaram sitemap no robots.txt). Mesmas salvaguardas do feed: elegibilidade, robots,
   * host/pathPrefix, ritmo e parada em 429. Índice de sitemaps: abre só os 2 filhos de data mais recente. As páginas mais recentes
   * (lastmod) que casam com sitemapPathPrefix são coletadas até o limite.
   */
  async collectSitemap(source: Source, limit = 20): Promise<CollectResult> {
    requireFlag(this.flags, 'editorialCollector');
    const out: CollectResult = { evidences: [], skipped: [] };
    const el = eligibility(source);
    if (!el.ok) { out.skipped.push({ url: source.sitemapUrl ?? source.host, code: 'source_not_eligible', detail: el.reasons.join(',') }); return out; }
    if (!source.sitemapUrl) { out.skipped.push({ url: source.host, code: 'empty_content', detail: 'fonte sem sitemapUrl cadastrado' }); return out; }
    const top = await this.collectRaw(source, source.sitemapUrl);
    if (top.skip) { out.skipped.push(top.skip); return out; }
    const parsed = parseSitemap(top.body!);
    let pages = parsed.entries;
    if (parsed.kind === 'index') {
      const children = [...parsed.entries].sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? '')).slice(0, 2);
      pages = [];
      for (const c of children) {
        const sub = await this.collectRaw(source, c.loc);
        if (sub.skip) { out.skipped.push(sub.skip); if (stopsCollection(sub.skip)) return out; continue; }
        pages.push(...parseSitemap(sub.body!).entries);
      }
    }
    const prefix = source.sitemapPathPrefix ?? '/';
    const chosen = pages
      .filter((e) => { try { return new URL(e.loc).pathname.startsWith(prefix); } catch { return false; } })
      .sort((a, b) => (b.lastmod ?? '').localeCompare(a.lastmod ?? ''))
      .slice(0, limit);
    const guard = new StopGuard();
    for (const e of chosen) {
      const r = await this.collectUrl(source, e.loc, { publishedAt: e.lastmod });
      if (r.evidence) { out.evidences.push(r.evidence); guard.note(undefined); }
      else if (r.skip) { out.skipped.push(r.skip); if (guard.note(r.skip)) break; }
    }
    return out;
  }

  private async collectRaw(source: Source, url: string): Promise<{ body?: string; skip?: Skip }> {
    let u: URL;
    try { u = assertAllowedUrl(url, [source.host], source.pathPrefix); } catch (e) {
      return { skip: { url, code: 'url_rejected', detail: e instanceof UrlRejected ? e.code : 'invalid' } };
    }
    if (source.acesso === ACESSO_DP31) {
      const g = await this.readViaReader(source, url);
      if (g.skip) return { skip: g.skip };
      const chal = detectChallenge({ status: g.r!.status, headers: {}, html: g.r!.body, text: g.r!.body });
      return chal ? { skip: { url, code: 'challenge', detail: chal } } : { body: g.r!.body };
    }
    const rules = await this.robotsFor(source);
    if (!rules) return { skip: { url, code: 'robots_unavailable', detail: 'robots.txt indisponível' } };
    if (!isAllowedByRobots(rules, u.pathname + u.search)) return { skip: { url, code: 'robots_disallow', detail: u.pathname } };
    try {
      const r = await this.safeGet(u.toString(), source);
      if (r.status === 429) return { skip: { url, code: 'rate_limited', detail: `HTTP 429 da fonte${r.headers['retry-after'] ? ` (Retry-After: ${r.headers['retry-after']})` : ''}` } };
      if (r.status !== 200) return { skip: { url, code: 'http_error', detail: String(r.status) } };
      const chal = detectChallenge({ status: r.status, headers: r.headers, html: r.body, text: stripHtml(r.body) });
      if (chal) return { skip: { url, code: 'challenge', detail: chal } };
      const gate = detectGate(r);
      if (gate.gated) return { skip: { url, code: 'gated', detail: gate.reasons.join(',') } };
      return { body: r.body };
    } catch (e) {
      return { skip: { url, code: skipCodeOf(e), detail: e instanceof Error ? e.message : 'erro' } };
    }
  }
}

/** Trecho curto (DP-31): corta no fim de frase quando dá, sem passar de `max` caracteres. */
export function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (end > max * 0.5) return cut.slice(0, end + 1);
  return cut.slice(0, Math.max(max - 1, 0)).trimEnd() + '…'; // a reticência ocupa 1 caractere: o total nunca passa de `max`
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
