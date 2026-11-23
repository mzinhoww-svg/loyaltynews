// Diagnóstico TEMPORÁRIO de proxies (pedido do DevOps): mede quantas entradas o X-Forwarded-For chega com na
// Vertra, para definir TRUSTED_PROXY_HOPS. Só a CONTAGEM sai; nenhum valor (IP) é devolvido, logado ou gravado.
// Desligado por padrão. Ligado só com DIAG_XFF=1 e fora de produção (APP_ENV production/producao é sempre ignorado).
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

/** Cabeçalhos extras de /api/health: vazio, ou só `x-ln-xff-count`. */
export function diagXffHeaders(env: Record<string, string | undefined>, headers: Headers): Record<string, string> {
  return diagXffEnabled(env) ? { 'x-ln-xff-count': String(xffCount(headers)) } : {};
}
