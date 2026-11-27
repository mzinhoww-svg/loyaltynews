// Worker PRÉ-CONSTRUÍDO (QA 10): package-prebuilt.mjs --tipo workers zera o BUILD= do vertracloud.config, põe o dist no pacote e
// reescreve o manifesto com o sha256/bytes/lista do ZIP FINAL. Rodar: node --test infra/tests/ (precisa de `zip` ou de um bsdtar no PATH).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVazio, zerarBuild } from '../scripts/package-prebuilt.mjs';
import { arquivosDoZip } from '../scripts/lib/zip.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'package-prebuilt.mjs');
const SHA = '30debbc3a7f3b0e9478713c53c53b20983e7c074';
const CMD = 'node infra/scripts/guard-env.mjs && npm run build -w apps/workers';
const put = (f, s) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, s); };

/** Pacote do worker como o package-web --app workers deixa: pasta + manifesto ao lado, BUILD= preenchido. */
function cenario({ tipo = 'workers', cfg = `NAME=ln-workers\nMAIN=package.json\nBUILD=${CMD}\nSTART=node apps/workers/dist/index.js\n`, dist = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ln-pb-w-'));
  const pacote = join(d, 'pacote', 'ln-workers-production-30debbc3a7f3');
  put(join(pacote, 'release.json'), JSON.stringify({ commit: SHA, perfil: 'production', appEnv: 'production', tipo }));
  put(join(pacote, 'vertracloud.config'), cfg);
  put(join(pacote, 'package.json'), '{"name":"loyaltynews"}\n');
  put(join(pacote, 'apps/workers/src/index.ts'), 'export {};\n');
  put(`${pacote}.manifest.json`, JSON.stringify({ commit: SHA, zipSha256: 'do-zip-SEM-o-dist', arquivos: 4 }));
  const distDir = join(d, 'dist');
  if (dist) put(join(distDir, 'index.js'), 'console.log("worker");\n');
  return { d, pacote, distDir, out: join(d, 'prebuilt') };
}
const rodar = ({ pacote, distDir, out }, extra = []) => spawnSync(process.execPath, [SCRIPT, '--tipo', 'workers', '--pacote', pacote, '--dist', distDir, '--out', out, '--origem', 'teste', ...extra], { encoding: 'utf8' });
const temZip = () => spawnSync('zip', ['-v']).status === 0 || spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout?.includes('bsdtar');

test('zerarBuild: só a linha BUILD= perde o comando (LF e CRLF); buildVazio exige exatamente uma linha BUILD= vazia', () => {
  assert.equal(zerarBuild(`NAME=a\nBUILD=${CMD}\nSTART=x`), 'NAME=a\nBUILD=\nSTART=x');
  assert.equal(zerarBuild(`NAME=a\r\nBUILD=${CMD}\r\nSTART=x\r\n`), 'NAME=a\nBUILD=\nSTART=x\n');
  assert.equal(zerarBuild('NAME=a\nSTART=x'), 'NAME=a\nSTART=x');
  assert.equal(zerarBuild('NAME=a\n#BUILD=y\n'), 'NAME=a\n#BUILD=y\n', 'linha que não começa com BUILD= fica');
  assert.ok(buildVazio('NAME=a\nBUILD=\nSTART=x'));
  assert.ok(!buildVazio(`BUILD=${CMD}`), 'comando presente');
  assert.ok(!buildVazio('NAME=a'), 'sem linha BUILD=');
  assert.ok(!buildVazio('BUILD=\nBUILD='), 'duas linhas BUILD=');
});

test('--tipo workers: BUILD= vazio, dist no pacote, release.json prebuilt e manifesto do ZIP FINAL (sha256, bytes, lista)', (t) => {
  if (!temZip()) { t.skip('sem zip nem bsdtar'); return; }
  const c = cenario();
  try {
    const r = rodar(c);
    assert.equal(r.status, 0, r.stderr);
    const nome = 'ln-workers-production-30debbc3a7f3-prebuilt';
    const pasta = join(c.out, nome);
    const zip = join(c.out, `${nome}.zip`);
    const cfg = readFileSync(join(pasta, 'vertracloud.config'), 'utf8');
    assert.match(cfg, /^BUILD=$/m);
    assert.ok(!cfg.includes(CMD), 'o comando de build sobrou no config');
    assert.equal(readFileSync(join(pasta, 'apps/workers/dist/index.js'), 'utf8'), 'console.log("worker");\n');
    const rel = JSON.parse(readFileSync(join(pasta, 'release.json'), 'utf8'));
    assert.deepEqual([rel.prebuilt, rel.buildCommandVazio, rel.commit], [true, true, SHA]);
    const man = JSON.parse(readFileSync(join(c.out, `${nome}.manifest.json`), 'utf8'));
    assert.equal(man.zipSha256, createHash('sha256').update(readFileSync(zip)).digest('hex'), 'o manifesto não aponta para o ZIP final');
    assert.equal(man.zipBytes, statSync(zip).size);
    const entradas = arquivosDoZip(zip);
    assert.equal(man.arquivos, entradas.length);
    assert.deepEqual(man.zipFiles, entradas);
    assert.ok(entradas.includes('apps/workers/dist/index.js'), 'o dist não está no ZIP');
    assert.ok(entradas.includes('vertracloud.config'));
    assert.equal(man.buildCommand, '(vazio)');
    assert.equal(man.prebuilt.distIndexSha256, createHash('sha256').update('console.log("worker");\n').digest('hex'));
    // o pacote de origem não é alterado (o ZIP sem o dist continua o que era)
    assert.match(readFileSync(join(c.pacote, 'vertracloud.config'), 'utf8'), new RegExp(`^BUILD=${CMD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  } finally { rmSync(c.d, { recursive: true, force: true }); }
});

test('--tipo workers: config com CRLF também sai com BUILD= vazio', (t) => {
  if (!temZip()) { t.skip('sem zip nem bsdtar'); return; }
  const c = cenario({ cfg: `NAME=ln-workers\r\nBUILD=${CMD}\r\nSTART=node apps/workers/dist/index.js\r\n` });
  try {
    assert.equal(rodar(c).status, 0);
    assert.ok(buildVazio(readFileSync(join(c.out, 'ln-workers-production-30debbc3a7f3-prebuilt', 'vertracloud.config'), 'utf8')));
  } finally { rmSync(c.d, { recursive: true, force: true }); }
});

test('--tipo workers recusa (controles negativos): pacote do web, dist sem index.js, pacote já pré-construído, saída existente sem --force', () => {
  const web = cenario({ tipo: 'web' });
  const semDist = cenario({ dist: false });
  try {
    const a = rodar(web);
    assert.equal(a.status, 2); assert.match(a.stderr, /exige o pacote do worker \(release\.tipo=web\)/);
    const b = rodar(semDist);
    assert.equal(b.status, 2); assert.match(b.stderr, /--dist sem index\.js/);
  } finally { rmSync(web.d, { recursive: true, force: true }); rmSync(semDist.d, { recursive: true, force: true }); }
  const pre = cenario();
  try {
    put(join(pre.pacote, 'release.json'), JSON.stringify({ commit: SHA, tipo: 'workers', prebuilt: true }));
    const r = rodar(pre);
    assert.equal(r.status, 2); assert.match(r.stderr, /já é pré-construído/);
  } finally { rmSync(pre.d, { recursive: true, force: true }); }
  const dup = cenario();
  try {
    mkdirSync(join(dup.out, 'ln-workers-production-30debbc3a7f3-prebuilt'), { recursive: true });
    const r = rodar(dup);
    assert.equal(r.status, 2); assert.match(r.stderr, /use --force/);
  } finally { rmSync(dup.d, { recursive: true, force: true }); }
});

test('fluxo do web inalterado: sem --tipo, o pacote do worker continua recusado com a mensagem de sempre; --tipo inválido é recusado', () => {
  const c = cenario();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--pacote', c.pacote, '--next', c.distDir, '--out', c.out, '--origem', 'teste'], { encoding: 'utf8' });
    assert.equal(r.status, 2); assert.match(r.stderr, /só o pacote do web pode ser pré-construído \(release\.tipo=workers\)/);
    const x = spawnSync(process.execPath, [SCRIPT, '--tipo', 'bot', '--pacote', c.pacote], { encoding: 'utf8' });
    assert.equal(x.status, 2); assert.match(x.stderr, /--tipo deve ser web \(padrão\) ou workers/);
  } finally { rmSync(c.d, { recursive: true, force: true }); }
});
