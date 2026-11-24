// Testes do web PRÉ-CONSTRUÍDO (opção B, 24/11/2026): lib/prebuilt.mjs, o gancho do start-web e o package-prebuilt. Rodar: node --test infra/tests/ (pelo PowerShell: o package-prebuilt usa o tar do sistema para o ZIP)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { pacoteDoExterno, problemasPrebuilt, restaurarPrebuilt } from '../scripts/lib/prebuilt.mjs';
import { caminhosNaoPortaveis } from '../scripts/package-prebuilt.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const tmp = () => mkdtempSync(join(tmpdir(), 'ln-prebuilt-test-'));
const put = (root, rel, txt) => { const p = join(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, txt); };
const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const SITE = 'https://loyaltynews-stg.vertraweb.app';
const HOME = (canon = SITE) => `<html><head><link rel="canonical" href="${canon}"/><meta name="robots" content="noindex"/></head><body>ok</body></html>`;
const EXT = [{ nome: 'pg-0123456789abcdef', pacote: 'pg' }];
const BARRA = String.fromCharCode(92);

/** Pacote fictício já instalado (node_modules/next e pg) com um prebuilt coerente; `pb` e `rel` sobrepõem campos. */
function pacote({ pb = {}, rel = {}, home = HOME(), pg = true, buildIdPasta = 'BUILD_abc123' } = {}) {
  const r = tmp();
  put(r, 'package.json', '{}');
  put(r, 'release.json', JSON.stringify({ commit: SHA, appEnv: 'staging', siteUrl: SITE, vitrine: false, indexavel: false, flagsLigadas: ['intelligencePessoas'], tipo: 'web', perfil: 'staging', ...rel }));
  put(r, 'prebuilt/prebuilt.json', JSON.stringify({ schema: 1, commit: SHA, appEnv: 'staging', siteUrl: SITE, vitrine: false, indexavel: false, flagsLigadas: ['intelligencePessoas'], buildId: 'BUILD_abc123', nextVersion: '16.4.6', externos: EXT, ...pb }));
  put(r, 'prebuilt/web-next/BUILD_ID', buildIdPasta);
  put(r, 'prebuilt/web-next/server/app/index.html', home);
  put(r, 'node_modules/next/package.json', '{"version":"16.4.6"}');
  put(r, 'node_modules/next/dist/bin/next', 'console.log("stub-next " + process.argv.slice(2).join(" "));');
  if (pg) put(r, 'node_modules/pg/package.json', '{}');
  mkdirSync(join(r, 'apps', 'web'), { recursive: true });
  return r;
}
const limpa = (r) => { try { unlinkSync(join(r, 'apps/web/.next/node_modules/pg-0123456789abcdef')); } catch { /* sem link */ } rmSync(r, { recursive: true, force: true }); };
const release = (r) => JSON.parse(readFileSync(join(r, 'release.json'), 'utf8'));

test('pacoteDoExterno: tira o sufixo de 16 hex do Turbopack; sem o sufixo = null', () => {
  assert.equal(pacoteDoExterno('pg-587764f78a6c7a9c'), 'pg');
  assert.equal(pacoteDoExterno('sharp-20c6a5da84e2135f'), 'sharp');
  assert.equal(pacoteDoExterno('@scope/x-0123456789abcdef'), '@scope/x');
  assert.equal(pacoteDoExterno('pg'), null);
  assert.equal(pacoteDoExterno('pg-curto'), null);
});

