// Testes do web PRÉ-CONSTRUÍDO (opção B, 24/11/2026): lib/prebuilt.mjs, o gancho do start-web e o package-prebuilt. Rodar: node --test infra/tests/ (pelo PowerShell: o package-prebuilt usa o tar do sistema para o ZIP)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, lstatSync, unlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { arquivosFaltando, pacoteDoExterno, problemasPrebuilt, restaurarPrebuilt } from '../scripts/lib/prebuilt.mjs';
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
  put(r, 'prebuilt/prebuilt.json', JSON.stringify({ schema: 1, commit: SHA, appEnv: 'staging', siteUrl: SITE, vitrine: false, indexavel: false, flagsLigadas: ['intelligencePessoas'], buildId: 'BUILD_abc123', nextVersion: '16.4.6', externos: EXT, geradoEm: '2026-11-24T00:00:00.000Z', ...pb }));
  put(r, 'prebuilt/web-next/BUILD_ID', buildIdPasta);
  put(r, 'prebuilt/web-next/server/app/index.html', home);
  // um .next COMPLETO tem os manifestos e os arquivos que eles citam (a restauração confere; antes de 24/11 não conferia)
  put(r, 'prebuilt/web-next/required-server-files.json', JSON.stringify({ version: 1, appDir: '/app/apps/web', files: ['.next/BUILD_ID', '.next/server/app-paths-manifest.json', '.next/required-server-files.json'] }));
  put(r, 'prebuilt/web-next/server/app-paths-manifest.json', JSON.stringify({ '/api/auth/[...all]/route': 'app/api/auth/[...all]/route.js', '/page': 'app/index.html' }));
  put(r, 'prebuilt/web-next/server/app/api/auth/[...all]/route.js', 'x');
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
  const env = () => ({ ...process.env, APP_ENV: 'staging', NEXT_PUBLIC_SITE_URL: SITE, APP_COMMIT: SHA, LN_FLAGS_ON: 'intelligencePessoas', PORTAL_SOURCE: 'api' });
  const rodar = (r) => spawnSync(process.execPath, [join(S, 'start-web.mjs'), '--port', '3999', '--host', '127.0.0.1'], { cwd: r, encoding: 'utf8', env: env() });
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

