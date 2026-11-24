/**
 * PROPOSTA de adaptador de leitura por provedor externo (DP-32): porta comum `ReaderPort` para Bright Data, Tavily, Firecrawl,
 * Jina, ScrapingBee etc., com lista de chaves (duas contas por provedor) e troca automática quando a cota gratuita acaba.
 * Referência testada e SEM rede: os adaptadores HTTP de cada provedor implementam `KeyedReader` e entram depois, com as chaves
 * que o proprietário fornecer. Pode ser movida para `packages/editorial` (dona do coletor) — o contrato é o que importa.
 *
 * Regras da DP-32 que o código impõe:
 *  - DESLIGADO por padrão (`createReader` sem `enabled: true` devolve um leitor que não chama nada).
 *  - Desbloqueio, CAPTCHA e proxies feitos pelo PRÓPRIO provedor são aceitos (o desafio resolvido pelo provedor não para a leitura).
 *  - Login e paywall continuam parando: página com formulário de senha ou aviso de conteúdo pago vira falha e o texto é descartado.
 *  - Ritmo baixo: mínimo entre leituras do mesmo host e teto diário por host; 429 do provedor = espera, não força.
 *  - Nada pago: cada chave tem teto de créditos igual à cota gratuita; acabou, troca de chave; sem chave com saldo = falha (nunca compra).
 *  - Nunca reproduzir texto: `ReadResult.text` é EFÊMERO (usar para extrair o fato e descartar). Só o fato (curto), a fonte, o link e a
 *    data podem ser persistidos: `toPersistableFact` recusa texto longo e campos de corpo da página.
 *  - Segredo nunca sai do pool: o resultado traz só o RÓTULO da chave ("conta-1"), nunca o valor.
 */

export type ReaderFailure =
  | 'disabled'
  | 'quota_exhausted' // todas as chaves sem saldo gratuito
  | 'rate_limited' // limite de taxa do provedor (espera)
  | 'host_paced' // ritmo baixo por host
  | 'login_required'
  | 'paywall'
  | 'captcha_unsolved' // o provedor devolveu o próprio desafio (não o conteúdo)
  | 'not_found'
  | 'timeout'
  | 'provider_error'
  | 'auth_failed'; // chave recusada pelo provedor (inválida/revogada): a chave sai de uso e a próxima é tentada

export interface ReadRequest {
  url: string;
  /** 'discovery' = busca/listagem de links; 'read' = ler uma página pública. */
  purpose?: 'discovery' | 'read';
}

/** O que um adaptador de provedor devolve para UMA chamada com UMA chave. */
export interface ProviderResponse {
  status: 'ok' | 'quota_exhausted' | 'rate_limited' | 'captcha_unsolved' | 'not_found' | 'timeout' | 'provider_error' | 'auth_failed';
  /** Créditos que a chamada consumiu segundo o provedor (ex.: Bright Data Web Unlocker = 1; Firecrawl scrape = 1). */
  credits?: number;
  /** Se 'rate_limited': segundos até tentar de novo. */
  retryAfterSeconds?: number;
  httpStatus?: number;
  finalUrl?: string;
  /** Texto e HTML da página como o provedor entregou (EFÊMEROS). */
  text?: string;
  html?: string;
  /** O provedor resolveu um CAPTCHA/desafio por conta própria (informativo; permitido pela DP-32). */
  providerSolvedCaptcha?: boolean;
}

/** Implementado por cada provedor (Bright Data, Tavily, Firecrawl…): uma chamada com a chave recebida. */
export interface KeyedReader {
  readonly provider: string;
  /** Créditos que uma leitura deve custar no pior caso (para checar o teto ANTES de chamar). */
  readonly creditsPerRead: number;
  /** O provedor faz desbloqueio (CAPTCHA/proxy próprios, DP-32). Informativo. */
  readonly unlocks?: boolean;
  /** Fração da cota gratuita mensal que UMA leitura consome (para ordenar a cascata por custo). */
  readonly freeQuotaFractionPerRead?: number;
  read(req: ReadRequest, apiKey: string): Promise<ProviderResponse>;
}

