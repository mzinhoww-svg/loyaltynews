import { NextResponse, type NextRequest } from 'next/server';
import { ehDocumento, gerarNonce, modoCsp, politicaCsp } from './lib/csp';
import { caminhoDoPedido } from './lib/studio/login';
import { NOINDEX_HEADER, indexingBlocked } from './app/(portal)/_lib/indexing';

/**
 * Fora de produção (APP_ENV diferente de "production") ou com fonte MOCK, TODA resposta leva
 * `X-Robots-Tag: noindex, nofollow` (portal, Studio, API, arquivos estáticos).
 * Decidido em tempo de execução: o mesmo build serve staging e produção conforme o ambiente.
 * Nos documentos, aplica a CSP com nonce conforme LN_CSP_MODE (lib/csp.ts).
 */
export function proxy(req: NextRequest) {
  // Studio: o guard das páginas não conhece o caminho; o proxy o entrega num cabeçalho interno (sobrescreve o que o cliente mandou)
  // para a tela de entrada devolver a pessoa ao destino pedido. O destino é revalidado (destinoSeguro) antes de qualquer uso.
  const { pathname, search } = req.nextUrl;
  const studio = pathname === '/studio' || pathname.startsWith('/studio/');
  const modo = modoCsp(process.env.LN_CSP_MODE);
  const documento = ehDocumento(pathname);
  const csp = documento && modo !== 'off' ? politicaCsp(gerarNonce(), { dev: process.env.NODE_ENV === 'development' }) : null;

  let res: NextResponse;
  if (documento || studio) {
    const h = new Headers(req.headers);
    // O Next tira o nonce destes cabeçalhos da REQUISIÇÃO: o que o cliente mandar é descartado, senão ele escolheria o nonce.
    h.delete('content-security-policy');
    h.delete('content-security-policy-report-only');
    if (studio) h.set('x-ln-studio-path', caminhoDoPedido(pathname, search));
    if (csp) h.set('content-security-policy', csp);
    res = NextResponse.next({ request: { headers: h } });
  } else {
    // API e arquivos: a requisição segue intocada (a mídia tem a própria CSP `sandbox`).
    res = NextResponse.next();
  }
  if (csp) res.headers.set(modo === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', csp);
  if (indexingBlocked()) res.headers.set('X-Robots-Tag', NOINDEX_HEADER);
  return res;
}

export const config = { matcher: '/:path*' };
