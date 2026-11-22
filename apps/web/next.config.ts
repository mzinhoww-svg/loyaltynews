import type { NextConfig } from 'next';

const config: NextConfig = {
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
};

export default config;
