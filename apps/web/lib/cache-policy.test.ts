import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CACHE_60S as CACHE_60S_ROTAS, NO_STORE as NO_STORE_ROTAS } from './cache-60s';
import config, { NO_STORE, CACHE_60S, PAGINAS_CACHEAVEIS, PAGINAS_NO_STORE, cacheControlDe, portalCacheHeaders } from '../next.config';

/**
 * Classificação de TODA rota do portal (app/(portal)). Uma rota nova sem entrada aqui faz o teste de cobertura falhar:
 *  - cacheavel   : página SEM pessoas, `public, s-maxage=60, stale-while-revalidate=300` por regra explícita;
 *  - no-store    : página COM pessoas ou matéria, `no-store` por regra explícita (não por omissão);
 *  - padrao-next : sem regra; vale o padrão do Next (página dinâmica = no-store; estática = cache longo). Nenhuma tem pessoas.
 */
const CLASSIFICACAO: Record<string, 'cacheavel' | 'no-store' | 'padrao-next'> = {
  '/': 'cacheavel',
  '/editoria/:slug': 'cacheavel',
  '/noticias': 'cacheavel',
  '/flash': 'cacheavel',
  '/analises': 'cacheavel',
  '/entrevistas': 'cacheavel',
  '/opiniao': 'cacheavel',
  '/intelligence': 'no-store',
  '/intelligence/empresas': 'no-store',
  '/intelligence/empresas/:id': 'no-store',
  '/intelligence/pessoas': 'no-store',
  '/intelligence/pessoas/:id': 'no-store',
  '/moves': 'no-store',
  '/moves/:id': 'no-store',
  '/noticia/:slug': 'no-store',
  '/agenda': 'cacheavel',
  '/agenda/:slug': 'no-store',
  '/agenda/:slug/ics': 'no-store',
  '/anuncie': 'padrao-next',
  '/busca': 'padrao-next',
  '/busca/sugestoes': 'padrao-next', // JSON de sugestões da busca do cabeçalho; o handler define o próprio Cache-Control (60 s na resposta boa, no-store no 400 e no indisponível)
  '/em-alta': 'cacheavel',
  '/feed.xml': 'padrao-next',
  '/indicadores': 'padrao-next',
  '/midia-kit': 'padrao-next',
  '/podcast': 'padrao-next',
  '/robots.txt': 'padrao-next',
  '/sitemap.xml': 'no-store',
  '/the-loyal': 'padrao-next',
  '/:doc': 'padrao-next',
};

/** Caminho concreto de exemplo para uma rota com parâmetros. */
const exemplo = (rota: string) => rota.replace(/:[a-z]+/g, 'x');

/** Rotas reais do portal, lidas do disco: page.tsx, route.ts e sitemap.ts de app/(portal). */
function rotasDoPortal(): string[] {
  const raiz = path.resolve(import.meta.dirname, '..', 'app', '(portal)');
  const achadas: string[] = [];
  const andar = (dir: string, partes: string[]) => {
    for (const nome of readdirSync(dir)) {
      const p = path.join(dir, nome);
      if (statSync(p).isDirectory()) {
        // grupos "(x)" não entram na URL; "[slug]" vira ":slug"
        const seg = /^\(.*\)$/.test(nome) ? null : nome.replace(/^\[(.+)\]$/, ':$1');
        andar(p, seg === null ? partes : [...partes, seg]);
      } else if (nome === 'page.tsx' || nome === 'route.ts') {
        achadas.push('/' + partes.join('/'));
      } else if (nome === 'sitemap.ts') {
        achadas.push('/' + [...partes, 'sitemap.xml'].join('/'));
      }
    }
  };
  andar(raiz, []);
  return [...new Set(achadas.map((r) => (r === '/' ? r : r.replace(/\/$/, ''))))].sort();
}

describe('política de cache do portal: allowlist de páginas sem pessoas', () => {
  it('cada página da allowlist sai com public, s-maxage=60 e stale-while-revalidate, sem private nem no-store', () => {
    expect(CACHE_60S).toBe('public, s-maxage=60, stale-while-revalidate=30');
    for (const rota of PAGINAS_CACHEAVEIS) {
      const v = cacheControlDe(exemplo(rota));
      expect(v, rota).toBe(CACHE_60S);
      expect(v, rota).not.toMatch(/private|no-store|no-cache/);
    }
  });
  it('a allowlist é exatamente as 9 páginas (home, editoria, 5 listagens, /em-alta e /agenda; lista do PM + DevOps)', () => {
    expect([...PAGINAS_CACHEAVEIS]).toEqual(['/', '/editoria/:slug', '/noticias', '/flash', '/analises', '/entrevistas', '/opiniao', '/em-alta', '/agenda']);
  });
});

