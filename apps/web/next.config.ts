import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import type { NextConfig } from 'next';

// ---- Política de cache do portal (INLINE de propósito) ------------------------------------------------------------------------------------
// Fica DENTRO do next.config.ts, sem import de arquivo .ts irmão: com `next start apps/web` rodando a partir da RAIZ do repositório (start_command da
// Vertra) o Next 16 não carrega um next.config.ts que importa um .ts local ("Cannot find module './cache-policy'": o servidor imprime Ready e o
// /api/health nunca responde; achado do DevOps em 24/11/2026). O teste lib/cache-policy.test.ts importa estas constantes deste arquivo.
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
// ---- fim da política de cache -------------------------------------------------------------------------------------------------------------

// Raiz do monorepo, explícita: apps/web/next.config.ts -> ../.. . Sem isso o Next infere a raiz do workspace pelo lockfile e RECUSA a pasta que
// contiver o diretório do usuário. Na Vertra o HOME fica dentro da pasta do app (/app/.cache/vertra/tmp/build/home), então ele ignorava /app e
// não achava o `next` içado em /app/node_modules ("Could not find the Next.js package", build falhou em 22/11/2026). Fixar a raiz torna o build
// independente de HOME e do diretório de trabalho (docs: turbopack#root-directory).
const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Build de e2e do Studio: único caso em que o backend de teste (PGlite + login de teste) entra no bundle.
const e2eBuild = process.env.LN_E2E_BUILD === '1';

const e2eBackendSeam = e2eBuild ? './lib/studio/e2e-backend.e2e.mock.ts' : './lib/studio/e2e-backend.prod.ts';

// Variáveis que só existem em dev/e2e: o build de produção as recusa (sessão simulada e banco PGlite em memória).
const VARIAVEIS_SO_DEV = ['LN_STUDIO_TEST_SESSION', 'LN_STUDIO_DEV_DB'] as const;

// Vitrine do portal em staging (decisão do Security, R8): o código de demonstração (fixtures e faixa) só ENTRA no bundle quando o build é de
// vitrine (PORTAL_VITRINE=1 com APP_ENV=staging). Vira constante de build (NEXT_PUBLIC_PORTAL_DEMO): no build de produção os ramos que carregam
// as fixtures são eliminados e nenhum marcador da vitrine fica no .next. Em dev/teste (NODE_ENV diferente de production) o portal as carrega à parte.
const portalDemo = process.env.PORTAL_VITRINE === '1' && process.env.APP_ENV === 'staging' ? '1' : '0';

const config = (phase: string): NextConfig => {
  // Produção recusa essas variáveis no BUILD. Em runtime, mesmo definidas, o bundle de produção não tem o código (fábricas nulas).
  if (phase === PHASE_PRODUCTION_BUILD && !e2eBuild) {
    const definidas = VARIAVEIS_SO_DEV.filter((v) => process.env[v]);
    if (definidas.length) {
      throw new Error(`${definidas.join(', ')} definida(s) fora do build de e2e (LN_E2E_BUILD=1). Build recusado: sessão simulada e banco em memória não podem existir em produção.`);
    }
  }
  // Banco PGlite em memória: só no build de e2e e no next dev.
  const devDbSeam = e2eBuild || phase === PHASE_DEVELOPMENT_SERVER ? './lib/studio/dev-db.e2e.mock.ts' : './lib/studio/dev-db.prod.ts';
  // Decisão do PM (opção e, 23/11/2026): o typecheck sai do build da Vertra (memória do plano) SÓ com LN_BUILD_SKIP_TYPECHECK
  // exatamente '1', passada pelo build-web.mjs a partir do release.json. O pacote só sai com relatório de typecheck verde do
  // MESMO commit (build-web/package-web, DevOps). Qualquer outro valor ou ausência = typecheck no build (padrão seguro).
  const skipTypecheck = process.env.LN_BUILD_SKIP_TYPECHECK === '1';
  // Build "leve" na Vertra (app de 512 MB => ambiente de build de 1024 MB): v7 morreu (Killed, 137) em "Generating static pages using 1 worker (0/39)".
  // Com LN_BUILD_LEVE exatamente '1' (passada pelo build-web.mjs a partir do release.json, nunca pelo painel) a geração estática roda uma página por vez e
  // o Turbopack não grava o cache de arquivos do build (container novo a cada build: o cache não é reaproveitado e custa memória). Não muda o que é gerado.
  const buildLeve = process.env.LN_BUILD_LEVE === '1';
  return {
    // Pacotes do monorepo são TypeScript-fonte (sem build próprio).
    transpilePackages: [
      '@ln/contracts',
      '@ln/ui',
      '@ln/auth',
      '@ln/editorial',
      '@ln/agents',
      '@ln/intelligence',
      '@ln/growth',
      '@ln/commercial',
      '@ln/modelops',
      '@ln/db',
    ],
    poweredByHeader: false,
    env: { NEXT_PUBLIC_PORTAL_DEMO: portalDemo },
    typescript: { ignoreBuildErrors: skipTypecheck },
    // Upload de mídia pelo Studio (server action multipart): PDF até 10 MB + metadados.
    experimental: {
      serverActions: { bodySizeLimit: '11mb' },
      ...(buildLeve ? { staticGenerationMaxConcurrency: 1, turbopackFileSystemCacheForBuild: false } : {}),
    },
    // Bancos nativos/WASM ficam fora do bundle (pg em produção; PGlite só em dev/e2e: nem a lista de externos o cita em produção).
    serverExternalPackages: devDbSeam.includes('.e2e.') ? ['pg', '@electric-sql/pglite'] : ['pg'],
    // Mesma raiz para o rastreamento de arquivos do build (evita aviso de múltiplos lockfiles e inferência por HOME).
    outputFileTracingRoot: monorepoRoot,
    // e2e usa diretório de build próprio para não contaminar o artefato de produção.
    // LN_E2E_DIST: pasta própria por perfil de build do e2e do portal (produção e vitrine; e2e/portal-server.mjs). Só vale no build de e2e.
    distDir: e2eBuild ? (process.env.LN_E2E_DIST || '.next-e2e') : '.next',
    // Cache do documento das páginas do portal (política acima, neste arquivo): 60 s só nas páginas sem pessoas; pessoas e matéria em no-store.
    async headers() {
      return portalCacheHeaders();
    },
    turbopack: {
      root: monorepoRoot,
      resolveAlias: { '@ln-studio/e2e-backend': e2eBackendSeam, '@ln-studio/dev-db': devDbSeam },
    },
  };
};

export default config;
