import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants';
import type { NextConfig } from 'next';

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
    // Upload de mídia pelo Studio (server action multipart): PDF até 10 MB + metadados.
    experimental: { serverActions: { bodySizeLimit: '11mb' } },
    // Bancos nativos/WASM ficam fora do bundle (pg em produção; PGlite só em dev/e2e: nem a lista de externos o cita em produção).
    serverExternalPackages: devDbSeam.includes('.e2e.') ? ['pg', '@electric-sql/pglite'] : ['pg'],
    // Mesma raiz para o rastreamento de arquivos do build (evita aviso de múltiplos lockfiles e inferência por HOME).
    outputFileTracingRoot: monorepoRoot,
    // e2e usa diretório de build próprio para não contaminar o artefato de produção.
    distDir: e2eBuild ? '.next-e2e' : '.next',
    turbopack: {
      root: monorepoRoot,
      resolveAlias: { '@ln-studio/e2e-backend': e2eBackendSeam, '@ln-studio/dev-db': devDbSeam },
    },
  };
};

export default config;
