/**
 * Leitor direto (sem provedor): linha de base gratuita do benchmark e primeiro degrau do roteador.
 * Guardas (Diretiva V3 §14): só http/https; bloqueia IP privado/loopback/link-local/metadados (SSRF), inclusive após redirect;
 * no máximo 5 redirects; timeout; teto de tamanho do corpo; UA identificado.
 * DNS rebinding (ressalva QA 3, M1): o nome é resolvido UMA vez por salto, o IP resolvido é validado e a conexão é feita
 * NESSE IP (lookup fixado), mantendo o nome do host para TLS (SNI e certificado) e para o cabeçalho Host.
 */
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
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

export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}
/** Faz UMA requisição conectando no IP `pinnedIp` já validado (sem nova resolução de DNS). */
export type Transport = (url: string, pinnedIp: string, timeoutMs: number) => Promise<TransportResponse>;

export const pinnedTransport: Transport = (url, pinnedIp, timeoutMs) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const family = isIP(pinnedIp) === 6 ? 6 : 4;
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(
      u,
      {
        method: 'GET',
        headers: { 'user-agent': BENCH_UA, accept: 'text/html,application/xhtml+xml', 'accept-encoding': 'identity' },
        servername: isIP(u.hostname) ? undefined : u.hostname,
        // lookup fixado: o socket conecta no IP validado, nunca numa segunda resposta do DNS
        lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opts?.all ? cb(null, [{ address: pinnedIp, family }]) : cb(null, pinnedIp, family)) as unknown as LookupFunction,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= MAX_BYTES) chunks.push(c);
          else res.destroy();
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')])), body: Buffer.concat(chunks) }));
        res.on('close', () => resolve({ status: res.statusCode ?? 0, headers: {}, body: Buffer.concat(chunks) }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });

export interface SsrfDecision {
  reason: string | null;
  ip?: string;
}

/** Valida a URL e devolve o IP resolvido (o único em que se pode conectar). `reason` != null = recusada. */
export async function ssrfResolve(url: string, resolve: Resolver = defaultResolver): Promise<SsrfDecision> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { reason: 'url_invalida' };
  }
  if (!/^https?:$/.test(u.protocol)) return { reason: 'protocolo' };
  if (u.username || u.password) return { reason: 'credencial_na_url' };
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|metadata\.google\.internal)$/i.test(host) || host.endsWith('.local') || host.endsWith('.internal')) return { reason: 'host_interno' };
  const ips = isIP(host) ? [host] : await resolve(host).catch(() => [] as string[]);
  if (!ips.length) return { reason: 'dns' };
  if (ips.some(isPrivateAddress)) return { reason: 'ip_privado' };
  return { reason: null, ip: ips[0] };
}

/** Compatível com o M1: só o motivo. */
export async function ssrfCheck(url: string, resolve: Resolver = defaultResolver): Promise<string | null> {
  return (await ssrfResolve(url, resolve)).reason;
}

export class DirectReader implements ReaderPort {
  readonly provider = 'direct';
  constructor(
    private readonly transport: Transport = pinnedTransport,
    private readonly resolve: Resolver = defaultResolver,
    private readonly timeoutMs = 30_000,
  ) {}

  async read(req: ReadRequest): Promise<ReadResult & { ssrf?: string }> {
    const base = { url: req.url, provider: this.provider, creditsUsed: 0 };
    let url = req.url;
    for (let hop = 0; hop <= 5; hop++) {
      const d = await ssrfResolve(url, this.resolve); // uma resolução por salto, validada
      if (d.reason || !d.ip) return { ...base, ok: false, failure: 'provider_error', ssrf: d.reason ?? 'dns' };
      let r: TransportResponse;
      try {
        r = await this.transport(url, d.ip, this.timeoutMs);
      } catch (e) {
        return { ...base, ok: false, failure: /abort|timeout/i.test(String(e)) ? 'timeout' : 'provider_error' };
      }
      if (r.status >= 300 && r.status < 400 && r.headers.location) {
        url = new URL(r.headers.location, url).toString();
        continue;
      }
      const html = new TextDecoder('utf-8').decode(r.body);
      if (r.status === 429) return { ...base, ok: false, httpStatus: 429, failure: 'rate_limited', retryAfterSeconds: Number(r.headers['retry-after']) || 60 };
      if (r.status === 404 || r.status === 410) return { ...base, ok: false, httpStatus: r.status, failure: 'not_found' };
      if (r.status === 401) return { ...base, ok: false, httpStatus: 401, failure: 'login_required' };
      if (r.status === 402) return { ...base, ok: false, httpStatus: 402, failure: 'paywall' };
      if (r.status >= 400) return { ...base, ok: false, httpStatus: r.status, failure: 'provider_error' };
      return { ...base, ok: true, httpStatus: r.status, finalUrl: url, html, text: stripHtml(html) };
    }
    return { ...base, ok: false, failure: 'provider_error', ssrf: 'redirects_demais' };
  }
}