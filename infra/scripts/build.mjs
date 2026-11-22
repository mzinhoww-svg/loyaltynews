#!/usr/bin/env node
// Build reprodutível do monorepo (npm workspaces). Falha no primeiro passo que falhar.
// Uso: node infra/scripts/build.mjs [--skip-install] [--only web|workers]
// Pressupõe os scripts raiz do scaffold (Chief Architect): lint, typecheck e build nos workspaces (usa --if-present).
// Na Vertra o build roda com o `build_command` da app (infra/vertra/environments.json); este script serve a CI e ao dev local.
import { existsSync, writeFileSync } from 'node:fs';
import { parseArgs, npm, fail } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) fail(`Node ${process.versions.node} é antigo: exige Node >= 24 (Vertra oferece 24.22 e 26.13)`);
if (!existsSync('package.json')) fail('package.json ausente: rode na raiz do repositório (o scaffold é da frente 02)');

const steps = [];
if (!args['skip-install']) steps.push(['instalar dependências', existsSync('package-lock.json') ? ['ci'] : ['install']]);
steps.push(['lint', ['run', 'lint', '--workspaces', '--if-present']]);
steps.push(['typecheck', ['run', 'typecheck', '--workspaces', '--if-present']]);
const only = args.only === 'web' ? ['-w', 'apps/web'] : args.only === 'workers' ? ['-w', 'apps/workers'] : ['--workspaces'];
steps.push(['build', ['run', 'build', ...only, '--if-present']]);

for (const [nome, a] of steps) {
  console.log(`\n== ${nome}: npm ${a.join(' ')}`);
  const code = npm(a);
  if (code !== 0) fail(`passo "${nome}" falhou (código ${code})`, code);
}
// A Vertra baixa o código do GitHub sem .git; o commit vem de APP_COMMIT (definido por quem faz o deploy).
writeFileSync('build-info.json', JSON.stringify({ builtAt: new Date().toISOString(), commit: process.env.APP_COMMIT || process.env.GITHUB_SHA || 'desconhecido', node: process.versions.node }, null, 2));
console.log('\nbuild OK');
