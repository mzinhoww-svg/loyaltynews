// Diagnóstico TEMPORÁRIO de proxies (pedido do DevOps): mede quantas entradas o X-Forwarded-For chega com na
// Vertra, para definir TRUSTED_PROXY_HOPS. Só a CONTAGEM sai; nenhum valor (IP) é devolvido, logado ou gravado.
// Segundo diagnóstico (pedido do DevOps): quando a requisição traz `CF-Connecting-IP`, diz se a entrada N-ésima da direita do XFF é
// o mesmo IP (N = TRUSTED_PROXY_HOPS) e em que posição da direita ele aparece, SEM devolver nem logar IP algum.
// Desligado por padrão. Ligado só com DIAG_XFF=1 e fora de produção (APP_ENV production/producao é sempre ignorado).
import { isIP } from 'node:net';
import { trustedProxyHops } from '@ln/auth';

const PROD = new Set(['production', 'producao', 'produção', 'prod']);

export function diagXffEnabled(env: Record<string, string | undefined>): boolean {
  if (env.DIAG_XFF !== '1') return false;
  return !PROD.has((env.APP_ENV ?? '').trim().toLowerCase());
}

/** Número de entradas não vazias de X-Forwarded-For (separadas por vírgula, espaços ignorados). */
export function xffCount(headers: Headers): number {
  const raw = headers.get('x-forwarded-for');
  return raw ? raw.split(',').filter((p) => p.trim() !== '').length : 0;
}

function xffEntries(headers: Headers): string[] {
  return (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Compara o X-Forwarded-For com `CF-Connecting-IP` (nenhum valor sai): `pos` = posição, contada da DIREITA a partir de 1, da entrada
 * igual ao IP do Cloudflare (a mais próxima da direita), ou null; `match` = a entrada N-ésima da direita (N = hops) é esse IP.
 * null quando não há `CF-Connecting-IP` válido (a requisição não passou pelo Cloudflare).
 */
export function xffMatch(headers: Headers, hops: number): { match: boolean | null; pos: number | null } | null {
  const cf = headers.get('cf-connecting-ip')?.trim().toLowerCase();
  if (!cf || !isIP(cf)) return null;
  const e = xffEntries(headers);
  let pos: number | null = null;
  for (let i = e.length - 1; i >= 0; i--) {
    if (e[i] === cf) {
      pos = e.length - i;
      break;
    }
  }
  const match = hops >= 1 ? e.length >= hops && e[e.length - hops] === cf : null;
  return { match, pos };
}

/**
 * Cabeçalhos extras de /api/health: vazio, ou `x-ln-xff-count`; com `CF-Connecting-IP` acrescenta `x-ln-xff-match` (true/false, ou `na`
 * se TRUSTED_PROXY_HOPS não está definido) e `x-ln-xff-match-pos` (posição da direita do IP do Cloudflare no XFF, ou `none`).
 */
export function diagXffHeaders(env: Record<string, string | undefined>, headers: Headers): Record<string, string> {
  if (!diagXffEnabled(env)) return {};
  const out: Record<string, string> = { 'x-ln-xff-count': String(xffCount(headers)) };
  const m = xffMatch(headers, trustedProxyHops(env));
  if (m) {
    out['x-ln-xff-match'] = m.match === null ? 'na' : String(m.match);
    out['x-ln-xff-match-pos'] = m.pos === null ? 'none' : String(m.pos);
  }
  return out;
}
