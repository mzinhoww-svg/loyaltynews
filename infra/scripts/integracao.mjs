#!/usr/bin/env node
// Monta (ou refaz) o branch de integração para o staging: base + merges por SHA EXATO, e verifica o conjunto.
// Reprodutível: o branch é recriado a partir da base a cada execução (a versão anterior fica em <branch>-anterior).
// Não faz push, não escreve na Vertra, não altera os branches de origem.
// Uso: node infra/scripts/integracao.mjs --repo <clone base> --worktree <pasta> [--branch ft/integracao]
//        --base ft/scaffold@8d5a4dd --merge ft/portal@cd6a0f5 --merge ft/studio@c865d84 --merge ft/infra   (--merge repetível; sem @sha = ponta atual)
//        [--verify] [--report <arquivo.json>]
// --verify roda, nesta ordem: npm install, lint, typecheck, test, build do apps/web, verify:no-mock do Studio e ci-checks --deploy.
// Conflito de merge: aborta o merge, lista os arquivos e sai com código 2 (resolver na origem, com o dono da pasta).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.lastIndexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
const merges = argv.flatMap((a, i) => (a === '--merge' && argv[i + 1] ? [argv[i + 1]] : []));
const repo = opt('repo') && resolve(opt('repo'));
const worktree = opt('worktree') && resolve(opt('worktree'));
const branch = opt('branch') || 'ft/integracao';
const baseSpec = opt('base');
const verify = argv.includes('--verify');
const reportPath = opt('report') && resolve(opt('report'));
if (!repo || !worktree || !baseSpec) { console.error('use --repo, --worktree e --base ref@sha'); process.exit(2); }

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'LN DevOps Engineer', GIT_AUTHOR_EMAIL: 'ln-devops@example.invalid', GIT_COMMITTER_NAME: 'LN DevOps Engineer', GIT_COMMITTER_EMAIL: 'ln-devops@example.invalid' };
const g = (cwd, args) => spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', env: gitEnv });
const gOut = (cwd, args) => { const r = g(cwd, args); if (r.status !== 0) throw new Error(`git ${args[0]}: ${(r.stderr || '').trim().slice(0, 300)}`); return r.stdout.trim(); };

function spec(s) { const [ref, sha] = s.split('@'); return { ref, sha: sha || gOut(repo, ['rev-parse', '--short=7', ref]) }; }
const report = { geradoEm: new Date().toISOString(), repo, worktree, branch, base: null, merges: [], verificacao: [], ok: false };
const save = () => { if (reportPath) { mkdirSync(dirname(reportPath), { recursive: true }); writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); } };
const finish = (code, msg) => { if (msg) console.error(msg); save(); console.log(JSON.stringify({ ok: report.ok, branch, head: report.head, base: report.base, merges: report.merges.map((m) => `${m.ref}@${m.sha}`), verificacao: report.verificacao.map((v) => `${v.etapa}: ${v.ok ? 'ok' : 'FALHOU'}`) }, null, 2)); process.exit(code); };

function main() {
try {
  const base = spec(baseSpec);
  // a SHA pedida tem de ser real e estar contida no ref indicado (evita integrar commit que o dono já reescreveu)
  const checkSha = (s) => {
    const full = gOut(repo, ['rev-parse', '--verify', `${s.sha}^{commit}`]);
    if (g(repo, ['merge-base', '--is-ancestor', full, s.ref]).status !== 0) throw new Error(`${s.sha} não está contido em ${s.ref} (histórico reescrito?)`);
    return full;
  };
  base.full = checkSha(base);
  report.base = `${base.ref}@${base.sha}`;

  if (existsSync(worktree)) {
    if (gOut(worktree, ['status', '--porcelain'])) throw new Error('worktree tem alterações não commitadas: recusado');
    if (g(repo, ['rev-parse', '--verify', branch]).status === 0) g(repo, ['branch', '-f', `${branch}-anterior`, branch]);
    gOut(worktree, ['checkout', '-q', branch]);
    gOut(worktree, ['reset', '-q', '--hard', base.full]);
  } else {
    if (g(repo, ['rev-parse', '--verify', branch]).status === 0) g(repo, ['branch', '-f', `${branch}-anterior`, branch]);
    gOut(repo, ['worktree', 'add', '-q', '-B', branch, worktree, base.full]);
  }

  for (const m of merges) {
    const s = spec(m);
    s.full = checkSha(s);
    const r = g(worktree, ['merge', '--no-ff', '-m', `integracao: merge ${s.ref} (${s.sha})`, s.full]);
    if (r.status !== 0) {
      const conflitos = g(worktree, ['diff', '--name-only', '--diff-filter=U']).stdout.split('\n').filter(Boolean);
      g(worktree, ['merge', '--abort']);
      report.merges.push({ ref: s.ref, sha: s.sha, ok: false, conflitos });
      return finish(2, `CONFLITO ao integrar ${s.ref}@${s.sha}: ${conflitos.join(', ') || (r.stderr || '').trim().slice(0, 200)}`);
    }
    report.merges.push({ ref: s.ref, sha: s.sha, ok: true });
  }
  report.head = gOut(worktree, ['rev-parse', 'HEAD']);

  if (verify) {
    const win = process.platform === 'win32';
    const cleanEnv = { ...process.env }; for (const k of ['CI', 'LN_STUDIO_TEST_SESSION', 'PORTAL_SOURCE', 'PORTAL_MODE', 'LN_E2E_BUILD']) delete cleanEnv[k];
    const steps = [
      ['npm install', win ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], true],
      ['lint', win ? 'npm.cmd' : 'npm', ['run', 'lint'], true],
      ['typecheck', win ? 'npm.cmd' : 'npm', ['run', 'typecheck'], true],
      ['test', win ? 'npm.cmd' : 'npm', ['test'], true],
      ['build apps/web', win ? 'npm.cmd' : 'npm', ['run', 'build', '-w', 'apps/web'], true],
      ['verify:no-mock (Studio)', win ? 'npm.cmd' : 'npm', ['run', 'verify:no-mock', '-w', 'apps/web'], true],
      ['ci-checks --deploy', process.execPath, [existsSync(join(worktree, 'infra/scripts/ci-checks.mjs')) ? join(worktree, 'infra/scripts/ci-checks.mjs') : join(SELF, 'ci-checks.mjs'), '--deploy', '--root', worktree], false],
    ];
    for (const [etapa, cmd, a, shell] of steps) {
      const t0 = Date.now();
      const r = spawnSync(cmd, a, { cwd: worktree, encoding: 'utf8', shell, env: cleanEnv, maxBuffer: 256 * 1024 * 1024, timeout: 15 * 60 * 1000 });
      const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split(/\r?\n/);
      const ok = r.status === 0;
      report.verificacao.push({ etapa, ok, segundos: Math.round((Date.now() - t0) / 1000), cauda: out.slice(-15) });
      console.error(`[${ok ? 'ok' : 'FALHOU'}] ${etapa} (${Math.round((Date.now() - t0) / 1000)} s)`);
      if (!ok) return finish(1, `verificação falhou em "${etapa}"`);
    }
  }
  report.ok = true;
  finish(0);
} catch (e) {
  finish(1, `ERRO: ${e.message}`);
}
}
main();