function nextFalso({ requerido = '{"version":1,"appDir":"/app/apps/web","files":[".next/BUILD_ID",".next/server/app-paths-manifest.json"]}' } = {}) {
  const n = tmp();
  put(n, 'BUILD_ID', 'BUILD_abc123');
  put(n, 'required-server-files.json', requerido);
  put(n, 'routes-manifest.json', '{"version":3}');
  put(n, 'build-manifest.json', '{}');
  put(n, 'server/app/index.html', HOME());
  put(n, 'server/app-paths-manifest.json', JSON.stringify({ '/api/auth/[...all]/route': 'app/api/auth/[...all]/route.js', '/page': 'app/index.html' }));
  put(n, 'server/app/api/auth/[...all]/route.js', 'x');
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
    // controle negativo: pasta que o deploy_app/painel remove do upload (vendor) dentro do .next
    const comVendor = nextFalso(); put(comVendor, 'server/vendor/x.js', 'x');
    try {
      const v = spawnSync(process.execPath, [join(S, 'package-prebuilt.mjs'), '--pacote', pasta, '--next', comVendor, '--out', join(base, 'saida3'), '--origem', 'teste'], { encoding: 'utf8' });
      assert.notEqual(v.status, 0);
      assert.match(v.stderr, /arquivos proibidos no pacote: .*vendor/);
    } finally { rmSync(comVendor, { recursive: true, force: true }); }
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

test('package-prebuilt --sem-zip (runner Ubuntu): monta a pasta sem criar ZIP e o manifesto diz zip null', () => {
  const { base, pasta } = pacoteDeBuild();
  const nx = nextFalso();
  try {
    const r = spawnSync(process.execPath, [join(S, 'package-prebuilt.mjs'), '--pacote', pasta, '--next', nx, '--out', join(base, 'saida'), '--origem', 'teste', '--sem-zip'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.zip, null);
    assert.equal(j.zipSha256, null);
    assert.ok(j.bytesDescomprimidos > 0);
    assert.ok(existsSync(join(j.pasta, 'prebuilt/web-next/BUILD_ID')));
    assert.equal(readdirSync(join(base, 'saida')).some((n) => n.endsWith('.zip')), false, 'nenhum ZIP criado');
    assert.equal(JSON.parse(readFileSync(j.manifesto, 'utf8')).zip, null);
  } finally { rmSync(base, { recursive: true, force: true }); rmSync(nx, { recursive: true, force: true }); }
});

test('restaurarPrebuilt: .next com o MESMO BUILD_ID mas sem a marca da restauração (sobra do build da Vertra) é substituído; com a marca é "já presente" (a prova no staging não depende de sobras)', () => {
  const r = pacote();
  try {
    put(r, 'apps/web/.next/BUILD_ID', 'BUILD_abc123');
    put(r, 'apps/web/.next/server/app/index.html', '<html>SOBRA DO BUILD ANTERIOR</html>');
    const a = restaurarPrebuilt(r, release(r));
    assert.match(a.log.join('|'), /.next restaurado .*substituído/);
    assert.match(readFileSync(join(r, 'apps/web/.next/server/app/index.html'), 'utf8'), /canonical/, 'o conteúdo é o do pré-construído, não o da sobra');
    assert.ok(existsSync(join(r, 'apps/web/.next/.ln-prebuilt.json')), 'marca gravada');
    assert.match(restaurarPrebuilt(r, release(r)).log.join('|'), /.next já presente .*marca da restauração ok/);
    // outro pré-construído (outro geradoEm) com o mesmo BUILD_ID: a marca antiga não vale
    put(r, 'prebuilt/prebuilt.json', JSON.stringify({ schema: 1, commit: SHA, appEnv: 'staging', siteUrl: SITE, vitrine: false, indexavel: false, flagsLigadas: ['intelligencePessoas'], buildId: 'BUILD_abc123', nextVersion: '16.4.6', externos: EXT, geradoEm: '2026-11-25T00:00:00.000Z' }));
    assert.match(restaurarPrebuilt(r, release(r)).log.join('|'), /.next restaurado/);
  } finally { limpa(r); }
});

test('QA 5 P3 — externos[].nome/pacote do prebuilt.json viram caminhos: nomes com .., barras, fora do formato ou que não casam com o pacote são recusados ANTES de qualquer link', () => {
  const rel = { commit: SHA, appEnv: 'staging', siteUrl: SITE, vitrine: false, indexavel: false, flagsLigadas: ['intelligencePessoas'] };
  const pb = (externos) => ({ commit: SHA, appEnv: 'staging', siteUrl: SITE, vitrine: false, indexavel: false, flagsLigadas: ['intelligencePessoas'], buildId: 'BUILD_abc123', nextVersion: '16.4.6', externos });
  assert.deepEqual(problemasPrebuilt(pb([{ nome: 'pg-0123456789abcdef', pacote: 'pg' }, { nome: '@scope/x-0123456789abcdef', pacote: '@scope/x' }]), rel, '16.4.6'), []);
  const ruins = [
    [{ nome: '../fora-0123456789abcdef', pacote: 'fora' }, /nome fora do formato/],
    [{ nome: `a${BARRA}b-0123456789abcdef`, pacote: 'a' }, /nome fora do formato/],
    [{ nome: 'pg/../../x-0123456789abcdef', pacote: 'x' }, /nome fora do formato/],
    [{ nome: 'pg-0123456789abcdef', pacote: '../../etc' }, /pacote fora do formato npm/],
    [{ nome: 'pg-0123456789abcdef', pacote: 'pg/../..' }, /pacote fora do formato npm/],
    [{ nome: 'pg-0123456789abcdef', pacote: 'sharp' }, /não corresponde ao pacote/],
    [{ nome: 'sem-sufixo', pacote: null }, /sem nome de pacote reconhecível/],
  ];
  for (const [x, esperado] of ruins) assert.match(problemasPrebuilt(pb([x]), rel, '16.4.6').join('|'), esperado, JSON.stringify(x));
  // e a restauração nem cria o .next quando o manifesto traz um nome malicioso
  const r = pacote({ pb: { externos: [{ nome: '../escapou-0123456789abcdef', pacote: 'pg' }] } });
  try {
    const x = restaurarPrebuilt(r, release(r));
    assert.match(x.problemas.join('|'), /nome fora do formato/);
    assert.equal(existsSync(join(r, 'apps/web/.next')), false, 'recusado antes de copiar qualquer coisa');
    assert.equal(existsSync(join(r, 'apps/web/escapou-0123456789abcdef')), false);
  } finally { limpa(r); }
});

test('QA 5 P3 — pasta de verdade (não link) em .next/node_modules: a limpeza e a recriação do link não quebram com EISDIR/EPERM', () => {
  const r = pacote();
  try {
    // (a) sem a marca: o .next velho tem uma PASTA real pg-… com arquivo dentro e uma @escopo com pasta real; a restauração troca tudo
    put(r, 'apps/web/.next/BUILD_ID', 'BUILD_velho');
    put(r, 'apps/web/.next/node_modules/pg-0123456789abcdef/index.js', 'pasta real');
    put(r, 'apps/web/.next/node_modules/@s/x-0123456789abcdef/index.js', 'pasta real em @escopo');
    const a = restaurarPrebuilt(r, release(r));
    assert.deepEqual(a.problemas, [], a.problemas.join('|'));
    assert.equal(lstatSync(join(r, 'apps/web/.next/node_modules/pg-0123456789abcdef')).isSymbolicLink(), true, 'virou link');
    assert.equal(existsSync(join(r, 'apps/web/.next/node_modules/@s')), false, 'o .next foi refeito do pré-construído');
    // (b) com a marca ok, mas o link foi trocado por uma pasta real: o link é recriado
    unlinkSync(join(r, 'apps/web/.next/node_modules/pg-0123456789abcdef'));
    put(r, 'apps/web/.next/node_modules/pg-0123456789abcdef/sobra.txt', 'x');
    const b = restaurarPrebuilt(r, release(r));
    assert.deepEqual(b.problemas, [], b.problemas.join('|'));
    assert.match(b.log.join('|'), /link pg-0123456789abcdef -> node_modules\/pg/);
    assert.equal(lstatSync(join(r, 'apps/web/.next/node_modules/pg-0123456789abcdef')).isSymbolicLink(), true);
    assert.ok(existsSync(join(r, 'node_modules/pg/package.json')), 'o alvo do link NÃO foi apagado');
  } finally { limpa(r); }
});

test('arquivosFaltando: completo = vazio; rota catch-all, arquivo do required-server-files e manifesto ausentes são apontados; *.map e *.nft.json citados NÃO contam', () => {
  const n = nextFalso();
  try {
    assert.deepEqual(arquivosFaltando(n), []);
    rmSync(join(n, 'server/app/api/auth/[...all]'), { recursive: true });
    assert.match(arquivosFaltando(n).join('|'), /server\/app\/api\/auth\/\[\.\.\.all\]\/route\.js/);
    assert.match(arquivosFaltando(n).join('|'), /rota \/api\/auth\/\[\.\.\.all\]\/route/);
    put(n, 'server/app/api/auth/[...all]/route.js', 'x');
    rmSync(join(n, 'BUILD_ID'));
    assert.match(arquivosFaltando(n).join('|'), /BUILD_ID/);
    put(n, 'BUILD_ID', 'BUILD_abc123');
    // citar um .map/.nft.json que o download deixa de fora não é falta
    put(n, 'required-server-files.json', JSON.stringify({ files: ['.next/BUILD_ID', '.next/next-server.js.nft.json', '.next/server/x.js.map'] }));
    assert.deepEqual(arquivosFaltando(n), []);
    // separadores do Windows e o prefixo ./.next também são entendidos
    put(n, 'required-server-files.json', JSON.stringify({ files: ['.next' + BARRA + 'BUILD_ID', './.next/server/app-paths-manifest.json'] }));
    assert.deepEqual(arquivosFaltando(n), []);
    // manifestos ausentes
    rmSync(join(n, 'server/app-paths-manifest.json'));
    assert.match(arquivosFaltando(n).join('|'), /app-paths-manifest\.json/);
    rmSync(join(n, 'required-server-files.json'));
    assert.match(arquivosFaltando(n).join('|'), /required-server-files\.json .ausente/);
  } finally { rmSync(n, { recursive: true, force: true }); }
});

test('package-prebuilt RECUSA um .next incompleto (pasta de rota catch-all perdida no download) e diz quais arquivos faltam; completo passa e leva a rota', () => {
  const { base, pasta } = pacoteDeBuild();
  const completo = nextFalso();
  const incompleto = nextFalso();
  rmSync(join(incompleto, 'server/app/api/auth'), { recursive: true });
  try {
    const ruim = spawnSync(process.execPath, [join(S, 'package-prebuilt.mjs'), '--pacote', pasta, '--next', incompleto, '--out', join(base, 'a'), '--origem', 'teste'], { encoding: 'utf8' });
    assert.equal(ruim.status, 2);
    assert.ok(ruim.stderr.includes('.next INCOMPLETO: faltam 1 arquivo(s)'), ruim.stderr);
    assert.ok(ruim.stderr.includes('app/api/auth/[...all]/route.js'), ruim.stderr);
    assert.equal(existsSync(join(base, 'a')), false, 'recusado antes de criar saída');
    const bom = spawnSync(process.execPath, [join(S, 'package-prebuilt.mjs'), '--pacote', pasta, '--next', completo, '--out', join(base, 'b'), '--origem', 'teste', '--sem-zip'], { encoding: 'utf8' });
    assert.equal(bom.status, 0, bom.stderr + bom.stdout);
    assert.ok(existsSync(join(JSON.parse(bom.stdout).pasta, 'prebuilt/web-next/server/app/api/auth/[...all]/route.js')), 'a rota catch-all vai no pacote');
  } finally { rmSync(base, { recursive: true, force: true }); rmSync(completo, { recursive: true, force: true }); rmSync(incompleto, { recursive: true, force: true }); }
});

test('restaurarPrebuilt: um pré-construído INCOMPLETO (rota perdida) não sobe: problema com o nome do arquivo; completo passa', () => {
  const r = pacote();
  try {
    assert.deepEqual(restaurarPrebuilt(r, release(r)).problemas, []);
  } finally { limpa(r); }
  const q = pacote();
  try {
    rmSync(join(q, 'prebuilt/web-next/server/app/api'), { recursive: true });
    const x = restaurarPrebuilt(q, release(q));
    assert.ok(x.problemas.join('|').includes('INCOMPLETO: faltam 1 arquivo(s)'), x.problemas.join('|'));
    assert.ok(x.problemas.join('|').includes('route.js'));
  } finally { limpa(q); }
});

test('restaurarPrebuilt: home DINÂMICA (o build real do staging não tem server/app/index.html) NÃO é erro: registra no log e segue; home estática errada continua reprovando', () => {
  const r = pacote();
  try {
    rmSync(join(r, 'prebuilt/web-next/server/app/index.html'));
    put(r, 'prebuilt/web-next/server/app-paths-manifest.json', JSON.stringify({ '/api/auth/[...all]/route': 'app/api/auth/[...all]/route.js' }));
    const x = restaurarPrebuilt(r, release(r));
    assert.deepEqual(x.problemas, [], x.problemas.join('|'));
    assert.match(x.log.join('|'), /home dinâmica: sem server\/app\/index\.html estático/);
  } finally { limpa(r); }
  const e = pacote({ home: HOME('http://localhost:3000') });
  try {
    assert.match(restaurarPrebuilt(e, release(e)).problemas.join('|'), /canonical da home/, 'com index.html estático errado reprova como antes');
  } finally { limpa(e); }
});

test('provar-restauracao-prebuilt: pacote pré-construído coerente passa (exit 0, 2ª subida não copia de novo, links e marca); pacote com rota perdida reprova (exit 1) citando o arquivo', () => {
  const r = pacote();
  const rodar = (pasta) => spawnSync(process.execPath, [join(S, 'provar-restauracao-prebuilt.mjs'), '--pacote', pasta], { encoding: 'utf8' });
  try {
    const ok = rodar(r);
    assert.equal(ok.status, 0, ok.stderr + ok.stdout);
    const j = JSON.parse(ok.stdout);
    assert.equal(j.ok, true);
    assert.deepEqual(j.primeira.problemas, []);
    assert.match(j.segunda.log.join('|'), /já presente/);
    assert.ok(j.links.every((l) => l.link) && j.marca);
    assert.equal(rodar(join(r, 'nao-existe')).status, 2);
  } finally { limpa(r); }
  const q = pacote();
  try {
    rmSync(join(q, 'prebuilt/web-next/server/app/api'), { recursive: true });
    const ruim = rodar(q);
    assert.equal(ruim.status, 1);
    assert.ok(ruim.stdout.includes('INCOMPLETO'), ruim.stdout.slice(0, 300));
  } finally { limpa(q); }
});

test('package-prebuilt --tar (reserva para o limite de entradas do upload): o .next vira UM web-next.tar, o pacote tem bem menos entradas, e a restauração extrai, confere o BUILD_ID e é idempotente; tar corrompido ou de outro build reprova', () => {
  const { base, pasta } = pacoteDeBuild();
  const nx = nextFalso();
  for (let i = 0; i < 40; i += 1) put(nx, `server/chunks/c${i}.js`, 'x'); // muitos arquivos soltos: é isso que o tar junta
  const rodar = (extra) => spawnSync(process.execPath, [join(S, 'package-prebuilt.mjs'), '--pacote', pasta, '--next', nx, '--out', join(base, extra[0]), '--origem', 'teste', ...extra.slice(1)], { encoding: 'utf8' });
  try {
    const plano = rodar(['plano']);
    const comTar = rodar(['tar', '--tar']);
    assert.equal(plano.status, 0, plano.stderr + plano.stdout);
    assert.equal(comTar.status, 0, comTar.stderr + comTar.stdout);
    const jp = JSON.parse(plano.stdout);
    const jt = JSON.parse(comTar.stdout);
    assert.ok(jt.pasta.endsWith('-prebuilt-tar'), jt.pasta);
    assert.ok(existsSync(join(jt.pasta, 'prebuilt/web-next.tar')));
    assert.equal(existsSync(join(jt.pasta, 'prebuilt/web-next')), false, 'a pasta solta sai do pacote');
    assert.ok(jt.arquivos <= jp.arquivos - 40, 'entradas: tar=' + jt.arquivos + ' contra pasta=' + jp.arquivos);
    assert.equal(JSON.parse(readFileSync(join(jt.pasta, 'prebuilt/prebuilt.json'), 'utf8')).formato, 'tar');
    assert.equal(JSON.parse(readFileSync(join(jp.pasta, 'prebuilt/prebuilt.json'), 'utf8')).formato, 'pasta');
    const prova = spawnSync(process.execPath, [join(S, 'provar-restauracao-prebuilt.mjs'), '--pacote', jt.pasta], { encoding: 'utf8' });
    assert.equal(prova.status, 0, prova.stdout.slice(0, 600) + prova.stderr);
    const pj = JSON.parse(prova.stdout);
    assert.ok(pj.primeira.log.join('|').includes('web-next.tar'), 'restaurou do tar');
    assert.ok(pj.segunda.log.join('|').includes('já presente'), 'a 2ª subida não extrai de novo');
    assert.equal(pj.buildIdRestaurado, 'BUILD_abc123');
    assert.ok(pj.links.every((l) => l.link));
    // tar corrompido
    writeFileSync(join(jt.pasta, 'prebuilt/web-next.tar'), 'isto não é um tar');
    const ruim = spawnSync(process.execPath, [join(S, 'provar-restauracao-prebuilt.mjs'), '--pacote', jt.pasta], { encoding: 'utf8' });
    assert.equal(ruim.status, 1);
    assert.ok(ruim.stdout.includes('falha ao extrair') || ruim.stdout.includes('BUILD_ID extraído'), ruim.stdout.slice(0, 500));
  } finally { rmSync(base, { recursive: true, force: true }); rmSync(nx, { recursive: true, force: true }); }
});
