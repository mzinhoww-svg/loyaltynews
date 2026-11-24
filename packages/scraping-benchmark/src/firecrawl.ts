/**
 * Firecrawl /v1/scrape no contrato `KeyedReader` do Data. 1 crédito por página (scrape básico, sem JSON/LLM).
 * Erros (docs.firecrawl.dev): 401 chave inválida; 402 sem crédito; 429 limite de taxa (plano grátis ~10/min); 408 timeout.
 * Os metadados da página (título, datas) vêm em `data.metadata`; montamos um <head> mínimo com eles para o critério editorial
 * único extrair título e data como nos outros provedores. Texto e HTML continuam efêmeros.
 */
import type { KeyedReader, ProviderResponse, ReadRequest } from '@ln/intelligence';
import { detectWall } from './quality';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export class FirecrawlReader implements KeyedReader {
  readonly provider = 'firecrawl-scrape';
  readonly creditsPerRead = 1;
  readonly unlocks = false; // proxy 'stealth' custa mais e não é usado
  readonly freeQuotaFractionPerRead = 1 / 1000; // plan_credits 1.000/mês (conta, lido pelo PM em 23/11)
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async read(req: ReadRequest, apiKey: string): Promise<ProviderResponse> {
    let r: Response;
    try {
      r = await this.fetchImpl('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ url: req.url, formats: ['markdown'], onlyMainContent: true, timeout: 60_000 }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      return { status: /abort|timeout/i.test(String(e)) ? 'timeout' : 'provider_error' };
    }
    const raw = await r.text();
    if (r.status === 401) return { status: 'auth_failed', httpStatus: 401 };
    if (r.status === 402) return { status: 'quota_exhausted', httpStatus: 402 };
    if (r.status === 429) return /credit|quota|insufficient/i.test(raw) ? { status: 'quota_exhausted', httpStatus: 429 } : { status: 'rate_limited', retryAfterSeconds: Number(r.headers.get('retry-after')) || 60, httpStatus: 429 };
    if (r.status === 408) return { status: 'timeout', httpStatus: 408 };
    if (r.status !== 200) return { status: 'provider_error', httpStatus: r.status };
    let j: { success?: boolean; data?: { markdown?: string; metadata?: Record<string, unknown> } };
    try {
      j = JSON.parse(raw);
    } catch {
      return { status: 'provider_error', httpStatus: 200 };
    }
    const md = j.data?.markdown;
    const m = j.data?.metadata ?? {};
    const page = Number(m.statusCode ?? 200) || 200;
    const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : Array.isArray(m[k]) ? String((m[k] as unknown[])[0] ?? '') : '');
    if (page === 404 || page === 410) return { status: 'not_found', credits: 1, httpStatus: page };
    if (!j.success || !md) return { status: 'provider_error', credits: 1, httpStatus: page };
    if (page >= 400 && page !== 401 && page !== 402) return { status: 'provider_error', credits: 1, httpStatus: page };
    // proteção no próprio adaptador (ressalva QA 3): login/paywall da ORIGEM nunca devolve corpo, mesmo a um consumidor sem o pool
    // qualquer sucesso (200, 201, 203…) com login/paywall no texto vira 401/402, para o pool classificar o motivo (ressalva QA 3)
    const wall = page === 401 ? 'login_required' : page === 402 ? 'paywall' : detectWall({ text: md });
    if (wall) return { status: 'ok', credits: 1, httpStatus: wall === 'login_required' ? 401 : 402 };
    const title = str('ogTitle') || str('title');
    const date = str('publishedTime') || str('article:published_time') || str('datePublished');
    const head = `<html lang="${esc(str('language'))}"><head>${title ? `<meta property="og:title" content="${esc(title)}">` : ''}${date ? `<meta property="article:published_time" content="${esc(date)}">` : ''}</head><body></body></html>`;
    return { status: 'ok', credits: 1, httpStatus: page, text: md, html: head, finalUrl: str('url') || str('sourceURL') || undefined };
  }
}
