import type { ReaderPort, ReaderResult } from './collector';
import type { Source } from '../types';

/**
 * Leitura via Tavily (DP-31) — DESLIGADA: só é usada se o worker injetar `new TavilyReader({ apiKey })` no Collector e a fonte
 * tiver `acesso: 'risco-aceito-dp31'`. A chave vem do cofre do OpenBot (TAVILY_API_KEY), nunca do código nem de log.
 *
 * O que usa (documentação oficial, docs.tavily.com, lida em 23/11/2026):
 *  - POST /extract: 1 a 20 URLs por chamada; `extract_depth` basic = 1 crédito a cada 5 extrações bem-sucedidas; extração com falha não é cobrada;
 *    falhas por URL vêm em `failed_results` (a resposta pode ser HTTP 200 com `results` vazio).
 *  - POST /search com `include_domains` para descobrir matérias novas do domínio (basic = 1 crédito por busca).
 *  - Plano gratuito (Researcher): 1.000 créditos/mês, sem cartão; limite de 100 requisições por minuto; 429 traz Retry-After.
 *  - Acesso "keyless" (cabeçalho X-Tavily-Access-Mode) existe, mas tem teto diário/mensal comum e estourou no 1º teste: não usado.
 * A documentação lida NÃO diz se o extract respeita o robots.txt dos sites; para a DP-31 isso é irrelevante (o proprietário aceitou
 * o risco), mas continua sendo um fato não verificado.
 * Pagamento por x402 ou plano pago NÃO é usado por este adaptador.
 */
export interface TavilyOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type J = Record<string, unknown>;
const isObj = (x: unknown): x is J => typeof x === 'object' && x !== null && !Array.isArray(x);

export class TavilyReader implements ReaderPort {
  readonly name = 'tavily';
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly timeout: number;
  constructor(private readonly o: TavilyOptions) {
    if (!o.apiKey) throw new Error('TavilyReader: apiKey ausente (TAVILY_API_KEY no cofre do OpenBot)');
    this.base = (o.baseUrl ?? 'https://api.tavily.com').replace(/\/$/, '');
    this.f = o.fetchImpl ?? fetch;
    this.timeout = o.timeoutMs ?? 40_000;
  }

  private async post(path: string, body: J): Promise<{ status: number; json: J | null; retryAfterSec: number | null }> {
    const res = await this.f(`${this.base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeout),
    });
    const ra = Number(res.headers.get('retry-after'));
    const json = await res.json().then((j: unknown) => (isObj(j) ? j : null), () => null);
    return { status: res.status, json, retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : null };
  }

  /** Uma URL por chamada (poucas páginas por dia: não há lote). Texto limpo; o coletor guarda só um trecho curto. */
  async read(url: string): Promise<ReaderResult> {
    const { status, json, retryAfterSec } = await this.post('/extract', { urls: [url], extract_depth: 'basic', format: 'text', include_images: false });
    if (status === 429) return { status: 429, body: '', retryAfterSec };
    if (status < 200 || status >= 300) return { status, body: '' };
    const results = Array.isArray(json?.['results']) ? (json!['results'] as unknown[]) : [];
    const hit = results.find((r): r is J => isObj(r) && typeof r['raw_content'] === 'string');
    if (!hit) return { status: 502, body: '' }; // falha por URL (failed_results): o site recusou ou não renderizou; não insistir
    return { status: 200, body: String(hit['raw_content']), format: 'text' };
  }

  /** Matérias recentes do domínio da fonte (busca com include_domains), no máximo `limit`. */
  async discover(source: Source, limit: number): Promise<Array<{ url: string; title?: string; publishedAt?: string | null }>> {
    const { status, json } = await this.post('/search', {
      query: `${source.name} notícias`, include_domains: [source.host], max_results: Math.min(Math.max(limit, 1), 10),
      topic: 'news', time_range: 'month', search_depth: 'basic', include_published_date: true, include_answer: false, include_raw_content: false,
    });
    if (status === 429) throw new Error('HTTP 429 do Tavily na busca');
    if (status < 200 || status >= 300) throw new Error(`HTTP ${status} do Tavily na busca`);
    const results = Array.isArray(json?.['results']) ? (json!['results'] as unknown[]) : [];
    const prefix = source.pathPrefix ?? '';
    return results.filter(isObj).flatMap((r) => {
      const u = typeof r['url'] === 'string' ? r['url'] : '';
      try { const p = new URL(u); if (p.host.toLowerCase() !== source.host.toLowerCase() || !p.pathname.startsWith(prefix || '/')) return []; } catch { return []; }
      const d = typeof r['published_date'] === 'string' ? new Date(r['published_date']) : null;
      return [{ url: u, ...(typeof r['title'] === 'string' ? { title: r['title'] } : {}), publishedAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null }];
    });
  }
}
