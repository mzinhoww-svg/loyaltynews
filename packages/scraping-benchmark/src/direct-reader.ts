/**
 * Leitor direto (sem provedor): linha de base gratuita do benchmark e primeiro degrau do roteador.
 * Guardas (Diretiva V3 §14): só http/https; bloqueia IP privado/loopback/link-local/metadados (SSRF), inclusive após redirect;
 * no máximo 5 redirects; timeout; teto de tamanho do corpo; UA identificado.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ReaderPort, ReadRequest, ReadResult } from '@ln/intelligence';
import { stripHtml } from '@ln/intelligence';

export const BENCH_UA = 'LoyaltyNewsBenchmark/0.1 (+pesquisa de ingestao; ritmo baixo)';
const MAX_BYTES = 3_000_000;

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (h) => (await lookup(h, { all: true })).map((a) => a.address);

/** Recusa URL que não seja http(s) público. Devolve o motivo ou null. */
export async function ssrfCheck(url: string, resolve: Resolver = defaultResolver): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'url_invalida';
  }
  if (!/^https?:$/.test(u.protocol)) return 'protocolo';
  if (u.username || u.password) return 'credencial_na_url';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|metadata\.google\.internal)$/i.test(host) || host.endsWith('.local') || host.endsWith('.internal')) return 'host_interno';
  const ips = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!ips.length) return 'dns';
  if (ips.some(isPrivateAddress)) return 'ip_privado';
  return null;
}

export class DirectReader implements ReaderPort {
  readonly provider = 'direct';
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly resolve: Resolver = defaultResolver,
    private readonly timeoutMs = 30_000,
  ) {}

  async read(req: ReadRequest): Promise<ReadResult & { ssrf?: string }> {
    const base = { url: req.url, provider: this.provider, creditsUsed: 0 };
    let url = req.url;
    for (let hop = 0; hop <= 5; hop++) {
      const bad = await ssrfCheck(url, this.resolve);
      if (bad) return { ...base, ok: false, failure: 'provider_error', ssrf: bad };
      let r: Response;
      try {
        r = await this.fetchImpl(url, { redirect: 'manual', headers: { 'user-agent': BENCH_UA, accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        return { ...base, ok: false, failure: /abort|timeout/i.test(String(e)) ? 'timeout' : 'provider_error' };
      }
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        url = new URL(r.headers.get('location')!, url).toString();
        continue;
      }
      const buf = await r.arrayBuffer();
      const html = new TextDecoder('utf-8').decode(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf);
      if (r.status === 429) return { ...base, ok: false, httpStatus: 429, failure: 'rate_limited', retryAfterSeconds: Number(r.headers.get('retry-after')) || 60 };
      if (r.status === 404 || r.status === 410) return { ...base, ok: false, httpStatus: r.status, failure: 'not_found' };
      if (r.status === 401) return { ...base, ok: false, httpStatus: 401, failure: 'login_required' };
      if (r.status === 402) return { ...base, ok: false, httpStatus: 402, failure: 'paywall' };
      if (r.status >= 400) return { ...base, ok: false, httpStatus: r.status, failure: 'provider_error' };
      return { ...base, ok: true, httpStatus: r.status, finalUrl: url, html, text: stripHtml(html) };
    }
    return { ...base, ok: false, failure: 'provider_error', ssrf: 'redirects_demais' };
  }
}
