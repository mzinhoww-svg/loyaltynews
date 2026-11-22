import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import type { NextConfig } from 'next';

// Build de e2e do Studio: único caso em que o código de sessão simulada (MOCK) entra no bundle.
const e2eBuild = process.env.LN_E2E_BUILD === '1';

const seam = e2eBuild ? './lib/studio/test-seam.e2e.mock.ts' : './lib/studio/test-seam.prod.ts';

const config = (phase: string): NextConfig => {
  // Produção recusa a variável de sessão simulada no BUILD. Em runtime, mesmo definida, o bundle de produção não tem o mock (seam nulo).
  if (phase === PHASE_PRODUCTION_BUILD && !e2eBuild && process.env.LN_STUDIO_TEST_SESSION) {
    throw new Error(
      'LN_STUDIO_TEST_SESSION está definida fora do build de e2e (LN_E2E_BUILD=1). Build recusado: sessão simulada não pode existir em produção.',
    );
  }
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
    // Bancos nativos/WASM ficam fora do bundle (pg em produção; PGlite só em dev/e2e).
    serverExternalPackages: ['pg', '@electric-sql/pglite'],
    // e2e usa diretório de build próprio para não contaminar o artefato de produção.
    distDir: e2eBuild ? '.next-e2e' : '.next',
    turbopack: {
      resolveAlias: { '@ln-studio/test-seam': seam },
    },
  };
};

export default config;
