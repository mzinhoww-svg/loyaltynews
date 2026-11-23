/**
 * Tavily /extract no contrato `KeyedReader` do Data (o TavilyReader do Editorial usa o ReaderPort do coletor, outra interface).
 * Doc oficial (docs.tavily.com, lida pelo Editorial em 23/11/2026): basic = 1 crédito a cada 5 extrações bem-sucedidas; falha não cobra;
 * plano Researcher 1.000 créditos/mês; 432/433 = limite do plano; 429 = ritmo (ou cota, se o corpo falar de crédito).
 */
import type { KeyedReader, ProviderResponse, ReadRequest } from '@ln/intelligence';

export class TavilyExtractReader implements KeyedReader {
  readonly provider = 'tavily-extract';
  readonly creditsPerRead = 1; // pior caso arredondado (0,2 por extração bem-sucedida)
  readonly unlocks = false;
  readonly freeQuotaFractionPerRead = 0.2 / 1000;
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async read(req: ReadRequest, apiKey: string): Promise<ProviderResponse> {
    let r: Response;
    try {
      r = await this.fetchImpl('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ urls: [req.url], extract_depth: 'basic', include_images: false }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (e) {
      return { status: /abort|timeout/i.test(String(e)) ? 'timeout' : 'provider_error' };
    }
    const raw = await r.text();
    if (r.status === 401) return { status: 'auth_failed', httpStatus: 401 };
    if (r.status === 432 || r.status === 433 || r.status === 402) return { status: 'quota_exhausted', httpStatus: r.status };
    if (r.status === 429) return /credit|quota|usage limit/i.test(raw) ? { status: 'quota_exhausted', httpStatus: 429 } : { status: 'rate_limited', retryAfterSeconds: Number(r.headers.get('retry-after')) || 60, httpStatus: 429 };
    if (r.status !== 200) return { status: 'provider_error', httpStatus: r.status };
    let j: { results?: Array<{ url?: string; raw_content?: string }>; failed_results?: unknown[] } = {};
    try {
      j = JSON.parse(raw);
    } catch {
      return { status: 'provider_error', httpStatus: 200 };
    }
    const first = j.results?.[0];
    if (!first?.raw_content) return { status: 'provider_error', httpStatus: 200 }; // falhou para esta URL (não cobrado)
    return { status: 'ok', credits: 0.2, httpStatus: 200, text: first.raw_content, finalUrl: first.url };
  }
}
