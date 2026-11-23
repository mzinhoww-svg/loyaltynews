#!/usr/bin/env node
// Barreira de ambiente: reprova (código 1) se existir variável só de teste. Roda ANTES do build e ANTES do start na Vertra
// (build_command e start_command de infra/vertra/environments.json), então o app não sobe nem compila com a sessão simulada
// do Studio ou com fixtures MOCK em staging/produção. Falha fechada. Uso: node infra/scripts/guard-env.mjs [--deploy]
import { parseArgs } from './lib/util.mjs';
import { envProblems } from './lib/guards.mjs';

const args = parseArgs(process.argv.slice(2));
// Na Vertra APP_ENV vem definido (staging|production); fora dela, --deploy força o modo estrito.
const problems = envProblems(process.env, { deploy: Boolean(args.deploy) });
if (problems.length) {
  console.error('guard-env REPROVADO:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`guard-env OK (APP_ENV=${process.env.APP_ENV || 'não definido'})`);
