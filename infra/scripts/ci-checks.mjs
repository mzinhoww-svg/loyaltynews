#!/usr/bin/env node
// Verificações de CI da frente de infra. Critérios verificáveis de ADR-001 e guarda básica de segredos.
//   1. ADR-001: zero ocorrências de supabase|vercel|pgvector em package.json, package-lock.json e IaC (infra/vertra, .github/workflows).
//   2. ADR-001: CREATE EXTENSION só com extensões *trusted* da lista permitida (migrações em packages/db).
//   3. Segredos: nada que pareça chave privada, token ou string de conexão com senha; nenhum .env versionado (exceto *.example).
//   4. Variáveis só de teste: LN_STUDIO_TEST_SESSION não pode existir no ambiente nem no build nem em arquivos de deploy;
//      PORTAL_SOURCE/PORTAL_MODE=mock só em teste (modo estrito com --deploy ou APP_ENV=staging|production).
// Uso: node infra/scripts/ci-checks.mjs [--root <pasta>] [--deploy]   (código 1 = reprovado)
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parseArgs } from './lib/util.mjs';
import { envProblems, ASSIGN_STUDIO, ASSIGN_PORTAL_MOCK, ASSIGN_VITRINE } from './lib/guards.mjs';

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
const FORBIDDEN = /(^|[^a-z0-9])(supabase|vercel|pgvector)([^a-z0-9]|$)/i;
for (const f of all) {
  const r = rel(f);
  const isLock = /(^|\/)package-lock\.json$/.test(r);
  const isDep = /(^|\/)package\.json$/.test(r);
  const isIac = r.startsWith('infra/vertra/') || r.startsWith('.github/workflows/');
  if (!isDep && !isIac && !isLock) continue;
  const txt = readFileSync(f, 'utf8');
  if (isLock) {
    // Lockfile: só pacotes INSTALADOS contam. Peers opcionais (ex.: drizzle-orm lista "@vercel/postgres" como
    // peerDependenciesMeta optional) são texto, não dependência: não instalam nada.
    let lock;
    try { lock = JSON.parse(txt); } catch { problems.push(`ADR-001: ${r} ilegível (JSON inválido)`); continue; }
    for (const key of Object.keys(lock.packages || {})) {
      const name = key.split('node_modules/').pop();
      const m = name && name.match(FORBIDDEN);
      if (m) problems.push(`ADR-001: pacote instalado "${name}" em ${r}`);
    }
    continue;
  }
  const m = txt.match(FORBIDDEN);
  if (m) problems.push(`ADR-001: "${m[2]}" em ${r}`);
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
  // exige corpo longo: um PEM de teste com 4 caracteres (fixture) não é chave; chave real tem centenas de caracteres
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=\s]{64,}/],
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

/** Texto sem comentários (comentário que CITA `PORTAL_VITRINE=1` não é atribuição). Só para a checagem da vitrine. */
function semComentarios(txt, r) {
  if (/\.ya?ml$|(^|\/)Dockerfile/.test(r)) return txt.replace(/(^|\s)#.*$/gm, '$1');
  return txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// 4. variáveis só de teste (alerta do PM): nunca no ambiente, no build nem em arquivos de deploy
const argv = parseArgs(process.argv.slice(2));
for (const msg of envProblems(process.env, { deploy: Boolean(argv.deploy) })) problems.push(`ambiente: ${msg}`);
for (const f of all) {
  const r = rel(f);
  if (r.startsWith('infra/tests/') || r === 'infra/scripts/lib/guards.mjs') continue; // fixtures e definições dos próprios padrões
  const isDeployCfg = r.startsWith('infra/vertra/') || r.startsWith('.github/workflows/') || /(^|\/)next\.config\.[cm]?[jt]s$/.test(r) || /(^|\/)Dockerfile/.test(r);
  const isPkg = /(^|\/)package\.json$/.test(r);
  if (!isDeployCfg && !isPkg) continue;
  const txt = readFileSync(f, 'utf8');
  if (isPkg) {
    let scripts = {};
    try { scripts = JSON.parse(txt).scripts || {}; } catch { /* já reportado em outra checagem */ }
    for (const [nome, cmd] of Object.entries(scripts)) {
      if (/e2e|test/i.test(nome)) continue; // scripts de teste podem usar as variáveis
      if (ASSIGN_STUDIO.test(String(cmd)) || ASSIGN_PORTAL_MOCK.test(String(cmd))) problems.push(`variável só de teste no script "${nome}" de ${r}`);
      if (ASSIGN_VITRINE.test(String(cmd))) problems.push(`PORTAL_VITRINE atribuída no script "${nome}" de ${r}: a vitrine do staging liga-se só pelo release.json do pacote (package-web --vitrine)`);
    }
    continue;
  }
  if (ASSIGN_STUDIO.test(txt)) problems.push(`LN_STUDIO_TEST_SESSION atribuída em ${r}`);
  if (ASSIGN_PORTAL_MOCK.test(txt)) problems.push(`PORTAL_SOURCE/PORTAL_MODE=mock atribuído em ${r}`);
  // Vitrine (Security R8): nunca atribuída em configuração de deploy de PRODUÇÃO. Em environments.json vale só a subárvore ambientes.production
  // (o texto de regras e o contrato citam o nome); em workflows, Dockerfile e next.config qualquer atribuição reprova (a vitrine entra pelo release.json).
  if (r === 'infra/vertra/environments.json') {
    try { if (ASSIGN_VITRINE.test(JSON.stringify(JSON.parse(txt).ambientes?.production ?? {}))) problems.push(`PORTAL_VITRINE atribuída na configuração de produção de ${r}`); } catch { /* JSON inválido é reportado em outra checagem */ }
  } else if (!r.startsWith('infra/vertra/') && ASSIGN_VITRINE.test(semComentarios(txt, r))) {
    problems.push(`PORTAL_VITRINE atribuída em ${r} (configuração de deploy): vitrine só no staging, ligada pelo release.json do pacote`);
  }
  // next.config pode LER a variável para RECUSAR o build (padrão do Studio); o que reprova é injetá-la no build via `env:`/define
  if (/next\.config/.test(r) && /\b(?:env|define)\s*:\s*\{[^}]*(?:LN_STUDIO_TEST_SESSION|PORTAL_(?:SOURCE|MODE))/s.test(txt)) problems.push(`next.config injeta variável só de teste no build: ${r}`);
}

if (problems.length) {
  console.error('ci-checks REPROVADO:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`ci-checks OK (${all.length} arquivos varridos em ${root})`);