export interface ReadResult {
  ok: boolean;
  url: string;
  provider: string;
  /** Rótulo da chave usada (ex.: "conta-1"); NUNCA o segredo. */
  keyLabel?: string;
  creditsUsed?: number;
  failure?: ReaderFailure;
  retryAfterSeconds?: number;
  finalUrl?: string;
  providerSolvedCaptcha?: boolean;
  /** Status HTTP da PÁGINA de destino (quando o provedor informa). */
  httpStatus?: number;
  /** EFÊMEROS: extrair o fato e descartar. Nunca persistir (DP-29). Ausentes em qualquer falha. */
  text?: string;
  html?: string;
}

export interface ReaderPort {
  readonly provider: string;
  read(req: ReadRequest): Promise<ReadResult>;
}

// ------------------------------------------------------------------------------------------------
// Chaves, cota e troca automática
// ------------------------------------------------------------------------------------------------

export interface KeyConfig {
  /** Rótulo para registros e relatórios ("conta-1", "conta-2"). */
  label: string;
  /** Referência ao segredo (nome de variável de ambiente ou item do cofre); o valor é resolvido por `resolveSecret`. */
  secretRef: string;
  /** Teto de créditos por mês = cota GRATUITA do plano (nunca acima: nada pago). */
  monthlyCreditCap: number;
}

export interface Clock {
  now(): Date;
}

/** Primeiro instante do mês seguinte, em UTC (renovação típica das cotas gratuitas: "renova no dia 1"). */
export const nextMonthStartUtc = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0));
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

interface KeyState {
  cfg: KeyConfig;
  usedInMonth: number;
  month: string;
  exhaustedUntil: Date | null;
  cooldownUntil: Date | null;
  invalid?: boolean;
}

/** Pool de chaves de UM provedor: escolhe a primeira chave com saldo; esgotada vira indisponível até a renovação. */
export class QuotaKeyPool {
  private readonly states: KeyState[];

  constructor(
    keys: KeyConfig[],
    private readonly clock: Clock,
  ) {
    if (keys.length === 0) throw new Error('pool exige ao menos uma chave');
    const labels = new Set(keys.map((k) => k.label));
    if (labels.size !== keys.length) throw new Error('rótulos de chave repetidos');
    for (const k of keys) if (!(k.monthlyCreditCap > 0)) throw new Error(`teto mensal inválido para ${k.label}`);
    this.states = keys.map((cfg) => ({ cfg, usedInMonth: 0, month: monthKey(clock.now()), exhaustedUntil: null, cooldownUntil: null }));
  }

  private refresh(s: KeyState): void {
    const now = this.clock.now();
    if (s.month !== monthKey(now)) { s.month = monthKey(now); s.usedInMonth = 0; }
    if (s.exhaustedUntil && now >= s.exhaustedUntil) s.exhaustedUntil = null;
    if (s.cooldownUntil && now >= s.cooldownUntil) s.cooldownUntil = null;
  }

  /** Chaves na ordem de preferência que podem pagar `cost` créditos agora (saldo local, sem esgotamento nem espera). */
  candidates(cost: number): KeyConfig[] {
    return this.states
      .filter((s) => {
        this.refresh(s);
        return !s.exhaustedUntil && !s.cooldownUntil && s.usedInMonth + cost <= s.cfg.monthlyCreditCap;
      })
      .map((s) => s.cfg);
  }

  charge(label: string, credits: number): void {
    const s = this.find(label);
    this.refresh(s);
    s.usedInMonth += credits;
  }

  /** O provedor disse que a cota acabou: a chave fica indisponível até a renovação (dia 1 UTC do mês seguinte). */
  markExhausted(label: string): void {
    const s = this.find(label);
    s.exhaustedUntil = nextMonthStartUtc(this.clock.now());
    s.usedInMonth = s.cfg.monthlyCreditCap;
  }

