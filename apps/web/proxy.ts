import { NextResponse } from 'next/server';
import { NOINDEX_HEADER, indexingBlocked } from './app/(portal)/_lib/indexing';

/**
 * Fora de produção (APP_ENV diferente de "production") ou com fonte MOCK, TODA resposta leva
 * `X-Robots-Tag: noindex, nofollow` (portal, Studio, API, arquivos estáticos).
 * Decidido em tempo de execução: o mesmo build serve staging e produção conforme o ambiente.
 */
export function proxy() {
  const res = NextResponse.next();
  if (indexingBlocked()) res.headers.set('X-Robots-Tag', NOINDEX_HEADER);
  return res;
}

export const config = { matcher: '/:path*' };
