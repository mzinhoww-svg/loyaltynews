import { NextResponse, type NextRequest } from 'next/server';
import { caminhoDoPedido } from './lib/studio/login';
import { NOINDEX_HEADER, indexingBlocked } from './app/(portal)/_lib/indexing';

/**
 * Fora de produção (APP_ENV diferente de "production") ou com fonte MOCK, TODA resposta leva
 * `X-Robots-Tag: noindex, nofollow` (portal, Studio, API, arquivos estáticos).
 * Decidido em tempo de execução: o mesmo build serve staging e produção conforme o ambiente.
 */
export function proxy(req: NextRequest) {
  // Studio: o guard das páginas não conhece o caminho; o proxy o entrega num cabeçalho interno (sobrescreve o que o cliente mandou)
  // para a tela de entrada devolver a pessoa ao destino pedido. O destino é revalidado (destinoSeguro) antes de qualquer uso.
  const { pathname, search } = req.nextUrl;
  let res: NextResponse;
  if (pathname === '/studio' || pathname.startsWith('/studio/')) {
    const h = new Headers(req.headers);
    h.set('x-ln-studio-path', caminhoDoPedido(pathname, search));
    res = NextResponse.next({ request: { headers: h } });
  } else {
    res = NextResponse.next();
  }
  if (indexingBlocked()) res.headers.set('X-Robots-Tag', NOINDEX_HEADER);
  return res;
}

export const config = { matcher: '/:path*' };