  /** Chave recusada (401): sai de uso até reiniciar o processo (marcada como esgotada por 10 anos) e aparece no relatório. */
  markInvalid(label: string): void {
    const s = this.find(label);
    s.exhaustedUntil = new Date(this.clock.now().getTime() + 10 * 365 * 24 * 3600 * 1000);
    s.invalid = true;
  }

  /** Limite de taxa do provedor: espera `seconds` antes de reutilizar a chave (não é esgotamento). */
  cooldown(label: string, seconds: number): void {
    const s = this.find(label);
    s.cooldownUntil = new Date(this.clock.now().getTime() + Math.max(1, seconds) * 1000);
  }

  /** Relatório sem segredos: saldo local por chave. */
  report(): { label: string; usedInMonth: number; cap: number; exhaustedUntil: string | null; cooldownUntil: string | null; invalid?: boolean }[] {
    return this.states.map((s) => {
      this.refresh(s);
      return { label: s.cfg.label, usedInMonth: s.usedInMonth, cap: s.cfg.monthlyCreditCap, exhaustedUntil: s.exhaustedUntil?.toISOString() ?? null, cooldownUntil: s.cooldownUntil?.toISOString() ?? null, ...(s.invalid ? { invalid: true } : {}) };
    });
  }

  private find(label: string): KeyState {
    const s = this.states.find((x) => x.cfg.label === label);
    if (!s) throw new Error(`chave desconhecida: ${label}`);
    return s;
  }
}

// ------------------------------------------------------------------------------------------------
// Ritmo baixo por host
// ------------------------------------------------------------------------------------------------

export interface PaceConfig {
  /** Mínimo entre duas leituras do MESMO host (DP-31/32: ≥ 10 s). */
  minSecondsPerHost: number;
  /** Teto de leituras por host por dia UTC ("poucas páginas por dia"). */
  maxPerHostPerDay: number;
}
export const DEFAULT_PACE: PaceConfig = Object.freeze({ minSecondsPerHost: 10, maxPerHostPerDay: 20 });

export class HostPacer {
  private readonly last = new Map<string, number>();
  private readonly perDay = new Map<string, { day: string; n: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly cfg: PaceConfig = DEFAULT_PACE,
  ) {}

  /** `null` se pode ler agora; senão quantos segundos esperar (ou `Infinity` se o teto do dia estourou). */
  check(host: string): number | null {
    const now = this.clock.now();
    const day = now.toISOString().slice(0, 10);
    const d = this.perDay.get(host);
    if (d && d.day === day && d.n >= this.cfg.maxPerHostPerDay) return Infinity;
    const last = this.last.get(host);
    if (last !== undefined) {
      const wait = this.cfg.minSecondsPerHost - (now.getTime() - last) / 1000;
      if (wait > 0) return Math.ceil(wait);
    }
    return null;
  }

  record(host: string): void {
    const now = this.clock.now();
    const day = now.toISOString().slice(0, 10);
    this.last.set(host, now.getTime());
    const d = this.perDay.get(host);
    this.perDay.set(host, d && d.day === day ? { day, n: d.n + 1 } : { day, n: 1 });
  }
}

// ------------------------------------------------------------------------------------------------
// Login e paywall continuam parando (DP-32); CAPTCHA resolvido pelo provedor não
// ------------------------------------------------------------------------------------------------

