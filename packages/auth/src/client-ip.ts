// IP do cliente com fronteira de proxy confiável.
//
// Cabeçalhos de proxy são escritos pelo cliente se nenhum proxy os reescrever, então NUNCA valem por
// padrão. Com TRUSTED_PROXY_HOPS=N (N proxies confiáveis na frente do app, ex.: 1 para um único proxy de
// borda que acrescenta o IP de quem o contatou), o IP do cliente é a N-ésima entrada de X-Forwarded-For
// contada da DIREITA: o que o cliente escreve à esquerda é ignorado. X-Real-IP não é usado.
// Sem configuração (N=0), ou com menos entradas que N (requisição que não passou pelos proxies), ou com
// valor que não é IP: devolve null e o limite por IP não se aplica (continua o limite por conta).
import { isIP } from 'node:net';

export function trustedProxyHops(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? '', 10);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 0;
}

/**
 * Forma canônica do IP para o limite (o mesmo IP em grafias diferentes tem de cair no MESMO contador): minúsculas, sem zona IPv6 (%eth0), sem colchetes e
 * IPv4 mapeado em IPv6 (::ffff:1.2.3.4 ou ::ffff:0102:0304) vira o IPv4. Devolve null se não for IP.
 */
export function normalizeIp(raw: string): string | null {
  let v = raw.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const z = v.indexOf('%');
  if (z >= 0) v = v.slice(0, z);
  if (!isIP(v)) return null;
  const dotted = /^(?:0:0:0:0:0:ffff|::ffff):(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v);
  if (dotted && isIP(dotted[1]!) === 4) return dotted[1]!;
  const hex = /^(?:0:0:0:0:0:ffff|::ffff):([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
  if (hex) {
    const a = Number.parseInt(hex[1]!, 16);
    const b = Number.parseInt(hex[2]!, 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return v;
}

export function clientIp(headers: Headers, hops: number = trustedProxyHops()): string | null {
  if (hops < 1) return null;
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length < hops) return null;
  const ip = entries[entries.length - hops];
  return ip ? normalizeIp(ip) : null;
}
