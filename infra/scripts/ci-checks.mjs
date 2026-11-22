#!/usr/bin/env node
// Verificações de CI da frente de infra. Critérios verificáveis de ADR-001 e guarda básica de segredos.
//   1. ADR-001: zero ocorrências de supabase|vercel|pgvector em package.json, package-lock.json e IaC (infra/vertra, .github/workflows).
//   2. ADR-001: CREATE EXTENSION só com extensões *trusted* da lista permitida (migrações em packages/db).
//   3. Segredos: nada que pareça chave privada, token ou string de conexão com senha; nenhum .env versionado (exceto *.example).
// Uso: node infra/scripts/ci-checks.mjs [--root <pasta>]   (código 1 = reprovado)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseArgs } from './lib/util.mjs';

const root = String(parseArgs(process.argv.slice(2)).root || process.cwd());
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage']);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue;
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = (p) => relative(root, p).split(sep).join('/');
const all = walk(root);
const problems = [];

// 1. pilha proibida (ADR-001): só dependências e IaC; documentação pode citar os nomes para proibi-los
const FORBIDDEN = /\b(supabase|vercel|pgvector)\b/i;
for (const f of all) {
  const r = rel(f);
  const isDep = /(^|\/)package\.json$/.test(r) || /(^|\/)package-lock\.json$/.test(r);
  const isIac = r.startsWith('infra/vertra/') || r.startsWith('.github/workflows/');
  if (!isDep && !isIac) continue;
  const m = readFileSync(f, 'utf8').match(FORBIDDEN);
  if (m) problems.push(`ADR-001: "${m[0]}" em ${r}`);
}

// 2. extensões do PostgreSQL (lista da documentação da Vertra: trusted + plpgsql)
const ALLOWED_EXT = new Set(['plpgsql', 'btree_gin', 'btree_gist', 'citext', 'cube', 'dict_int', 'fuzzystrmatch', 'hstore', 'intarray', 'isn', 'lo', 'ltree', 'pg_trgm', 'pgcrypto', 'seg', 'tablefunc', 'tcn', 'tsm_system_rows', 'tsm_system_time', 'unaccent', 'uuid-ossp']);
for (const f of all.filter((x) => rel(x).startsWith('packages/db/') && x.endsWith('.sql'))) {
  const txt = readFileSync(f, 'utf8').replace(/--[^\n]*/g, '');
  for (const m of txt.matchAll(/create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_-]+)"?/gi)) {
    if (!ALLOWED_EXT.has(m[1].toLowerCase())) problems.push(`ADR-001: extensão "${m[1]}" fora da lista trusted em ${rel(f)}`);
  }
}

// 3. segredos
const SECRET_PATTERNS = [
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['token GitHub', /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/],
  ['chave sk-', /\bsk-[A-Za-z0-9_-]{24,}/],
  ['token Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['string de conexão com senha', /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s:@/<>$]+:[^\s@/<>$]+@/i],
];
for (const f of all) {
  const r = rel(f);
  if (/(^|\/)\.env(\.|$)/.test(r) && !/\.example$|\.sample$/.test(r)) problems.push(`segredo: arquivo .env versionado: ${r}`);
  if (statSync(f).size > 2 * 1024 * 1024 || /\.(png|jpe?g|gif|webp|pdf|zip|gz|woff2?|ttf|otf|mp4|xlsx)$/i.test(r)) continue;
  if (r === 'infra/scripts/ci-checks.mjs' || r.startsWith('infra/tests/')) continue; // padrões e fixtures de teste
  const txt = readFileSync(f, 'utf8');
  for (const [nome, re] of SECRET_PATTERNS) if (re.test(txt)) problems.push(`segredo: ${nome} em ${r}`);
}

if (problems.length) {
  console.error('ci-checks REPROVADO:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`ci-checks OK (${all.length} arquivos varridos em ${root})`);