test('problemasPrebuilt: coerente = nenhum problema; cada divergência com o release.json é recusada (controles negativos)', () => {
  const rel = { commit: SHA, appEnv: 'staging', siteUrl: SITE, vitrine: false, indexavel: false, flagsLigadas: ['intelligencePessoas'] };
  const pb = { commit: SHA, appEnv: 'staging', siteUrl: SITE, vitrine: false, indexavel: false, flagsLigadas: ['intelligencePessoas'], buildId: 'BUILD_abc123', nextVersion: '16.4.6', externos: EXT };
  assert.deepEqual(problemasPrebuilt(pb, rel, '16.4.6'), []);
  assert.match(problemasPrebuilt({ ...pb, commit: SHA2 }, rel, '16.4.6').join('|'), /é do commit bbbbbbbbbbbb e o pacote é do aaaaaaaaaaaa/);
  assert.match(problemasPrebuilt({ ...pb, appEnv: 'production' }, rel, '16.4.6').join('|'), /appEnv do pré-construído/);
  assert.match(problemasPrebuilt({ ...pb, siteUrl: 'https://outro.exemplo' }, rel, '16.4.6').join('|'), /siteUrl do pré-construído/);
  assert.match(problemasPrebuilt({ ...pb, indexavel: true }, rel, '16.4.6').join('|'), /indexavel/);
  assert.match(problemasPrebuilt({ ...pb, vitrine: true }, rel, '16.4.6').join('|'), /vitrine/);
  assert.match(problemasPrebuilt({ ...pb, flagsLigadas: [] }, rel, '16.4.6').join('|'), /flagsLigadas/);
  assert.match(problemasPrebuilt(pb, rel, '16.5.0').join('|'), /next 16.5.0 instalado difere do next 16.4.6/);
  assert.match(problemasPrebuilt({ ...pb, buildId: '' }, rel, '16.4.6').join('|'), /sem buildId/);
  assert.match(problemasPrebuilt({ ...pb, externos: [{ nome: 'pg', pacote: null }] }, rel, '16.4.6').join('|'), /sem nome de pacote/);
  assert.match(problemasPrebuilt(null, rel).join('|'), /ilegível/);
});

test('restaurarPrebuilt: restaura o .next, recria o link do externo, é idempotente e a home confere; sem prebuilt.json (pacote comum) não faz nada', () => {
  const r = pacote();
  try {
    const a = restaurarPrebuilt(r, release(r));
    assert.equal(a.ativo, true);
    assert.deepEqual(a.problemas, []);
    assert.equal(readFileSync(join(r, 'apps/web/.next/BUILD_ID'), 'utf8').trim(), 'BUILD_abc123');
    assert.equal(lstatSync(join(r, 'apps/web/.next/node_modules/pg-0123456789abcdef')).isSymbolicLink(), true);
    assert.ok(existsSync(join(r, 'apps/web/.next/node_modules/pg-0123456789abcdef/package.json')), 'o link aponta para node_modules/pg');
    assert.match(a.log.join('|'), /\.next restaurado/);
    const b = restaurarPrebuilt(r, release(r));
    assert.deepEqual(b.problemas, []);
    assert.match(b.log.join('|'), /\.next já presente/, 'segunda subida: não copia de novo');
  } finally { limpa(r); }
  const comum = tmp();
  try {
    put(comum, 'release.json', JSON.stringify({ commit: SHA }));
    const c = restaurarPrebuilt(comum, release(comum));
    assert.deepEqual(c, { ativo: false, problemas: [], log: [] });
    assert.equal(existsSync(join(comum, 'apps')), false, 'pacote comum não ganha .next nem pastas');
  } finally { rmSync(comum, { recursive: true, force: true }); }
});

test('restaurarPrebuilt: recusa .next de outro commit, externo não instalado, BUILD_ID adulterado, home com canonical errado e home sem noindex (controles negativos)', () => {
  const casos = [
    [{ pb: { commit: SHA2 } }, /é do commit bbbbbbbbbbbb/],
    [{ pg: false }, /externo pg não está em node_modules/],
    [{ buildIdPasta: 'OUTRO_ID_999' }, /BUILD_ID da pasta \(OUTRO_ID_999\) difere do prebuilt.json/],
    [{ home: HOME('http://localhost:3000') }, /canonical da home/],
    [{ home: `<html><head><link rel="canonical" href="${SITE}"/></head></html>` }, /noindex/],
  ];
  for (const [opts, esperado] of casos) {
    const r = pacote(opts);
    try {
      const x = restaurarPrebuilt(r, release(r));
      assert.equal(x.ativo, true);
      assert.match(x.problemas.join('|'), esperado, JSON.stringify(Object.keys(opts)));
    } finally { limpa(r); }
  }
  const r = pacote();
  try { rmSync(join(r, 'prebuilt/web-next'), { recursive: true, force: true }); assert.match(restaurarPrebuilt(r, release(r)).problemas.join('|'), /sem BUILD_ID/); } finally { limpa(r); }
});

