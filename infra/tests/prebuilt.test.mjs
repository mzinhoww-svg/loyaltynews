// Testes do web PRÉ-CONSTRUÍDO (opção B, 24/11/2026): lib/prebuilt.mjs, o gancho do start-web e o package-prebuilt. Rodar: node --test infra/tests/ (pelo PowerShell: o package-prebuilt usa o tar do sistema para o ZIP)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, lstatSync, unlinkSync, readdirSync } from 'node:fs';
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
  put(r, 'prebuilt/prebuilt.json', JSON.stringify({ schema: 1, commit: SHA, appEnv: 'staging', siteUrl: SITE, vitrine: false, indexavel: false, flagsLigadas: ['intelligencePessoas'], buildId: 'BUILD_abc123', nextVersion: '16.4.6', externos: EXT, geradoEm: '2026-11-24T00:00:00.000Z', ...pb }));
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

test('workflow proposto (infra/ci): só dispara à mão, só leitura, sem segredos, entradas só por ambiente, constrói em /app com o Node da Vertra e usa o package-prebuilt', () => {
  const y = readFileSync(join(S, '..', 'ci', 'web-prebuilt.workflow.yml'), 'utf8');
  const codigo = y.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.match(codigo, /^on:\s*\n\s+workflow_dispatch:/m);
  for (const gatilho of ['pull_request', 'pull_request_target', 'push:', 'schedule:', 'workflow_run']) assert.ok(!codigo.includes(gatilho), `sem gatilho ${gatilho}`);
  assert.match(codigo, /permissions:\s*\n\s+contents: read\s*\n/);
  assert.ok(!/secrets\./.test(codigo), 'nenhum secrets.*');
  assert.ok(!/GITHUB_TOKEN/.test(codigo.replace(/persist-credentials/g, '')), 'sem token explícito');
  // entradas só em env:/with:/group:, nunca dentro de um bloco `run`
  for (const l of codigo.split('\n').filter((x) => x.includes('${{ inputs.'))) assert.match(l, /^\s+(LN_[A-Z_]+|ref|name|group):\s/, `entrada fora de env/with: ${l.trim()}`);
  assert.ok(!/run:[^\n]*\$\{\{ inputs\./.test(codigo));
  assert.match(codigo, /sudo mkdir -p \/app/);
  assert.match(codigo, /infra\/vertra\/environments\.json'\)\.runtime\.node/);
  assert.match(codigo, /actions\/setup-node@v4/);
  assert.match(codigo, /node infra\/scripts\/build-web\.mjs/);
  assert.match(codigo, /package-prebuilt\.mjs .*--next \/app\/apps\/web\/\.next .*--sem-zip/);
  assert.match(codigo, /\[\[ "\$LN_PERFIL" == "production" && -n "\$LN_FLAGS" \]\]/, 'produção recusa flags');
  assert.match(codigo, /\^\[0-9a-f\]\{40\}\$/);
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
