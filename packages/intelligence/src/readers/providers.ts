/**
 * Adaptadores HTTP dos provedores de leitura (DP-32): Bright Data (Web Unlocker), Apify (RAG Web Browser), Scrapfly e Zyte.
 * Cada um implementa `KeyedReader` (UMA chamada com UMA chave) e traduz a resposta do provedor para `ProviderResponse`.
 * Formatos e códigos de erro conforme a documentação oficial lida em 23/11/2026 (ver leitores-externos.md):
 *  - Bright Data: https://docs.brightdata.com/scraping-automation/web-unlocker/introduction (POST https://api.brightdata.com/request)
 *  - Apify: https://docs.apify.com/api/v2 (run-sync-get-dataset-items) e https://apify.com/apify/rag-web-browser
 *  - Scrapfly: https://scrapfly.io/docs/scrape-api/getting-started e /errors e /billing
 *  - Zyte: https://docs.zyte.com/zyte-api/usage/http.html e /errors.html
 * `fetchImpl` é injetável: os testes usam respostas simuladas. Nenhum segredo é registrado, devolvido ou colocado em mensagem de erro.
 */
import type { KeyedReader, ProviderResponse, ReadRequest } from '../reader-port';

type FetchFn = typeof fetch;
const TIMEOUT_MS = 120_000;

/** Texto legível de um HTML (para a leitura efêmera; não é "extração" de conteúdo). */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const isAbort = (e: unknown) => /abort|timeout/i.test(String((e as { name?: string })?.name ?? '') + String((e as Error)?.message ?? ''));
const failNet = (e: unknown): ProviderResponse => ({ status: isAbort(e) ? 'timeout' : 'provider_error' });
const retryAfter = (r: Response, fallback: number) => {
  const h = Number(r.headers.get('retry-after'));
  return Number.isFinite(h) && h > 0 ? h : fallback;
};
const QUOTA_WORDS = /(fund|credit|balance|quota|usage|limit(?:s)? exceeded|payment|insufficient|prepaid)/i;

/** Status da página de destino → resposta do provedor (a leitura em si funcionou). */
function pageResponse(base: { credits?: number; httpStatus: number; html?: string; text?: string; finalUrl?: string }): ProviderResponse {
  if (base.httpStatus === 404 || base.httpStatus === 410) return { status: 'not_found', credits: base.credits, httpStatus: base.httpStatus };
  if (base.httpStatus === 401 || base.httpStatus === 402) return { status: 'ok', ...base }; // login/paywall: quem decide é detectLoginOrPaywall
  if (base.httpStatus >= 400) return { status: 'provider_error', credits: base.credits, httpStatus: base.httpStatus }; // o provedor não conseguiu a página
  return { status: 'ok', ...base };
}

// ------------------------------------------------------------------------------------------------
// Bright Data — Web Unlocker API
// ------------------------------------------------------------------------------------------------
export class BrightDataUnlockerReader implements KeyedReader {
  readonly provider = 'brightdata-unlocker';
  readonly creditsPerRead = 1; // "1 crédito por requisição" (free tier: 5.000/mês)
  readonly unlocks = true;
  readonly freeQuotaFractionPerRead = 1 / 5000;

  constructor(
    private readonly zone: string,
    private readonly fetchImpl: FetchFn = fetch,
  ) {}

  async read(req: ReadRequest, apiKey: string): Promise<ProviderResponse> {
    let r: Response;
    try {
      r = await this.fetchImpl('https://api.brightdata.com/request', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ zone: this.zone, url: req.url, format: 'raw' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return failNet(e);
    }
    const body = await r.text();
    if (r.status === 401) return { status: 'auth_failed', httpStatus: 401 };
    if (r.status === 402 || (r.status === 403 && QUOTA_WORDS.test(body))) return { status: 'quota_exhausted', httpStatus: r.status };
    if (r.status === 429) return { status: 'rate_limited', retryAfterSeconds: retryAfter(r, 30), httpStatus: 429 };
    if (r.status !== 200) return { status: 'provider_error', httpStatus: r.status }; // inclui 400 'zone ... not found' (configuração)
    // HTTP 200 externo: "erro do unlocker/alvo" vem nos cabeçalhos x-brd-error*; sem eles a resposta é do site de destino
    const brdError = r.headers.get('x-brd-error') ?? r.headers.get('x-brd-error-code');
    const target = Number(r.headers.get('x-brd-status-code') ?? 200) || 200;
    if (brdError) return target === 404 ? { status: 'not_found', httpStatus: 404 } : { status: 'provider_error', httpStatus: target };
    return pageResponse({ credits: 1, httpStatus: target, html: body, text: stripHtml(body) });
  }
}

// ------------------------------------------------------------------------------------------------
// Apify — Actor oficial "RAG Web Browser" (uma URL → markdown)
// ------------------------------------------------------------------------------------------------
export class ApifyRagBrowserReader implements KeyedReader {
  readonly provider = 'apify-rag-web-browser';
  /** Unidade de crédito = US$ 0,001. A página lista "from $1.33 / 1,000 fetched pages", mas o teste real (23/11) mediu US$ 0,0018 a 0,0041 por leitura (usageTotalUsd) ⇒ teto conservador de 5. */
  readonly creditsPerRead = 5;
  readonly unlocks = false; // a documentação lida não descreve desbloqueio/CAPTCHA
  readonly freeQuotaFractionPerRead = 4 / 5000; // plano Free: US$ 5/mês; custo típico medido ≈ US$ 0,003 por página

