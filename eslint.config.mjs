import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.next-e2e/**',
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
);
