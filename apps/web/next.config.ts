import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import type { NextConfig } from 'next';

// Build de e2e do Studio: único caso em que o backend de teste (PGlite + login de teste) entra no bundle.
const e2eBuild = process.env.LN_E2E_BUILD === '1';

const e2eBackendSeam = e2eBuild ? './lib/studio/e2e-backend.e2e.mock.ts' : './lib/studio/e2e-backend.prod.ts';

// Variáveis que só existem em dev/e2e: o build de produção as recusa (sessão simulada e banco PGlite em memória).
const VARIAVEIS_SO_DEV = ['LN_STUDIO_TEST_SESSION', 'LN_STUDIO_DEV_DB'] as const;

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
    // Bancos nativos/WASM ficam fora do bundle (pg em produção; PGlite só em dev/e2e: nem a lista de externos o cita em produção).
    serverExternalPackages: devDbSeam.includes('.e2e.') ? ['pg', '@electric-sql/pglite'] : ['pg'],
    // e2e usa diretório de build próprio para não contaminar o artefato de produção.
    distDir: e2eBuild ? '.next-e2e' : '.next',
    turbopack: {
      resolveAlias: { '@ln-studio/e2e-backend': e2eBackendSeam, '@ln-studio/dev-db': devDbSeam },
    },
  };
};

export default config;