  constructor(private readonly fetchImpl: FetchFn = fetch) {}

  async read(req: ReadRequest, apiKey: string): Promise<ProviderResponse> {
    let r: Response;
    try {
      r = await this.fetchImpl('https://api.apify.com/v2/actors/apify~rag-web-browser/run-sync-get-dataset-items?timeout=120', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: req.url }), // com URL em `query`, maxResults é ignorado (só essa página)
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return failNet(e);
    }
    const body = await r.text();
    if (r.status === 401) return { status: 'auth_failed', httpStatus: 401 };
    if (r.status === 402) return { status: 'quota_exhausted', httpStatus: 402 };
    if (r.status === 403 && /(not-enough-usage|usage|credit|platform-feature-disabled|limit)/i.test(body)) return { status: 'quota_exhausted', httpStatus: 403 };
    if (r.status === 429) return { status: 'rate_limited', retryAfterSeconds: retryAfter(r, 5), httpStatus: 429 };
    if (r.status === 408) return { status: 'timeout', httpStatus: 408 };
    if (r.status !== 200 && r.status !== 201) return { status: 'provider_error', httpStatus: r.status };
    let items: unknown;
    try { items = JSON.parse(body); } catch { return { status: 'provider_error', httpStatus: r.status }; }
    const first = Array.isArray(items) ? (items[0] as { markdown?: string; text?: string; metadata?: { url?: string; httpStatusCode?: number }; crawl?: { httpStatusCode?: number } } | undefined) : undefined;
    const md = first?.markdown ?? first?.text;
    if (!md) return { status: 'provider_error', httpStatus: r.status };
    const page = first?.crawl?.httpStatusCode ?? first?.metadata?.httpStatusCode ?? 200;
    return pageResponse({ credits: 4, httpStatus: page, text: md, finalUrl: first?.metadata?.url });
  }
}

// ------------------------------------------------------------------------------------------------
// Scrapfly — Scrape API (basic = datacenter; asp = Unblocker; asp_js = Unblocker + JavaScript)
// ------------------------------------------------------------------------------------------------
export type ScrapflyMode = 'basic' | 'asp' | 'asp_js';
export class ScrapflyReader implements KeyedReader {
  readonly provider: string;
  readonly creditsPerRead: number;
  readonly unlocks: boolean;
  readonly freeQuotaFractionPerRead: number;

  constructor(
    private readonly mode: ScrapflyMode = 'basic',
    private readonly fetchImpl: FetchFn = fetch,
  ) {
    this.provider = `scrapfly-${mode}`;
    // custo documentado: datacenter 1; render_js +5; o Unblocker (asp) é dinâmico e "pode afetar o custo final": teto conservador de 30/35
    this.creditsPerRead = mode === 'basic' ? 1 : mode === 'asp' ? 30 : 35;
    this.unlocks = mode !== 'basic';
    this.freeQuotaFractionPerRead = this.creditsPerRead / 1000; // plano Free: 1.000 créditos/mês
  }

