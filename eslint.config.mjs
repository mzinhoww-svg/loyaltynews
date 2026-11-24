import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-e2e/**',
      '**/.next-e2e-*/**', // int/017: perfis de build do harness do e2e do portal (ex.: .next-e2e-vitrine; e2e/portal-server.mjs)
      '**/dist/**',
      '**/next-env.d.ts',
      '**/drizzle/**',
      '**/playwright-report/**',
      '**/test-results/**',
      // Pacote de governanca protegido (Python e documentos): fora do lint do produto.
      'tools/**',
      'verifier-kit/**',
      'tests/**',
      'governance/**',
      'contracts/**',
      'docs/**',
      'audit-output/**',
      'prompts/**',
      'originals/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Tipagens de matchers de teste (augmentation): tipos amplos são aceitáveis aqui.
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