describe('política de cache do portal: páginas com pessoas e matéria ficam em no-store explícito', () => {
  const COM_PESSOAS = [
    '/intelligence', '/intelligence/empresas', '/intelligence/empresas/123', '/intelligence/pessoas', '/intelligence/pessoas/abc',
    '/moves', '/moves/1', '/noticia/qualquer-slug', '/studio', '/studio/cms/materia', '/sitemap.xml', '/agenda/evento-x', '/agenda/evento-x/ics',
  ];
  it('lista fechada: todas saem com no-store, por regra explícita', () => {
    for (const p of COM_PESSOAS) expect(cacheControlDe(p), p).toBe(NO_STORE);
    expect([...PAGINAS_NO_STORE]).toEqual(['/intelligence/:path*', '/moves/:path*', '/noticia/:path*', '/studio/:path*', '/sitemap.xml', '/agenda/:slug', '/agenda/:slug/ics']);
  });
  it('nenhuma regra de cache público alcança uma página com pessoas', () => {
    for (const p of COM_PESSOAS) {
      const publicas = portalCacheHeaders().filter((r) => r.headers[0]!.value === CACHE_60S);
      // a primeira regra que casa é a que vale (cacheControlDe); aqui garante que nenhuma pública casa
      expect(cacheControlDe(p), p).not.toBe(CACHE_60S);
      expect(publicas.length).toBe(PAGINAS_CACHEAVEIS.length);
    }
  });
  it('o headers() do next.config.ts entrega exatamente essas regras', async () => {
    const cfg = config('phase-production-server');
    expect(await cfg.headers!()).toEqual(portalCacheHeaders());
  });
});

describe('política de cache do portal: cobertura (falha se uma rota nova não for classificada)', () => {
  it('toda rota de app/(portal) está classificada, e toda classificação tem rota', () => {
    const reais = rotasDoPortal();
    const classificadas = Object.keys(CLASSIFICACAO).sort();
    const semClasse = reais.filter((r) => !(r in CLASSIFICACAO));
    const semRota = classificadas.filter((r) => !reais.includes(r));
    expect(semClasse, `rotas novas sem classificar em CLASSIFICACAO (cacheavel, no-store ou padrao-next): ${semClasse.join(', ')}`).toEqual([]);
    expect(semRota, `classificação sem rota no disco: ${semRota.join(', ')}`).toEqual([]);
  });
  it('a classificação bate com o que a política realmente entrega', () => {
    for (const [rota, classe] of Object.entries(CLASSIFICACAO)) {
      const v = cacheControlDe(exemplo(rota));
      if (classe === 'cacheavel') expect(v, rota).toBe(CACHE_60S);
      if (classe === 'no-store') expect(v, rota).toBe(NO_STORE);
      if (classe === 'padrao-next') expect(v, rota).toBeNull();
    }
  });
});

describe('política de cache do portal: o que NUNCA pode estar no cache de 60 s', () => {
  it('sitemap, Intelligence, Moves, matéria e Studio não casam nenhuma regra de CACHE_60S', () => {
    const publicas = portalCacheHeaders().filter((r) => r.headers[0]!.value === CACHE_60S).map((r) => r.source);
    for (const proibida of ['/sitemap.xml', '/intelligence', '/intelligence/pessoas/x', '/moves', '/moves/1', '/noticia/x', '/studio/cms']) {
      expect(cacheControlDe(proibida), proibida).toBe(NO_STORE);
    }
    for (const s of publicas) expect(s, 'allowlist não pode conter rota com pessoas').not.toMatch(/sitemap|intelligence|moves|noticia\/|studio/);
  });
});

describe('política de cache do portal: página com pessoas tem de ser dinâmica, não estática/ISR', () => {
  // O Next sobrescreve o Cache-Control de página com `revalidate` (ISR): s-maxage + HIT, ignorando o headers() do config. A proteção real
  // para pessoas é a página ser force-dynamic. Vale para Intelligence, Moves, a matéria e o evento (no-store até haver purge).
  const PASTAS = ['intelligence', 'moves', 'noticia', 'agenda'];
  const raiz = path.resolve(import.meta.dirname, '..', 'app', '(portal)');
  const arquivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) return arquivos(p);
      return n === 'page.tsx' || n === 'route.ts' ? [p] : [];
    });
  // /agenda (a lista) é cacheável e fica de fora; só as páginas de evento ([slug]) entram.
  const alvo = PASTAS.flatMap((d) => arquivos(path.join(raiz, d)).filter((f) => d !== 'agenda' || f.includes('[slug]')));

  it('há páginas a conferir (o teste não passa vazio)', () => {
    expect(alvo.length).toBeGreaterThanOrEqual(8);
  });
  it("toda página/rota de Intelligence, Moves, matéria e evento exporta dynamic = 'force-dynamic' e nenhuma exporta revalidate", async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of alvo) {
      const src = readFileSync(f, 'utf8');
      const rel = path.relative(raiz, f);
      expect(src, `${rel}: falta export const dynamic = 'force-dynamic'`).toMatch(/export const dynamic\s*=\s*'force-dynamic'/);
      expect(src, `${rel}: não pode ter export const revalidate (ISR sobrescreve o Cache-Control)`).not.toMatch(/export const revalidate\b/);
    }
  });
});

describe('política de cache do portal: constantes dos Route Handlers = as do next.config.ts', () => {
  it('lib/cache-60s.ts repete exatamente CACHE_60S e NO_STORE do next.config.ts (única duplicação permitida, com este teste)', () => {
    expect(CACHE_60S_ROTAS).toBe(CACHE_60S);
    expect(NO_STORE_ROTAS).toBe(NO_STORE);
  });
});
