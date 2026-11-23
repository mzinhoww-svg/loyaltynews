/**
 * Política de indexação e URL pública do portal.
 *
 * Regra: só `APP_ENV=production` é indexável. Qualquer outro valor (staging, homologacao, development)
 * ou ausência da variável bloqueia indexação (padrão seguro). A fonte MOCK também bloqueia, em qualquer ambiente.
 * `APP_ENV` deve estar definido no BUILD de produção (metadata das páginas estáticas é gerada no build);
 * robots.txt, sitemap e o cabeçalho X-Robots-Tag (proxy.ts) são decididos em tempo de execução.
 */
export type Env = Record<string, string | undefined>;

export const NOINDEX_HEADER = 'noindex, nofollow';
const LOCAL_URL = 'http://localhost:3000';

export const isProductionEnv = (env: Env = process.env): boolean => env.APP_ENV === 'production';

export const indexingBlocked = (env: Env = process.env): boolean => !isProductionEnv(env) || env.PORTAL_SOURCE === 'mock';

export type SourceKind = 'empty' | 'mock' | 'api';

/**
 * Fonte de dados efetiva a partir do ambiente (fail-closed):
 *  - `api` e `empty` valem em qualquer ambiente; valor desconhecido ou ausente = vazia (honesta);
 *  - `mock` só fora de produção ou no build de e2e (LN_E2E_BUILD=1). Com APP_ENV=production, pedir mock NÃO o ativa:
 *    cai na fonte vazia e `refusedMock` fica verdadeiro (quem chama registra o erro).
 */
export function resolveSourceKind(env: Env = process.env): { kind: SourceKind; refusedMock: boolean } {
  const wanted = env.PORTAL_SOURCE;
  if (wanted === 'api') return { kind: 'api', refusedMock: false };
  if (wanted === 'mock') {
    const allowed = !isProductionEnv(env) || env.LN_E2E_BUILD === '1';
    return allowed ? { kind: 'mock', refusedMock: false } : { kind: 'empty', refusedMock: true };
  }
  return { kind: 'empty', refusedMock: false };
}

/** robots.txt: bloqueado = nada rastreável e sem Sitemap; liberado = regra de produção. */
export function robotsTxt(blocked: boolean, siteUrl: string): string {
  return blocked
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nDisallow: /busca\nDisallow: /studio\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
}

/**
 * URL pública (canonical, Open Graph, sitemap). Vem de NEXT_PUBLIC_SITE_URL, lida no build.
 * Em produção, o BUILD falha sem ela (ou com localhost); fora de produção usa a URL do staging ou localhost.
 */
export function resolveSiteUrl(env: Env = process.env): string {
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim();
  const building = env.NEXT_PHASE === 'phase-production-build';
  if (!raw) {
    if (isProductionEnv(env) && building) {
      throw new Error('NEXT_PUBLIC_SITE_URL é obrigatória no build com APP_ENV=production (canonical e sitemap).');
    }
    return LOCAL_URL;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`NEXT_PUBLIC_SITE_URL inválida: "${raw}".`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`NEXT_PUBLIC_SITE_URL deve ser http(s): "${raw}".`);
  if (isProductionEnv(env) && building && /^(localhost|127\.0\.0\.1)$/.test(url.hostname)) {
    throw new Error('NEXT_PUBLIC_SITE_URL não pode apontar para localhost em produção.');
  }
  return url.origin;
}
