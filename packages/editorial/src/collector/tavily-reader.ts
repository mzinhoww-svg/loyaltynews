import type { ReaderPort, ReaderResult } from './collector';
import type { Source } from '../types';

/**
 * Leitura via Tavily (DP-31) — DESLIGADA: só é usada se o worker injetar `new TavilyReader({ apiKey })` no Collector e a fonte
 * tiver `acesso: 'via-provedor'`. A chave vem do cofre do OpenBot (TAVILY_API_KEY), nunca do código nem de log.
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
  /** Uma chave. Para várias (ordem de uso), `apiKeys`. */
  apiKey?: string;
  /** Chaves em ordem: usa a 1ª até a COTA do serviço esgotar (HTTP 432/433 ou 429 de crédito/cota) e passa para a próxima. Nunca impressas. */
  apiKeys?: string[];
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type J = Record<string, unknown>;
const isObj = (x: unknown): x is J => typeof x === 'object' && x !== null && !Array.isArray(x);

/** LN_TAVILY_API_KEYS (lista separada por vírgula, em ordem) ou LN_TAVILY_API_KEY. Valores nunca são registrados. */
export function parseTavilyKeys(env: { LN_TAVILY_API_KEYS?: string | undefined; LN_TAVILY_API_KEY?: string | undefined }): string[] {
  const raw = env.LN_TAVILY_API_KEYS ?? env.LN_TAVILY_API_KEY ?? '';
  return [...new Set(raw.split(',').map((k) => k.trim()).filter(Boolean))];
}

/** 432/433 = limite do plano/PAYG (documentação); 429 só conta como cota quando o corpo fala de crédito/cota/limite de uso, não de ritmo. */
const QUOTA_BODY = /(credit|cr[ée]dito|quota|cota|usage limit|plan'?s? (set )?(usage )?limit|monthly|mensal)/i;
const RATE_BODY = /(excessive requests|too many requests|rate limit|reduce the rate)/i;
const isQuota = (status: number, json: J | null): boolean => {
  if (status === 432 || status === 433) return true;
  if (status !== 429) return false;
  const text = JSON.stringify(json ?? {});
  return QUOTA_BODY.test(text) && !RATE_BODY.test(text);
};

export class TavilyReader implements ReaderPort {
  readonly name = 'tavily';
  /** Tavily não promete resolver CAPTCHA; outros provedores (Bright Data Web Unlocker etc.) podem declarar unlocks. */
  readonly unlocks = false;
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly timeout: number;
  private readonly keys: string[];
  /** Índice da chave em uso; só avança (cota esgotada não volta durante a execução). */
  private idx = 0;
  private invalid = 0;
  constructor(private readonly o: TavilyOptions) {
    this.keys = [...new Set([...(o.apiKeys ?? []), ...(o.apiKey ? [o.apiKey] : [])].map((k) => k.trim()).filter(Boolean))];
    if (!this.keys.length) throw new Error('TavilyReader: nenhuma chave (LN_TAVILY_API_KEYS / TAVILY_API_KEY no cofre do OpenBot)');
    this.base = (o.baseUrl ?? 'https://api.tavily.com').replace(/\/$/, '');
    this.f = o.fetchImpl ?? fetch;
    this.timeout = o.timeoutMs ?? 40_000;
  }

  /** Quantas chaves ainda não tiveram a cota esgotada nem foram rejeitadas (sem expor valores). */
  get keysLeft(): number { return Math.max(this.keys.length - this.idx, 0); }
  /** Quantas chaves foram recusadas com 401 (inválidas): a configuração precisa de correção. */
  get keysRejected(): number { return this.invalid; }

  private async post(path: string, body: J): Promise<{ status: number; json: J | null; retryAfterSec: number | null; quotaExhausted: boolean }> {
    // A troca de chave vale SÓ para a cota do serviço: a chamada recusada por cota não foi atendida (não gastou crédito) e é refeita
    // com a próxima chave. 429 por ritmo do serviço NÃO troca de chave (devolve 429 e a coleta para).
    for (;;) {
      const key = this.keys[this.idx];
      if (key === undefined) return { status: this.invalid >= this.keys.length ? 401 : 432, json: null, retryAfterSec: null, quotaExhausted: this.invalid < this.keys.length };
      const res = await this.f(`${this.base}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeout),
      });
      const ra = Number(res.headers.get('retry-after'));
      const json = await res.json().then((j: unknown) => (isObj(j) ? j : null), () => null);
      // cota do serviço esgotada, ou chave rejeitada (401: chave inválida/revogada): passa para a próxima; só avança, nunca volta
      if (isQuota(res.status, json) || res.status === 401) { if (res.status === 401) this.invalid++; this.idx++; continue; }
      return { status: res.status, json, retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : null, quotaExhausted: false };
    }
  }

  /** Uma URL por chamada (poucas páginas por dia: não há lote). Texto limpo; o coletor guarda só um trecho curto. */
  async read(url: string): Promise<ReaderResult> {
    const { status, json, retryAfterSec, quotaExhausted } = await this.post('/extract', { urls: [url], extract_depth: 'basic', format: 'text', include_images: false });
    if (quotaExhausted) return { status: 432, body: '', quotaExhausted: true };
    if (status === 429) return { status: 429, body: '', retryAfterSec };
    if (status < 200 || status >= 300) return { status, body: '' };
    const results = Array.isArray(json?.['results']) ? (json!['results'] as unknown[]) : [];
    const hit = results.find((r): r is J => isObj(r) && typeof r['raw_content'] === 'string');
    if (!hit) return { status: 502, body: '', failedUrl: true }; // falha por URL (failed_results): o site recusou ou não renderizou; a coleta da fonte para, sem repetir
    return { status: 200, body: String(hit['raw_content']), format: 'text' };
  }

  /** Matérias recentes do domínio da fonte (busca com include_domains), no máximo `limit`. */
  async discover(source: Source, limit: number): Promise<Array<{ url: string; title?: string; publishedAt?: string | null }>> {
    const { status, json, quotaExhausted } = await this.post('/search', {
      query: `${source.name} notícias`, include_domains: [source.host], max_results: Math.min(Math.max(limit, 1), 10),
      topic: 'general', time_range: 'month', search_depth: 'basic', include_published_date: true, include_answer: false, include_raw_content: false,
    });
    if (quotaExhausted) throw new Error('cota do serviço esgotada em todas as chaves (Tavily)');
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
