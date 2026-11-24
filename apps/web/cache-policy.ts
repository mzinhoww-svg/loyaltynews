/**
 * Política de cache do documento das páginas do portal (borda/CDN e navegador). Fonte única do `headers()` do next.config.ts.
 *
 * Contexto: as páginas leem a fonte api com `cache: 'no-store'` e por isso são DINÂMICAS (force-dynamic). O Next serve página dinâmica com
 * `Cache-Control: private, no-cache, no-store`. Sem isso o portal não tem cache de borda nem back/forward cache. Aqui só as páginas SEM
 * pessoas ganham um cache curto; tudo o mais fica em no-store, por regra explícita (não por omissão).
 *
 * Decisões do PM (24/11/2026):
 *  - páginas sem pessoas (home, seções, listagens): `s-maxage=60` + `stale-while-revalidate=30` (atraso de até 60 s aceito; pior caso ~90 s);
 *  - páginas COM pessoas (Intelligence, Moves) e a MATÉRIA: no-store (condição de privacidade do QA 6; a matéria só ganha cache com purge
 *    automático em correção, despublicação e noindex, que ainda não existe);
 *  - não voltar ao render estático do build (nada de `revalidate`/ISR nessas páginas: o build não tem API e congelaria a cópia vazia).
 *
 * APIs (/api/**): cada handler define o seu próprio Cache-Control (mídia, anúncios, matérias públicas e Intelligence, este com no-store
 * quando há pessoa) e já tem teste. Não se aplica uma regra global em /api/**, que sobrescreveria esses cabeçalhos deliberados.
 */
// stale-while-revalidate=30 (DevOps): o pior caso depois de uma despublicação fica em ~90 s (60 s de s-maxage + 30 s servindo a cópia velha).
export const CACHE_60S = 'public, s-maxage=60, stale-while-revalidate=30';
export const NO_STORE = 'no-store';

/** Páginas SEM pessoas, cacheáveis por 60 s. */
export const PAGINAS_CACHEAVEIS = ['/', '/editoria/:slug', '/noticias', '/flash', '/analises', '/entrevistas', '/opiniao', '/em-alta', '/agenda'] as const;

/** Páginas COM pessoas, matéria/evento ou lista de URLs sensível: no-store explícito. */
// /sitemap.xml: lista URLs de pessoas quando a flag do Intelligence está ligada (achado do DevOps); sem regra saía "public, max-age=0, must-revalidate".
// /agenda/:slug (evento) e o .ics: como a matéria, só ganham cache com purge automático em correção/despublicação (DevOps, §5).
export const PAGINAS_NO_STORE = ['/intelligence/:path*', '/moves/:path*', '/noticia/:path*', '/studio/:path*', '/sitemap.xml', '/agenda/:slug', '/agenda/:slug/ics'] as const;

export interface PortalHeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/** Regras para o `headers()` do next.config.ts. */
export function portalCacheHeaders(): PortalHeaderRule[] {
  return [
    ...PAGINAS_CACHEAVEIS.map((source) => ({ source, headers: [{ key: 'Cache-Control', value: CACHE_60S }] })),
    ...PAGINAS_NO_STORE.map((source) => ({ source, headers: [{ key: 'Cache-Control', value: NO_STORE }] })),
  ];
}

const BS = String.fromCharCode(92); // barra invertida
const META = '.*+?^${}()|[]';
const CURINGA = '(?:.*)';

/** Regex de um `source` do Next (`:param` = um segmento; `:param*` = zero ou mais). Só o que esta política usa. */
function regexDe(source: string): RegExp {
  const corpo = source
    .split('/')
    .map((seg) => (seg.startsWith(':') ? (seg.endsWith('*') ? CURINGA : '[^/]+') : [...seg].map((ch) => (META.includes(ch) ? BS + ch : ch)).join('')))
    .join('/');
  // "/x/<curinga>" também casa "/x" (zero segmentos)
  const final = corpo.endsWith('/' + CURINGA) ? corpo.slice(0, -('/' + CURINGA).length) + '(?:/.*)?' : corpo;
  return new RegExp(`^${final}$`);
}

/** Valor de Cache-Control que a política dá a um caminho; `null` = nenhuma regra (vale o padrão do Next). */
export function cacheControlDe(pathname: string): string | null {
  for (const r of portalCacheHeaders()) if (regexDe(r.source).test(pathname)) return r.headers[0]!.value;
  return null;
}
