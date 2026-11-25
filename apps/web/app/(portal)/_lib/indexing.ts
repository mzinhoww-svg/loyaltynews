/**
 * Política de indexação e URL pública do portal.
 *
 * Regra (DP-24): a indexação só é liberada com `APP_ENV=production` E o interruptor explícito `PORTAL_INDEXAVEL=1`
 * (valor exato; definido pelo pacote só no go-live). Produção SEM o interruptor sobe NÃO indexável, igual ao staging:
 * robots `Disallow: /`, sem Sitemap, sitemap vazio, meta noindex/nofollow e X-Robots-Tag.
 * Qualquer outro APP_ENV (staging, homologacao, development) ou ausência da variável bloqueia (padrão seguro), assim como a fonte
 * MOCK e a vitrine, em qualquer ambiente; o interruptor nunca afrouxa staging nem vitrine (nem o R8).
 * `APP_ENV` deve estar definido no BUILD de produção (metadata das páginas estáticas é gerada no build);
 * robots.txt, sitemap e o cabeçalho X-Robots-Tag (proxy.ts) são decididos em tempo de execução.
 */
export type Env = Record<string, string | undefined>;

export const NOINDEX_HEADER = 'noindex, nofollow';
const LOCAL_URL = 'http://localhost:3000';

export const isProductionEnv = (env: Env = process.env): boolean => env.APP_ENV === 'production';

/** Interruptor de indexação de produção: só o valor exato "1" conta. */
export const indexavelFlag = (env: Env = process.env): boolean => env.PORTAL_INDEXAVEL === '1';

export const indexingBlocked = (env: Env = process.env): boolean =>
  !isProductionEnv(env) ||
  !indexavelFlag(env) ||
  env.PORTAL_SOURCE === 'mock' ||
  (env.PORTAL_VITRINE !== undefined && env.PORTAL_VITRINE !== '');

/**
 * Guard de build do interruptor (junto com a vitrine, ver assertVitrineEnv): `PORTAL_INDEXAVEL` definida só pode valer "1" e exige
 * APP_ENV=production. Outra combinação (staging com 1, valor diferente de 1, como "0" ou "true") faz o BUILD falhar, para um erro de
 * digitação não virar indexação nem esconder a intenção.
 */
export function assertIndexavelEnv(env: Env = process.env): void {
  const v = env.PORTAL_INDEXAVEL;
  if (v === undefined || v === '') return;
  if (env.NEXT_PHASE !== 'phase-production-build') return;
  if (v !== '1' || !isProductionEnv(env)) {
    throw new Error('Build recusado: PORTAL_INDEXAVEL só é aceita com o valor 1 e APP_ENV=production (staging e vitrine nunca são indexáveis).');
  }
}

export type SourceKind = 'empty' | 'mock' | 'api';

/** Produção em qualquer grafia usada pelos pacotes de deploy. */
const isProductionLike = (env: Env) => env.APP_ENV === 'production' || env.APP_ENV === 'producao';

/**
 * Fonte de dados efetiva a partir do ambiente (fail-closed; decisão do Security & Governance, R1-R4):
 *  - `api` e vazia valem em qualquer ambiente; valor desconhecido ou ausente = vazia (honesta);
 *  - APP_ENV=production/producao: SEMPRE vazia ou api; pedir mock (PORTAL_SOURCE=mock ou PORTAL_VITRINE) nunca o ativa;
 *  - vitrine de staging: `PORTAL_VITRINE=1` (só o valor 1) com `APP_ENV=staging` ativa as fixtures;
 *  - `PORTAL_SOURCE=mock` NÃO é aceito em deploy (build/start de produção do Next, inclusive staging): só em desenvolvimento
 *    e testes (NODE_ENV diferente de production, ex.: next dev e vitest) ou no build de e2e (LN_E2E_BUILD=1).
 * Pedido recusado cai na fonte vazia e `refusedMock` fica verdadeiro (quem chama registra o erro).
 */
export function resolveSourceKind(env: Env = process.env): { kind: SourceKind; refusedMock: boolean } {
  if (env.PORTAL_SOURCE === 'api') return { kind: 'api', refusedMock: false };
  const wantsVitrine = env.PORTAL_VITRINE !== undefined && env.PORTAL_VITRINE !== '';
  const wantsMock = env.PORTAL_SOURCE === 'mock';
  if (!wantsVitrine && !wantsMock) return { kind: 'empty', refusedMock: false };
  if (isProductionLike(env)) return { kind: 'empty', refusedMock: true };
  if (wantsVitrine) {
    const ok = env.PORTAL_VITRINE === '1' && env.APP_ENV === 'staging';
    return ok ? { kind: 'mock', refusedMock: false } : { kind: 'empty', refusedMock: true };
  }
  const outsideDeploy = env.NODE_ENV !== 'production' || env.LN_E2E_BUILD === '1';
  return outsideDeploy ? { kind: 'mock', refusedMock: false } : { kind: 'empty', refusedMock: true };
}

/**
 * Vitrine (Security R1/R2/R8): `PORTAL_VITRINE` só pode existir com o valor exato "1" e APP_ENV=staging.
 * Qualquer outra combinação (inclusive produção/producao/homologacao) faz o BUILD falhar; em execução a fonte vazia é usada
 * (ver resolveSourceKind). Chamada no carregamento de site.ts, que roda durante `next build`.
 */
export function assertVitrineEnv(env: Env = process.env): void {
  const v = env.PORTAL_VITRINE;
  if (v === undefined || v === '') return;
  if (env.NEXT_PHASE !== 'phase-production-build') return;
  if (v !== '1' || env.APP_ENV !== 'staging') {
    throw new Error('Build recusado: PORTAL_VITRINE só é aceita com o valor 1 e APP_ENV=staging (decisão do Security; vitrine nunca em produção).');
  }
}

/** robots.txt: bloqueado = nada rastreável e sem Sitemap; liberado = regra de produção. */
export function robotsTxt(blocked: boolean, siteUrl: string): string {
  return blocked
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nDisallow: /busca\nDisallow: /studio\nDisallow: /api/\n\nSitemap: ${siteUrl}/sitemap.xml\nSitemap: ${siteUrl}/news-sitemap.xml\n`;
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
