#!/usr/bin/env node
// Barreira de ambiente: reprova (código 1) se existir variável só de teste. Roda ANTES do build e ANTES do start na Vertra
// (build_command e start_command de infra/vertra/environments.json), então o app não sobe nem compila com a sessão simulada
// do Studio ou com fixtures MOCK em staging/produção. Falha fechada. Uso: node infra/scripts/guard-env.mjs [--deploy]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './lib/util.mjs';
import { envProblems, flagsProblems, jobsProblems } from './lib/guards.mjs';

const args = parseArgs(process.argv.slice(2));
// Na Vertra APP_ENV vem definido (staging|production); fora dela, --deploy força o modo estrito.
const problems = envProblems(process.env, { deploy: Boolean(args.deploy) });
// ADR-022: LN_FLAGS_ON tem de bater com o release.json do pacote (web e worker). Sem release.json (CI, desenvolvimento) só valem as regras de ambiente acima.
const relPath = join(process.cwd(), 'release.json');
if (existsSync(relPath)) {
  try { const rel = JSON.parse(readFileSync(relPath, 'utf8')); problems.push(...flagsProblems(process.env, rel), ...jobsProblems(process.env, rel)); }
  catch { problems.push('release.json ilegível (JSON inválido)'); }
}
if (problems.length) {
  console.error('guard-env REPROVADO:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`guard-env OK (APP_ENV=${process.env.APP_ENV || 'não definido'})`);
