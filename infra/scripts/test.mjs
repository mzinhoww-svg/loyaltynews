#!/usr/bin/env node
// Testes do monorepo + verificações de CI. Uso: node infra/scripts/test.mjs [--skip-ci-checks]
// Ordem: ci-checks (ADR-001 e segredos) → testes de infra (node:test) → `npm test` da raiz (Vitest: pacotes e apps/web/lib).
// O e2e (Playwright, apps/web/e2e) é separado: `npm run e2e` exige build e `npx playwright install chromium` (regra 4 do fast-track).
import { parseArgs, npm, fail, run } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args['skip-ci-checks']) {
  const r = run(process.execPath, ['infra/scripts/ci-checks.mjs']);
  if (r.status !== 0) fail('ci-checks reprovado', 1);
}
const t = run(process.execPath, ['--test', 'infra/tests/']);
if (t.status !== 0) fail('testes de infra falharam', 1);
const code = npm(['test']);
if (code !== 0) fail(`npm test falhou (código ${code})`, code);
console.log('\ntestes OK');
