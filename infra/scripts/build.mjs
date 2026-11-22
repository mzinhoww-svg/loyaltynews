#!/usr/bin/env node
// Build reprodutível do monorepo (npm workspaces). Falha no primeiro passo que falhar.
// Uso: node infra/scripts/build.mjs [--skip-install] [--only web|workers]
// Usa os scripts de RAIZ do scaffold (Chief Architect, DEVELOPMENT.md): `lint`, `typecheck` e `build` (= build do @ln/web).
// `--only workers` roda o build de apps/workers (quando a frente 02 criar o workspace).
// Na Vertra o build roda com o `build_command` da app (infra/vertra/environments.json); este script serve a CI e ao dev local.
import { existsSync, writeFileSync } from 'node:fs';
import { parseArgs, npm, fail } from './lib/util.mjs';

const args = parseArgs(process.argv.slice(2));
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) fail(`Node ${process.versions.node} é antigo: exige Node >= 24 (Vertra oferece 24.22 e 26.13)`);
if (!existsSync('package.json')) fail('package.json ausente: rode na raiz do repositório (o scaffold é da frente 02)');

const steps = [];
if (!args['skip-install']) steps.push(['instalar dependências', existsSync('package-lock.json') ? ['ci'] : ['install']]);
steps.push(['lint', ['run', 'lint']]);
steps.push(['typecheck', ['run', 'typecheck']]);
if (args.only === 'workers') {
  if (!existsSync('apps/workers/package.json')) fail('apps/workers ainda não existe (frente 02 Backend)');
  steps.push(['build workers', ['run', 'build', '-w', 'apps/workers']]);
} else {
  steps.push(['build web', ['run', 'build', '-w', 'apps/web']]);
}

for (const [nome, a] of steps) {
  console.log(`\n== ${nome}: npm ${a.join(' ')}`);
  const code = npm(a);
  if (code !== 0) fail(`passo "${nome}" falhou (código ${code})`, code);
}
// A Vertra baixa o código do GitHub sem .git; o commit vem de APP_COMMIT (definido por quem faz o deploy).
writeFileSync('build-info.json', JSON.stringify({ builtAt: new Date().toISOString(), commit: process.env.APP_COMMIT || process.env.GITHUB_SHA || 'desconhecido', node: process.versions.node }, null, 2));
console.log('\nbuild OK');