  async read(req: ReadRequest, apiKey: string): Promise<ProviderResponse> {
    const q = new URLSearchParams({ key: apiKey, url: req.url });
    if (this.mode !== 'basic') q.set('asp', 'true');
    if (this.mode === 'asp_js') q.set('render_js', 'true');
    let r: Response;
    try {
      r = await this.fetchImpl(`https://api.scrapfly.io/scrape?${q.toString()}`, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      return failNet(e);
    }
    const raw = await r.text();
    let j: { result?: { content?: string; status_code?: number; error?: { code?: string }; success?: boolean }; context?: { cost?: { total?: number } | number }; code?: string } = {};
    try { j = JSON.parse(raw); } catch { /* corpo não JSON */ }
    const code = j.result?.error?.code ?? j.code ?? r.headers.get('x-scrapfly-reject-code') ?? '';
    const costHeader = Number(r.headers.get('x-scrapfly-api-cost'));
    const credits = Number.isFinite(costHeader) && costHeader > 0 ? costHeader : typeof j.context?.cost === 'number' ? j.context.cost : j.context?.cost?.total;

    if (r.status === 401) return { status: 'auth_failed', httpStatus: 401 };
    if (r.status === 429) {
      if (/QUOTA_LIMIT_REACHED|BALANCE_REQUIRED_FOR_EXTRA|PROJECT_QUOTA_LIMIT_REACHED|ACCOUNT::/i.test(code)) return { status: 'quota_exhausted', httpStatus: 429 };
      return { status: 'rate_limited', retryAfterSeconds: retryAfter(r, 10), httpStatus: 429 };
    }
    if (r.status === 402) return { status: 'quota_exhausted', httpStatus: 402 };
    if (/CAPTCHA/i.test(code)) return { status: 'captcha_unsolved', credits, httpStatus: r.status };
    if (r.status === 504 || /OPERATION_TIMEOUT|UPSTREAM_TIMEOUT/i.test(code)) return { status: 'timeout', credits, httpStatus: r.status };
    if (r.status !== 200) return { status: 'provider_error', credits, httpStatus: r.status }; // 422 falha do site de destino etc.
    const content = j.result?.content;
    if (typeof content !== 'string') return { status: 'provider_error', credits, httpStatus: r.status };
    return pageResponse({ credits, httpStatus: j.result?.status_code ?? 200, html: content, text: stripHtml(content) });
  }
}

// ------------------------------------------------------------------------------------------------
// Zyte — Zyte API /v1/extract (http = httpResponseBody; browser = browserHtml)
// ------------------------------------------------------------------------------------------------
export type ZyteMode = 'http' | 'browser';
export class ZyteReader implements KeyedReader {
  readonly provider: string;
  /** Unidade de crédito = US$ 0,0001; teto conservador por leitura: HTTP nível 5 US$ 1,27/1k ≈ 13; navegador nível 5 US$ 16,08/1k ≈ 161. */
  readonly creditsPerRead: number;
  readonly unlocks = true; // a Zyte trata bloqueio do site-alvo (520 = "ban")
  readonly freeQuotaFractionPerRead: number;

  constructor(
    private readonly mode: ZyteMode = 'http',
    private readonly fetchImpl: FetchFn = fetch,
  ) {
    this.provider = `zyte-${mode}`;
    this.creditsPerRead = mode === 'http' ? 13 : 161;
    this.freeQuotaFractionPerRead = (mode === 'http' ? 1.3 : 10) / 50_000; // crédito grátis: US$ 5 no primeiro mês (50.000 unidades)
  }

  async read(req: ReadRequest, apiKey: string): Promise<ProviderResponse> {
    const body = this.mode === 'http' ? { url: req.url, httpResponseBody: true } : { url: req.url, browserHtml: true };
    let r: Response;
    try {
      r = await this.fetchImpl('https://api.zyte.com/v1/extract', {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return failNet(e);
    }
    const raw = await r.text();
    let j: { type?: string; statusCode?: number; url?: string; httpResponseBody?: string; browserHtml?: string } = {};
    try { j = JSON.parse(raw); } catch { /* corpo não JSON */ }
    const type = j.type ?? '';
    if (r.status === 401) return { status: 'auth_failed', httpStatus: 401 };
    if (r.status === 403) return type === '/auth/account-suspended' ? { status: 'quota_exhausted', httpStatus: 403 } : { status: 'provider_error', httpStatus: 403 };
    if (r.status === 429) return { status: 'rate_limited', retryAfterSeconds: retryAfter(r, 20), httpStatus: 429 }; // user/domain/org-domain limit: gratuito
    if (r.status === 503) return { status: 'rate_limited', retryAfterSeconds: retryAfter(r, 30), httpStatus: 503 };
    if (r.status === 520 || r.status === 521) return { status: 'provider_error', httpStatus: r.status }; // ban do site-alvo / erro permanente: não cobrado
    if (r.status !== 200) return { status: 'provider_error', httpStatus: r.status };
    const html = this.mode === 'http' ? (j.httpResponseBody ? Buffer.from(j.httpResponseBody, 'base64').toString('utf8') : undefined) : j.browserHtml;
    if (typeof html !== 'string') return { status: 'provider_error', httpStatus: 200 };
    const credits = this.mode === 'http' ? 2 : 10; // estimativa típica (a resposta não informa o custo); tabela por nível em leitores-externos.md
    return pageResponse({ credits, httpStatus: j.statusCode ?? 200, html, text: stripHtml(html), finalUrl: j.url });
  }
}