const LOGIN_FORM = /<input[^>]+type=["']?password["']?/i;
const LOGIN_TEXT = /(fa[cç]a (?:o )?login para (?:continuar|ler|acessar)|entre (?:na|com) sua conta para (?:continuar|ler)|sign in to (?:continue|read|view)|log in to (?:continue|read|view)|you must be logged in)/i;
const PAYWALL_TEXT = /(conte[uú]do exclusivo para assinantes|assine para (?:continuar lendo|ler (?:a )?(?:mat[eé]ria|not[ií]cia) completa)|reservado a assinantes|subscribe to (?:continue reading|read (?:the )?full)|this (?:article|content) is for subscribers|to continue reading,? (?:please )?subscribe)/i;

// Elemento candidato a overlay/paywall: o conteúdo vai até o fechamento da PRIMEIRA tag igual; class e id são lidos à parte (marcador por TOKEN, não por substring).
const WALL_TAG = /<(div|section|aside|dialog)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
const WALL_ATTR = /\b(?:class|id)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
// Marcador de overlay por TOKEN de class/id (R5 do QA 3, ee01f58; mesma regra de isWallMarker em @ln/scraping-benchmark, 5cff1d0), nunca por pedaço de palavra:
//  - fortes (bastam sozinhos): paywall, regwall, premium, overlay, modal, piano, meter, tp, e tokens que começam com subscri/assinant;
//  - fracos (gate, wall): só com um qualificador no MESMO atributo (content, pay, reg, member(s), login, article, story, premium, subscriber, assinante).
// Assim `content-gate`, `pay-wall`, `site-paywall`, `tp-holder` e `subscriber_modal` contam; `gateway`, `firewall`, `aggregate` e um `wall` isolado em volta do corpo, não.
const WALL_STRONG = new Set(['paywall', 'regwall', 'premium', 'overlay', 'modal', 'piano', 'meter', 'tp']);
const WALL_STRONG_PREFIX = ['subscri', 'assinant'];
const WALL_WEAK = new Set(['gate', 'wall']);
const WALL_QUALIFIER = new Set(['content', 'pay', 'reg', 'member', 'members', 'login', 'article', 'story', 'premium', 'subscriber', 'assinante']);
export function isWallMarker(attr: string): boolean {
  const toks = attr.toLowerCase().split(/[\s\-_]+/).filter(Boolean);
  if (toks.some((t) => WALL_STRONG.has(t) || WALL_STRONG_PREFIX.some((p) => t.startsWith(p)))) return true;
  return toks.some((t) => WALL_WEAK.has(t)) && toks.some((t) => WALL_QUALIFIER.has(t));
}
const hasWallMarker = (attrs: string): boolean => [...attrs.matchAll(WALL_ATTR)].some((m) => isWallMarker(m[1] ?? m[2] ?? ''));
/** Janela do texto do próprio elemento marcado (overlay é curto por natureza): lê até 6.000 caracteres dele. */
export const PAYWALL_ELEMENT_CHARS = 6000;
const stripTags = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Aviso de paywall só no HTML de página longa: início do texto visível (sem script/style) ou texto de elemento de overlay/paywall/modal (class/id), em qualquer ponto. */
function htmlHasPaywallOverlay(html: string): boolean {
  const visible = stripTags(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
  if (PAYWALL_TEXT.test(visible.slice(0, PAYWALL_HEAD_CHARS))) return true;
  for (const m of html.matchAll(WALL_TAG)) {
    if (!hasWallMarker(m[2] ?? '')) continue;
    const inner = stripTags(m[3] ?? '');
    if (PAYWALL_TEXT.test(inner.slice(0, PAYWALL_ELEMENT_CHARS))) return true;
  }
  return false;
}

/** Limites do detector de paywall (iguais aos de detectWall em @ln/scraping-benchmark): até PAYWALL_SHORT_PAGE caracteres a checagem é completa; acima, só o início. */
export const PAYWALL_SHORT_PAGE = 3000;
export const PAYWALL_HEAD_CHARS = 1500;

export function detectLoginOrPaywall(r: { text?: string; html?: string; httpStatus?: number }): 'login_required' | 'paywall' | null {
  const html = r.html ?? '';
  const text = r.text ?? '';
  if (r.httpStatus === 401) return 'login_required';
  if (r.httpStatus === 402) return 'paywall';
  // paywall: página CURTA (até 3.000 caracteres) é checada inteira; página LONGA só nos primeiros 1.500 do texto (R2 do QA 1, 63c16df): uma reportagem longa e
  // legítima que CITA "assine para continuar lendo" no meio do corpo não é paywall. R4 (QA 3, 542ec10): o aviso que só existe no HTML (overlay/modal) não pode escapar,
  // então na página longa checa-se também o início do texto visível do HTML e o texto de elementos cujo class/id indica paywall/overlay/modal, em qualquer ponto.
  const basis = text || html;
  if (basis.length <= PAYWALL_SHORT_PAGE) {
    if (PAYWALL_TEXT.test(text) || PAYWALL_TEXT.test(html)) return 'paywall';
  } else {
    if (PAYWALL_TEXT.test(basis.slice(0, PAYWALL_HEAD_CHARS))) return 'paywall';
    if (html && htmlHasPaywallOverlay(html)) return 'paywall';
  }
  // formulário de senha numa página CURTA = tela de login; página longa com campo de senha (ex.: rodapé "área do cliente") não conta
  if (LOGIN_FORM.test(html) && text.length < 1500) return 'login_required';
  if (LOGIN_TEXT.test(text) && text.length < 1500) return 'login_required';
  return null;
}

// ------------------------------------------------------------------------------------------------
// Leitor com pool, ritmo e guardas; desligado por padrão
// ------------------------------------------------------------------------------------------------

export interface ReaderConfig {
  /** Padrão false. Ligar é decisão registrada (flag própria em @ln/contracts, desligada por padrão). */
  enabled?: boolean;
  /** `false` desliga o ritmo interno (o chamador, ex.: Editorial, já controla ≥ 10 s por host e o teto diário). */
  pace?: PaceConfig | false;
}

export interface ReaderDeps {
  keyed: KeyedReader;
  keys: KeyConfig[];
  /** Resolve a referência do segredo (env/cofre) só no momento da chamada. */
  resolveSecret: (secretRef: string) => string | undefined;
  clock?: Clock;
}

class DisabledReader implements ReaderPort {
  constructor(readonly provider: string) {}
  async read(req: ReadRequest): Promise<ReadResult> {
    return { ok: false, url: req.url, provider: this.provider, failure: 'disabled' };
  }
}

class PooledReader implements ReaderPort {
  readonly provider: string;
  readonly unlocks?: boolean;
  readonly freeQuotaFractionPerRead?: number;
  readonly pool: QuotaKeyPool;
  private readonly pacer: HostPacer | null;

  constructor(private readonly deps: ReaderDeps, pace: PaceConfig | false) {
    this.provider = deps.keyed.provider;
    this.unlocks = deps.keyed.unlocks;
    this.freeQuotaFractionPerRead = deps.keyed.freeQuotaFractionPerRead;
    const clock = deps.clock ?? { now: () => new Date() };
    this.pool = new QuotaKeyPool(deps.keys, clock);
    this.pacer = pace === false ? null : new HostPacer(clock, pace);
  }

  async read(req: ReadRequest): Promise<ReadResult> {
    const base = { url: req.url, provider: this.provider };
    let host: string;
    try {
      const u = new URL(req.url);
      if (!/^https?:$/.test(u.protocol)) return { ...base, ok: false, failure: 'provider_error' };
      host = u.hostname.toLowerCase();
    } catch {
      return { ...base, ok: false, failure: 'provider_error' };
    }
    const wait = this.pacer?.check(host) ?? null;
    if (wait !== null) return { ...base, ok: false, failure: 'host_paced', retryAfterSeconds: wait === Infinity ? undefined : wait };

    const cost = this.deps.keyed.creditsPerRead;
    let sawRateLimit: number | undefined;
    let sawAuthFailure = false;
    for (const key of this.pool.candidates(cost)) {
      const secret = this.deps.resolveSecret(key.secretRef);
      if (!secret) continue; // chave sem segredo configurado: tenta a próxima (nunca falha por vazio)
      this.pacer?.record(host);
      const resp = await this.deps.keyed.read(req, secret);
      if (resp.credits) this.pool.charge(key.label, resp.credits);

      if (resp.status === 'auth_failed') { this.pool.markInvalid(key.label); sawAuthFailure = true; continue; } // chave inválida: tenta a próxima
      if (resp.status === 'quota_exhausted') { this.pool.markExhausted(key.label); continue; } // troca automática para a próxima chave
      if (resp.status === 'rate_limited') { this.pool.cooldown(key.label, resp.retryAfterSeconds ?? 30); sawRateLimit = resp.retryAfterSeconds ?? 30; continue; }
      if (resp.status === 'captcha_unsolved') return { ...base, ok: false, keyLabel: key.label, creditsUsed: resp.credits, failure: 'captcha_unsolved' };
      if (resp.status !== 'ok') return { ...base, ok: false, keyLabel: key.label, creditsUsed: resp.credits, failure: resp.status };

      const wall = detectLoginOrPaywall(resp);
      if (wall) return { ...base, ok: false, keyLabel: key.label, creditsUsed: resp.credits, failure: wall }; // texto descartado
      return { ...base, ok: true, keyLabel: key.label, creditsUsed: resp.credits, finalUrl: resp.finalUrl, providerSolvedCaptcha: resp.providerSolvedCaptcha, httpStatus: resp.httpStatus, text: resp.text, html: resp.html };
    }
    if (sawRateLimit !== undefined) return { ...base, ok: false, failure: 'rate_limited', retryAfterSeconds: sawRateLimit };
    if (sawAuthFailure && this.pool.candidates(0).length === 0) return { ...base, ok: false, failure: 'auth_failed' };
    return { ...base, ok: false, failure: 'quota_exhausted' };
  }
}

/** Fábrica: DESLIGADA a menos que `enabled: true`. */
export function createReader(deps: ReaderDeps, config: ReaderConfig = {}): ReaderPort & { pool?: QuotaKeyPool; unlocks?: boolean; freeQuotaFractionPerRead?: number } {
  if (config.enabled !== true) return new DisabledReader(deps.keyed.provider);
  return new PooledReader(deps, config.pace === undefined ? DEFAULT_PACE : config.pace);
}

// ------------------------------------------------------------------------------------------------
// Só fato, fonte, link e data (DP-29)
// ------------------------------------------------------------------------------------------------

export interface PersistableFact {
  /** Fato em palavras próprias, curto. */
  fact: string;
  sourceName: string;
  sourceUrl: string;
  /** Data da leitura (ISO). */
  retrievedAt: string;
  provider?: string;
}

export const MAX_FACT_CHARS = 300;
const BODY_KEYS = /^(text|html|body|content|rawtext|markdown|excerpt_full|page)$/i;

/** Valida o que pode ser gravado. Recusa campos de corpo de página e fato maior que o limite (texto integral é reprodução). */
export function toPersistableFact(x: Record<string, unknown>): PersistableFact {
  for (const k of Object.keys(x)) if (BODY_KEYS.test(k)) throw new Error(`campo de corpo de página não pode ser persistido: ${k}`);
  const fact = x.fact, sourceName = x.sourceName, sourceUrl = x.sourceUrl, retrievedAt = x.retrievedAt;
  if (typeof fact !== 'string' || fact.trim() === '' || fact.length > MAX_FACT_CHARS) throw new Error(`fact deve ter 1 a ${MAX_FACT_CHARS} caracteres (nunca texto integral)`);
  if (typeof sourceName !== 'string' || !sourceName.trim()) throw new Error('sourceName obrigatório');
  if (typeof sourceUrl !== 'string' || !/^https?:\/\/\S+$/i.test(sourceUrl)) throw new Error('sourceUrl http(s) obrigatório');
  if (typeof retrievedAt !== 'string' || Number.isNaN(Date.parse(retrievedAt))) throw new Error('retrievedAt ISO obrigatório');
  return { fact: fact.trim(), sourceName: sourceName.trim(), sourceUrl, retrievedAt, provider: typeof x.provider === 'string' ? x.provider : undefined };
}
