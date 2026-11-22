import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
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
    // Tipagens de matchers de teste (augmentation) e testes do UI: tipos amplos são aceitáveis aqui.
    files: ['**/*.d.ts', 'packages/ui/test/**'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
