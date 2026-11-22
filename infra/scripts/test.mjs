#!/usr/bin/env node
// Testes do monorepo + verificações de CI. Uso: node infra/scripts/test.mjs [--skip-ci-checks]
// Os testes unitários e e2e de cada frente rodam por `npm test --workspaces --if-present` (regra 4 do fast-track).
import { parseArgs, npm, fail, run } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
if (!args['skip-ci-checks']) {
  const r = run(process.execPath, ['infra/scripts/ci-checks.mjs']);
  if (r.status !== 0) fail('ci-checks reprovado', 1);
}
const t = run(process.execPath, ['--test', 'infra/tests/']);
if (t.status !== 0) fail('testes de infra falharam', 1);
const code = npm(['test', '--workspaces', '--if-present']);
if (code !== 0) fail(`testes dos workspaces falharam (código ${code})`, code);
console.log('\ntestes OK');
