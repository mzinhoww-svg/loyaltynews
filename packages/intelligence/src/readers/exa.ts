/**
 * Exa (https://docs.exa.ai/reference/search, /get-contents, /errors, /rate-limits; lidas em 23/11/2026) como provedor de
 * DESCOBERTA (busca restrita ao domínio da fonte, devolve só links, título e data) e de leitura de conteúdo já indexado.
 * Plano gratuito: US$ 10/mês (renova) + US$ 10 únicos. Nunca comprar: o teto local por chave é o crédito gratuito mensal.
 * Unidade de crédito do pool = US$ 0,001: busca `lite` ≈ 4 (US$ 4/1k), busca `auto` ≈ 7, conteúdo ≈ 1 por página e por tipo de conteúdo.
 * O Exa NÃO desbloqueia páginas: devolve o que o próprio índice/rastreador conseguiu (por isso serve à descoberta, não à leitura de sites que bloqueiam).
 */
import { QuotaKeyPool, type Clock, type KeyConfig, type KeyedReader, type ProviderResponse, type ReadRequest } from '../reader-port';

type FetchFn = typeof fetch;
const TIMEOUT_MS = 60_000;
const retryAfter = (r: Response, fallback: number) => {
  const h = Number(r.headers.get('retry-after'));
  return Number.isFinite(h) && h > 0 ? h : fallback;
};
const isAbort = (e: unknown) => /abort|timeout/i.test(String((e as { name?: string })?.name ?? '') + String((e as Error)?.message ?? ''));

/** Leitura de conteúdo de UMA URL pelo endpoint /contents (texto já indexado/rastreado pelo Exa). */
export class ExaContentsReader implements KeyedReader {
  readonly provider = 'exa-contents';
  readonly creditsPerRead = 1; // US$ 1 por 1.000 páginas, por tipo de conteúdo (só `text`)
  readonly unlocks = false;
  readonly freeQuotaFractionPerRead = 1 / 10_000; // US$ 0,001 de US$ 10 mensais

  constructor(private readonly fetchImpl: FetchFn = fetch) {}

  async read(req: ReadRequest, apiKey: string): Promise<ProviderResponse> {
    let r: Response;
    try {
      r = await this.fetchImpl('https://api.exa.ai/contents', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ urls: [req.url], text: true }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return { status: isAbort(e) ? 'timeout' : 'provider_error' };
    }
    const raw = await r.text();
    if (r.status === 401) return { status: 'auth_failed', httpStatus: 401 };
    if (r.status === 402) return { status: 'quota_exhausted', httpStatus: 402 };
    if (r.status === 429 || r.status === 503) return { status: 'rate_limited', retryAfterSeconds: retryAfter(r, r.status === 503 ? 30 : 5), httpStatus: r.status };
    if (r.status !== 200) return { status: 'provider_error', httpStatus: r.status };
    let j: { results?: { url?: string; text?: string }[]; statuses?: { status?: string; error?: { tag?: string; httpStatusCode?: number } }[]; costDollars?: { total?: number } };
    try { j = JSON.parse(raw); } catch { return { status: 'provider_error', httpStatus: 200 }; }
    const st = j.statuses?.[0];
    const credits = typeof j.costDollars?.total === 'number' ? Math.max(1, Math.round(j.costDollars.total * 1000)) : 1;
    if (st?.status === 'error') return st.error?.tag === 'CRAWL_NOT_FOUND' || st.error?.httpStatusCode === 404 ? { status: 'not_found', credits, httpStatus: 404 } : { status: 'provider_error', credits, httpStatus: st.error?.httpStatusCode };
    const t = j.results?.[0]?.text;
    if (!t) return { status: 'provider_error', credits, httpStatus: 200 };
    return { status: 'ok', credits, httpStatus: 200, text: t, finalUrl: j.results?.[0]?.url };
  }
}

export interface DiscoveredLink {
  url: string;
  title?: string;
  publishedAt?: string | null;
}