test('start-web: com pré-construído coerente sobe (chama o next) e imprime prebuilt ok; com .next de outro commit recusa com exit 1 SEM chamar o next; pacote comum não imprime nada de prebuilt', () => {
  const env = (r) => ({ ...process.env, APP_ENV: 'staging', NEXT_PUBLIC_SITE_URL: SITE, APP_COMMIT: SHA, LN_FLAGS_ON: 'intelligencePessoas', PORTAL_SOURCE: 'api' });
  const rodar = (r) => spawnSync(process.execPath, [join(S, 'start-web.mjs'), '--port', '3999', '--host', '127.0.0.1'], { cwd: r, encoding: 'utf8', env: env(r) });
  const ok = pacote();
  try {
    const x = rodar(ok);
    assert.equal(x.status, 0, x.stderr + x.stdout);
    assert.match(x.stdout, /\[start-web\] prebuilt: \.next restaurado/);
    assert.match(x.stdout, /\[start-web\] prebuilt ok/);
    assert.match(x.stdout, /stub-next .*start -p 3999 -H 127\.0\.0\.1/, 'o next foi chamado depois da restauração');
  } finally { limpa(ok); }
  const ruim = pacote({ pb: { commit: SHA2 } });
  try {
    const x = rodar(ruim);
    assert.equal(x.status, 1);
    assert.match(x.stderr, /PRÉ-CONSTRUÍDO REPROVADO/);
    assert.doesNotMatch(x.stdout, /stub-next/, 'recusado antes de chamar o next');
  } finally { limpa(ruim); }
  const comum = pacote();
  try {
    rmSync(join(comum, 'prebuilt'), { recursive: true, force: true });
    const x = rodar(comum);
    assert.equal(x.status, 0, x.stderr + x.stdout);
    assert.doesNotMatch(x.stdout, /prebuilt/, 'pacote comum não muda de comportamento');
  } finally { limpa(comum); }
});

test('caminhosNaoPortaveis: acha caminho de host Windows/usuário e ignora caminho /app', () => {
  assert.ok(caminhosNaoPortaveis(`{"appDir":"C:${BARRA}Users${BARRA}x${BARRA}proj"}`).length > 0);
  assert.ok(caminhosNaoPortaveis('{"appDir":"/c/Users/mazin/OpenBot/x"}').length > 0);
  assert.ok(caminhosNaoPortaveis('{"appDir":"/home/runner/work/x"}').length > 0);
  assert.deepEqual(caminhosNaoPortaveis('{"appDir":"/app/apps/web","outputFileTracingRoot":"/app"}'), []);
});

function nextFalso({ requerido = '{"version":1,"appDir":"/app/apps/web"}' } = {}) {
  const n = tmp();
  put(n, 'BUILD_ID', 'BUILD_abc123');
  put(n, 'required-server-files.json', requerido);
  put(n, 'routes-manifest.json', '{"version":3}');
  put(n, 'build-manifest.json', '{}');
  put(n, 'server/app/index.html', HOME());
  put(n, 'static/chunks/a.js', 'x');
  put(n, 'cache/grande.bin', 'nao deve entrar');
  put(n, 'trace', 'nao deve entrar');
  mkdirSync(join(n, 'node_modules', 'pg-0123456789abcdef'), { recursive: true });
  return n;
}
function pacoteDeBuild() {
  const base = tmp();
  const pasta = join(base, 'ln-web-staging-aaaaaaaaaaaa-loyaltynews-stg-flags');
  put(pasta, 'package.json', '{"name":"x"}');
  put(pasta, 'package-lock.json', JSON.stringify({ packages: { 'node_modules/next': { version: '16.4.6' } } }));
  put(pasta, 'release.json', JSON.stringify({ commit: SHA, perfil: 'staging', appEnv: 'staging', siteUrl: SITE, vitrine: false, indexavel: false, flagsLigadas: ['intelligencePessoas'], tipo: 'web' }));
  put(pasta, 'vertracloud.config', 'NAME=ln-staging-web\nMAIN=package.json\nBUILD=node infra/scripts/guard-env.mjs && node infra/scripts/build-web.mjs\nSTART=node infra/scripts/guard-env.mjs && node infra/scripts/start-web.mjs\n');
  put(pasta, 'apps/web/app/page.tsx', 'export default function P(){return null}');
  writeFileSync(join(base, 'ln-web-staging-aaaaaaaaaaaa-loyaltynews-stg-flags.manifest.json'), JSON.stringify({ app: 'ln-staging-web', commit: SHA }));
  return { base, pasta };
}

