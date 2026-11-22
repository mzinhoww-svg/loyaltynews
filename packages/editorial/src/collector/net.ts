import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { UrlRejected } from './ssrf';

/**
 * Proteção anti-SSRF no destino EFETIVO da conexão (anti DNS rebinding):
 * 1) resolve o host; 2) exige que TODOS os IPs resolvidos sejam públicos; 3) o coletor entrega ao Fetcher o IP
 * validado e o Fetcher conecta nesse IP (sem nova resolução); 4) repete a cada redirecionamento.
 */

export type Family = 4 | 6;
export interface ResolvedAddress { address: string; family: Family }

/** Porta de resolução DNS. Em produção: systemResolver; em testes: resolvedor falso. */
export interface Resolver { resolve(host: string): Promise<ResolvedAddress[]> }

export const systemResolver: Resolver = {
  async resolve(host) {
    const r = await dnsLookup(host, { all: true, verbatim: true });
    return r.map((x) => ({ address: x.address, family: x.family === 6 ? 6 : 4 }));
  },
};

function v4Octets(ip: string): [number, number, number, number] | null {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  const n = p.map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  if (n.some((x) => Number.isNaN(x) || x > 255)) return null;
  return n as [number, number, number, number];
}

function v4Public(o: [number, number, number, number]): boolean {
  const [a, b, c] = o;
  if (a === 0 || a === 10 || a === 127) return false;                    // "esta rede", privada, loopback
  if (a === 100 && b >= 64 && b <= 127) return false;                    // CGNAT
  if (a === 169 && b === 254) return false;                              // link-local, inclui 169.254.169.254 (metadata)
  if (a === 172 && b >= 16 && b <= 31) return false;                     // privada
  if (a === 192 && b === 168) return false;                              // privada
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;       // IETF/TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return false;                // benchmark
  if (a === 198 && b === 51 && c === 100) return false;                 // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return false;                  // TEST-NET-3
  if (a >= 224) return false;                                            // multicast, reservado, broadcast
  return true;
}

/** Expande IPv6 em 8 grupos de 16 bits (aceita '::' e sufixo IPv4). null se inválido. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const dot = s.lastIndexOf('.');
  if (dot >= 0) {
    const colon = s.lastIndexOf(':');
    const o = v4Octets(s.slice(colon + 1));
    if (!o) return null;
    s = `${s.slice(0, colon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (all.length !== 8) return null;
  const g = all.map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN));
  return g.some((x) => Number.isNaN(x)) ? null : g;
}

const v4FromGroups = (hi: number, lo: number): [number, number, number, number] => [hi >> 8, hi & 255, lo >> 8, lo & 255];

/**
 * true somente se o IP é um endereço público roteável. Qualquer formato inválido, reservado ou ambíguo => false.
 * Cobre IPv4 privado/loopback/link-local/metadata, IPv6 (::1, ::, fc00::/7, fe80::/10, ff00::/8, 2001:db8::/32),
 * IPv4-mapeado (::ffff:a.b.c.d e forma hex), NAT64 (64:ff9b::/96), 6to4 (2002::/16) e Teredo (2001::/32).
 */
export function isPublicIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '');
  const v = isIP(clean);
  if (v === 4) { const o = v4Octets(clean); return o ? v4Public(o) : false; }
  if (v !== 6) return false;
  const g = v6Groups(clean);
  if (!g) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.every((x) => x === 0)) return false;                                   // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return false; // ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return v4Public(v4FromGroups(g6, g7)); // ::ffff:v4
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return false; // ::v4 (compatível, obsoleto)
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return v4Public(v4FromGroups(g6, g7)); // NAT64
  if (g0 === 0x2002) return v4Public(v4FromGroups(g1, g2));                    // 6to4: valida o IPv4 embutido
  if (g0 === 0x2001 && g1 === 0) return false;                                 // Teredo
  if (g0 === 0x2001 && g1 === 0xdb8) return false;                             // documentação
  if ((g0 & 0xfe00) === 0xfc00) return false;                                  // ULA fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return false;                                  // link-local
  if ((g0 & 0xffc0) === 0xfec0) return false;                                  // site-local (obsoleto)
  if ((g0 & 0xff00) === 0xff00) return false;                                  // multicast
  if ((g0 & 0xe000) !== 0x2000) return false;                                  // só unicast global 2000::/3
  return true;
}

/** Resolve o host e exige que TODOS os endereços sejam públicos. Devolve o IP a ser fixado na conexão. */
export async function resolvePublic(host: string, resolver: Resolver): Promise<{ pinned: ResolvedAddress; all: ResolvedAddress[] }> {
  let all: ResolvedAddress[];
  try { all = await resolver.resolve(host); } catch (e) {
    throw new UrlRejected('dns_failure', `falha ao resolver ${host}: ${e instanceof Error ? e.message : 'erro'}`);
  }
  if (!all.length) throw new UrlRejected('dns_failure', `sem endereços para ${host}`);
  const bad = all.filter((a) => !isPublicIp(a.address));
  if (bad.length) throw new UrlRejected('private_resolved_ip', `${host} resolve para endereço não público: ${bad.map((b) => b.address).join(',')}`);
  return { pinned: all[0]!, all };
}
