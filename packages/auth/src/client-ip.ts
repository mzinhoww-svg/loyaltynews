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

export function clientIp(headers: Headers, hops: number = trustedProxyHops()): string | null {
  if (hops < 1) return null;
  const entries = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length < hops) return null;
  const ip = entries[entries.length - hops];
  return ip && isIP(ip) ? ip.toLowerCase() : null;
}