test('package-prebuilt: monta o pacote com build vazio, .next em prebuilt/web-next (sem cache, sem node_modules), manifesto, overlays e ZIP; recusa .next com caminho do host Windows', () => {
  const { base, pasta } = pacoteDeBuild();
  const nx = nextFalso();
  const out = join(base, 'saida');
  try {
    const r = spawnSync(process.execPath, [join(S, 'package-prebuilt.mjs'), '--pacote', pasta, '--next', nx, '--out', out, '--origem', 'teste'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
    assert.match(j.zipSha256, /^[0-9a-f]{64}$/);
    const pf = j.pasta;
    assert.equal(readFileSync(join(pf, 'prebuilt/web-next/BUILD_ID'), 'utf8'), 'BUILD_abc123');
    assert.ok(existsSync(join(pf, 'prebuilt/web-next/static/chunks/a.js')));
    assert.equal(existsSync(join(pf, 'prebuilt/web-next/cache')), false, 'cache do .next fica de fora');
    assert.equal(existsSync(join(pf, 'prebuilt/web-next/trace')), false);
    assert.equal(existsSync(join(pf, 'prebuilt/web-next/node_modules')), false, 'os links dos externos são recriados no start, não vão no ZIP');
    assert.match(readFileSync(join(pf, 'vertracloud.config'), 'utf8'), /^BUILD=$/m, 'build_command vazio');
    assert.match(readFileSync(join(pf, 'vertracloud.config'), 'utf8'), /START=node infra\/scripts\/guard-env\.mjs && node infra\/scripts\/start-web\.mjs/);
    const rel = JSON.parse(readFileSync(join(pf, 'release.json'), 'utf8'));
    assert.equal(rel.prebuilt, true);
    assert.equal(rel.commit, SHA);
    const pb = JSON.parse(readFileSync(join(pf, 'prebuilt/prebuilt.json'), 'utf8'));
    assert.deepEqual({ commit: pb.commit, buildId: pb.buildId, nextVersion: pb.nextVersion, flagsLigadas: pb.flagsLigadas }, { commit: SHA, buildId: 'BUILD_abc123', nextVersion: '16.4.6', flagsLigadas: ['intelligencePessoas'] });
    assert.deepEqual(pb.externos, [{ nome: 'pg-0123456789abcdef', pacote: 'pg' }]);
    assert.ok(existsSync(join(pf, 'infra/scripts/start-web.mjs')) && existsSync(join(pf, 'infra/scripts/lib/prebuilt.mjs')), 'overlay do start-web e da restauração');
    assert.ok(existsSync(j.zip) && existsSync(j.manifesto));
    // controle negativo: .next construído no Windows
    const ruim = nextFalso({ requerido: `{"appDir":"C:${BARRA}Users${BARRA}dev${BARRA}proj${BARRA}apps${BARRA}web"}` });
    try {
      const x = spawnSync(process.execPath, [join(S, 'package-prebuilt.mjs'), '--pacote', pasta, '--next', ruim, '--out', join(base, 'saida2'), '--origem', 'teste'], { encoding: 'utf8' });
      assert.equal(x.status, 2);
      assert.match(x.stderr, /caminho\(s\) do host de build/);
      assert.equal(existsSync(join(base, 'saida2')), false, 'recusado antes de criar saída');
    } finally { rmSync(ruim, { recursive: true, force: true }); }
    // segunda execução sem --force não sobrescreve
    const dup = spawnSync(process.execPath, [join(S, 'package-prebuilt.mjs'), '--pacote', pasta, '--next', nx, '--out', out, '--origem', 'teste'], { encoding: 'utf8' });
    assert.notEqual(dup.status, 0);
  } finally { rmSync(base, { recursive: true, force: true }); rmSync(nx, { recursive: true, force: true }); }
});

test('package-web inclui no pacote TUDO que o start-web importa (lib/prebuilt.mjs entre eles); sem isso a subida de qualquer pacote quebraria', () => {
  const pw = readFileSync(join(S, 'package-web.mjs'), 'utf8');
  const incluidos = [...pw.matchAll(/'(infra\/scripts\/[^']+\.mjs)'/g)].map((m) => m[1]);
  for (const arq of ['start-web.mjs', 'build-web.mjs']) {
    const src = readFileSync(join(S, arq), 'utf8');
    for (const m of src.matchAll(/from '(\.\/[^']+\.mjs)'/g)) {
      const rel = 'infra/scripts/' + m[1].replace(/^\.\//, '');
      assert.ok(incluidos.includes(rel), `${arq} importa ${m[1]}, mas o package-web não inclui ${rel}`);
    }
  }
  // o que lib/prebuilt.mjs importa (build-web.mjs) também entra
  for (const m of readFileSync(join(S, 'lib', 'prebuilt.mjs'), 'utf8').matchAll(/from '\.\.\/([^']+\.mjs)'/g)) assert.ok(incluidos.includes('infra/scripts/' + m[1]), `prebuilt.mjs importa ../${m[1]}`);
});