export interface DiscoverArgs {
  /** Domínio da fonte (ex.: "ri.exemplo.com.br"). */
  host: string;
  limit: number;
  /** Consulta semântica; padrão genérico de notícias/comunicados. */
  query?: string;
  /** ISO 8601: só matérias publicadas a partir daqui. */
  since?: string;
}

export interface ExaDiscoveryDeps {
  keys: KeyConfig[];
  resolveSecret: (secretRef: string) => string | undefined;
  clock?: Clock;
  fetchImpl?: FetchFn;
  /** `lite` (≈ US$ 0,004) é o padrão; `auto` custa ≈ US$ 0,007. */
  searchType?: 'lite' | 'auto';
}

/** Descoberta por busca restrita ao domínio. Só devolve link, título e data (nunca texto). Falha com a mensagem que o ChainedReader do Editorial reconhece. */
export class ExaDiscoverer {
  readonly provider = 'exa-search';
  readonly pool: QuotaKeyPool;
  private readonly fetchImpl: FetchFn;
  private readonly cost: number;

  constructor(private readonly deps: ExaDiscoveryDeps) {
    const clock = deps.clock ?? { now: () => new Date() };
    this.pool = new QuotaKeyPool(deps.keys, clock);
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.cost = deps.searchType === 'auto' ? 7 : 4;
  }

  async discover(args: DiscoverArgs): Promise<DiscoveredLink[]> {
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 20);
    const body: Record<string, unknown> = {
      query: args.query ?? `notícias comunicados e matérias recentes de ${args.host}`,
      numResults: limit,
      type: this.deps.searchType ?? 'lite',
      includeDomains: [args.host],
      ...(args.since ? { startPublishedDate: args.since } : {}),
    };
    let rateLimited: number | undefined;
    for (const key of this.pool.candidates(this.cost)) {
      const secret = this.deps.resolveSecret(key.secretRef);
      if (!secret) continue;
      let r: Response;
      try {
        r = await this.fetchImpl('https://api.exa.ai/search', { method: 'POST', headers: { 'x-api-key': secret, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        throw new Error(isAbort(e) ? 'exa: tempo esgotado' : 'exa: falha de rede', { cause: e });
      }
      const raw = await r.text();
      if (r.status === 401) { this.pool.markInvalid(key.label); continue; }
      if (r.status === 402) { this.pool.markExhausted(key.label); continue; }
      if (r.status === 429 || r.status === 503) { const s = retryAfter(r, r.status === 503 ? 30 : 5); this.pool.cooldown(key.label, s); rateLimited = s; continue; }
      if (r.status !== 200) throw new Error(`exa: HTTP ${r.status}`);
      let j: { results?: { url?: string; title?: string; publishedDate?: string | null }[]; costDollars?: { total?: number } };
      try { j = JSON.parse(raw); } catch (e) { throw new Error('exa: resposta inválida', { cause: e }); }
      this.pool.charge(key.label, typeof j.costDollars?.total === 'number' ? Math.max(1, Math.round(j.costDollars.total * 1000)) : this.cost);
      const seen = new Set<string>();
      const out: DiscoveredLink[] = [];
      for (const it of j.results ?? []) {
        if (typeof it.url !== 'string' || !/^https?:\/\/\S+$/i.test(it.url) || seen.has(it.url)) continue;
        let h: string;
        try { h = new URL(it.url).hostname.toLowerCase(); } catch { continue; }
        if (h !== args.host.toLowerCase() && !h.endsWith(`.${args.host.toLowerCase()}`)) continue; // só o domínio da fonte
        seen.add(it.url);
        out.push({ url: it.url, title: typeof it.title === 'string' ? it.title.slice(0, 300) : undefined, publishedAt: it.publishedDate ?? null });
      }
      return out.slice(0, limit);
    }
    if (rateLimited !== undefined) throw new Error(`exa: limite de taxa, tente de novo em ${rateLimited}s`);
    throw new Error('cota do serviço esgotada (exa)');
  }
}
