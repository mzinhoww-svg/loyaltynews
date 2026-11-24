/**
 * Cabeçalhos de cache usados por Route Handlers do portal. A fonte da política de páginas é `CACHE_60S` em next.config.ts, que NÃO pode ser importado
 * por código do app (o config carrega 'next/constants' e caminhos de Node) nem importar daqui (um .ts irmão quebra `next start apps/web` pela raiz).
 * Por isso a string existe nos dois lugares e `lib/cache-policy.test.ts` falha se divergirem.
 */
export const CACHE_60S = 'public, s-maxage=60, stale-while-revalidate=30';
export const NO_STORE = 'no-store';
