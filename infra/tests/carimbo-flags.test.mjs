// carimbar-flags-prebuilt.mjs (staging pré-construído pelo Actions SEM flags + carimbo das flags de execução) e a regra do ci-checks "LN_FLAGS_ON só é lida no resolvedor".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { carimbarManifesto, normalizarFlags } from '../scripts/carimbar-flags-prebuilt.mjs';
import { problemasPrebuilt } from '../scripts/lib/prebuilt.mjs';
import { somaArvore } from '../scripts/arvore-sha256.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const RAIZ = join(S, '..', '..');
const COMMIT = 'b'.repeat(40);
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const put = (p, t) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); };
const node = (script, args, opts = {}) => spawnSync(process.execPath, [join(S, script), ...args], { encoding: 'utf8', ...opts });

/** Pacote pré-construído de staging SEM flags, como o artefato do Actions (pasta + manifesto ao lado, com o resolvedor de flags igual ao da raiz). */
function pacote({ appEnv = 'staging', flags = [], prebuilt = true, perfil = 'staging' } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'ln-carimbo-'));
  const pasta = join(base, 'ln-web-staging-bbbbbbbbbbbb-loyaltynews-stg-prebuilt');
  const siteUrl = 'https://loyaltynews-stg.vertraweb.app';
  put(join(pasta, 'release.json'), JSON.stringify({ commit: COMMIT, perfil, app: 'ln-staging-web', tipo: 'web', siteUrl, appEnv, vitrine: false, indexavel: false, flagsLigadas: flags, jobsIntelligence: [], ...(prebuilt ? { prebuilt: true, buildCommandVazio: true } : {}) }));
  put(join(pasta, 'prebuilt', 'prebuilt.json'), JSON.stringify({ schema: 1, commit: COMMIT, appEnv, siteUrl, vitrine: false, indexavel: false, flagsLigadas: flags, formato: 'pasta', buildId: 'build_abc123', nextVersion: null, externos: [], origem: 'teste' }, null, 2) + '\n');
  put(join(pasta, 'prebuilt', 'web-next', 'BUILD_ID'), 'build_abc123');
  put(join(pasta, 'prebuilt', 'web-next', 'server', 'app', 'page.js'), 'conteudo-do-next');
  put(join(pasta, 'package.json'), '{"name":"x"}\n');
  mkdirSync(join(pasta, 'packages', 'contracts', 'src'), { recursive: true });
  cpSync(join(RAIZ, 'packages', 'contracts', 'src', 'flags.ts'), join(pasta, 'packages', 'contracts', 'src', 'flags.ts')); // o resolvedor do pacote = o da raiz
  const manifesto = join(base, 'ln-web-staging-bbbbbbbbbbbb-loyaltynews-stg-prebuilt.manifest.json');
  put(manifesto, JSON.stringify({ schema: 1, perfil: 'staging', flagsLigadas: flags, depois_do_create: { set_env: [{ nome: 'APP_ENV', valor: 'staging' }, { nome: 'APP_COMMIT', valor: COMMIT }] } }, null, 2) + '\n');
  return { base, pasta, manifesto };
}
const carimbar = (p, extra = [], { soma = somaArvore(p.pasta), flags = 'intelligencePessoas' } = {}) => node('carimbar-flags-prebuilt.mjs', ['--pasta', p.pasta, '--flags', flags, '--soma-esperada', soma, '--raiz', RAIZ, ...extra]);

test('normalizarFlags: únicas, ordenadas, formato exato; vazio e nome estranho são recusados', () => {
  assert.deepEqual(normalizarFlags('b, a,a'), ['a', 'b']);
  assert.throws(() => normalizarFlags(''), /exige nomes/);
  assert.throws(() => normalizarFlags('ok,../x'), /inválido/);
  assert.throws(() => normalizarFlags('9flag'), /inválido/);
});

test('carimbarManifesto: acrescenta LN_FLAGS_ON às listas de variáveis (as que têm APP_COMMIT), atualiza se já existir e grava flagsLigadas', () => {
  const m = { depois_do_create: { set_env: [{ nome: 'APP_COMMIT', valor: 'x' }] }, outra: [{ nome: 'NADA' }] };
  assert.equal(carimbarManifesto(m, ['intelligencePessoas']), 1);
  assert.deepEqual(m.depois_do_create.set_env.at(-1), { nome: 'LN_FLAGS_ON', valor: 'intelligencePessoas' });
  assert.deepEqual(m.outra, [{ nome: 'NADA' }]);
  assert.deepEqual(m.flagsLigadas, ['intelligencePessoas']);
  carimbarManifesto(m, ['a', 'b']);
  assert.equal(m.depois_do_create.set_env.filter((v) => v.nome === 'LN_FLAGS_ON').length, 1);
  assert.equal(m.depois_do_create.set_env.find((v) => v.nome === 'LN_FLAGS_ON').valor, 'a,b');
  assert.equal(carimbarManifesto({ depois_do_create: { set_env: [{ nome: 'APP_ENV' }] } }, ['a']), 0, 'sem a lista de variáveis do deploy devolve 0');
});

test('carimbar (CLI): grava as flags em release.json, prebuilt.json e manifesto; NÃO toca o .next; a restauração e o guard-env passam a exigir a flag; somas antes e depois', () => {
  const p = pacote();
  try {
    const next = join(p.pasta, 'prebuilt', 'web-next', 'server', 'app', 'page.js');
    const shaNext = sha(next);
    const somaAntes = somaArvore(p.pasta);
    const r = carimbar(p, [], { soma: somaAntes });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, true);
    assert.deepEqual(j.flags, ['intelligencePessoas']);
    assert.equal(j.arvoreSha256Antes, somaAntes);
    assert.equal(j.arvoreSha256Depois, somaArvore(p.pasta));
    assert.notEqual(j.arvoreSha256Antes, j.arvoreSha256Depois);
    assert.deepEqual(j.alterados.map((a) => a.arquivo).sort(), ['prebuilt/prebuilt.json', 'release.json']);
    assert.equal(sha(next), shaNext, 'o .next não pode mudar');
    const rel = JSON.parse(readFileSync(join(p.pasta, 'release.json'), 'utf8'));
    const pb = JSON.parse(readFileSync(join(p.pasta, 'prebuilt', 'prebuilt.json'), 'utf8'));
    const man = JSON.parse(readFileSync(p.manifesto, 'utf8'));
    assert.deepEqual(rel.flagsLigadas, ['intelligencePessoas']);
    assert.deepEqual(pb.flagsLigadas, ['intelligencePessoas']);
    assert.deepEqual(pb.carimboFlags.para, ['intelligencePessoas']);
    assert.deepEqual(man.flagsLigadas, ['intelligencePessoas']);
    assert.ok(man.depois_do_create.set_env.some((v) => v.nome === 'LN_FLAGS_ON' && v.valor === 'intelligencePessoas'));
    assert.deepEqual(problemasPrebuilt(pb, rel, null), []);
    // o guard do app (build e start) agora exige LN_FLAGS_ON = release.json
    const guard = (env) => spawnSync(process.execPath, [join(S, 'guard-env.mjs')], { cwd: p.pasta, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, APP_ENV: 'staging', ...env } });
    assert.equal(guard({ LN_FLAGS_ON: 'intelligencePessoas' }).status, 0);
    const sem = guard({});
    assert.equal(sem.status, 1);
    assert.match(sem.stderr, /LN_FLAGS_ON=""|difere do release\.json/);
    // idempotente (a soma esperada continua sendo a do run, que já não bate com a pasta carimbada: o carimbo já feito não reclama)
    const de_novo = carimbar(p, [], { soma: somaAntes });
    assert.equal(de_novo.status, 0, de_novo.stderr);
    assert.equal(JSON.parse(de_novo.stdout).jaCarimbado, true);
  } finally { rmSync(p.base, { recursive: true, force: true }); }
});

test('carimbar (CLI) recusa: produção, perfil de produção, flag desconhecida, outras flags já ligadas, pacote que não é pré-construído e ZIP ao lado', () => {
  const casos = [
    [{ appEnv: 'production', perfil: 'production' }, 'intelligencePessoas', /staging|produção/],
    [{}, 'flagQueNaoExiste', /contrato de flags/],
    [{ flags: ['openbotDispatch'] }, 'intelligencePessoas', /já liga outras flags/],
    [{ prebuilt: false }, 'intelligencePessoas', /não é pré-construído/],
  ];
  for (const [opts, flags, esperado] of casos) {
    const p = pacote(opts);
    try {
      const antes = somaArvore(p.pasta);
      const r = carimbar(p, [], { flags });
      assert.equal(r.status, 1, `${JSON.stringify(opts)}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, esperado);
      assert.equal(somaArvore(p.pasta), antes, 'recusa não altera nada');
    } finally { rmSync(p.base, { recursive: true, force: true }); }
  }
  const z = pacote();
  try {
    writeFileSync(z.pasta + '.zip', 'x');
    const r = carimbar(z);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /\.zip ao lado/);
  } finally { rmSync(z.base, { recursive: true, force: true }); }
  const u = pacote();
  try { assert.equal(node('carimbar-flags-prebuilt.mjs', ['--pasta', u.pasta]).status, 2); } finally { rmSync(u.base, { recursive: true, force: true }); }
});

test('carimbar (CLI): --soma-esperada é OBRIGATÓRIA e tem de ser a soma do run; soma diferente (pasta adulterada ou de outro run) recusa sem alterar nada', () => {
  const p = pacote();
  try {
    const soma = somaArvore(p.pasta);
    const base = ['--pasta', p.pasta, '--flags', 'intelligencePessoas', '--raiz', RAIZ];
    const sem = node('carimbar-flags-prebuilt.mjs', base);
    assert.equal(sem.status, 2);
    assert.match(sem.stderr, /--soma-esperada é obrigatória/);
    const ruim = node('carimbar-flags-prebuilt.mjs', [...base, '--soma-esperada', 'f'.repeat(64)]);
    assert.equal(ruim.status, 1);
    assert.match(ruim.stderr, /NÃO é a do run/);
    assert.equal(node('carimbar-flags-prebuilt.mjs', [...base, '--soma-esperada', 'abc']).status, 2);
    // adulterar a pasta depois do "download": a soma do run deixa de bater
    writeFileSync(join(p.pasta, 'package.json'), '{"name":"adulterado"}\n');
    const adulterada = node('carimbar-flags-prebuilt.mjs', [...base, '--soma-esperada', soma]);
    assert.equal(adulterada.status, 1);
    assert.match(adulterada.stderr, /NÃO é a do run/);
    assert.deepEqual(JSON.parse(readFileSync(join(p.pasta, 'release.json'), 'utf8')).flagsLigadas, [], 'nada foi carimbado');
  } finally { rmSync(p.base, { recursive: true, force: true }); }
});

test('carimbar (CLI): manifesto ausente ou sem a lista de variáveis do deploy = RECUSA, nada é gravado; flags.ts do pacote diferente da raiz (ou ausente) recusa', () => {
  const semMan = pacote();
  try {
    rmSync(semMan.manifesto);
    const antes = somaArvore(semMan.pasta);
    const r = carimbar(semMan);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /manifesto .* ausente/);
    assert.equal(somaArvore(semMan.pasta), antes);
    assert.ok(!existsSync(semMan.manifesto));
  } finally { rmSync(semMan.base, { recursive: true, force: true }); }
  const semLista = pacote();
  try {
    writeFileSync(semLista.manifesto, JSON.stringify({ schema: 1, depois_do_create: { set_env: [{ nome: 'APP_ENV', valor: 'staging' }] } }));
    const antes = somaArvore(semLista.pasta);
    const r = carimbar(semLista);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /não tem a lista de variáveis do deploy/);
    assert.equal(somaArvore(semLista.pasta), antes, 'release.json e prebuilt.json não foram tocados');
  } finally { rmSync(semLista.base, { recursive: true, force: true }); }
  const flagsDiferente = pacote();
  try {
    const f = join(flagsDiferente.pasta, 'packages', 'contracts', 'src', 'flags.ts');
    writeFileSync(f, readFileSync(f, 'utf8') + '\n// alterado\n');
    const antes = somaArvore(flagsDiferente.pasta);
    const r = carimbar(flagsDiferente);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /flags\.ts do pacote DIFERE/);
    assert.equal(somaArvore(flagsDiferente.pasta), antes);
  } finally { rmSync(flagsDiferente.base, { recursive: true, force: true }); }
  const semFlagsTs = pacote();
  try {
    rmSync(join(semFlagsTs.pasta, 'packages'), { recursive: true, force: true });
    const r = carimbar(semFlagsTs);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /não tem packages\/contracts\/src\/flags\.ts/);
  } finally { rmSync(semFlagsTs.base, { recursive: true, force: true }); }
});

// ---- ci-checks: LN_FLAGS_ON só lida no resolvedor ----
function raizCi(arquivos) {
  const d = mkdtempSync(join(tmpdir(), 'ln-flagsck-'));
  put(join(d, 'package.json'), '{"name":"x","version":"0.0.0"}\n');
  for (const [rel, txt] of Object.entries(arquivos)) put(join(d, rel), txt);
  return d;
}
const ci = (d) => spawnSync(process.execPath, [join(S, 'ci-checks.mjs'), '--root', d], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });

test('ci-checks: LN_FLAGS_ON LIDA fora do resolvedor reprova (env., env[], desestruturação, process.env)', () => {
  for (const codigo of [
    'export const f = process.env.LN_FLAGS_ON;',
    'const v = env.LN_FLAGS_ON ?? "";',
    "const v = env['LN_FLAGS_ON'];",
    'const { LN_FLAGS_ON } = process.env;',
    'const v = env?.LN_FLAGS_ON;',
  ]) {
    const d = raizCi({ 'apps/web/lib/x.ts': codigo });
    try {
      const r = ci(d);
      assert.equal(r.status, 1, codigo);
      assert.match(r.stderr + r.stdout, /LN_FLAGS_ON lida em apps\/web\/lib\/x\.ts/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  }
});

test('ci-checks: o resolvedor, testes, e2e, docs e menções só em texto/comentário NÃO reprovam', () => {
  const d = raizCi({
    'packages/contracts/src/flags.ts': 'export const raw = env.LN_FLAGS_ON ?? "";',
    'apps/web/lib/runtime-flags.test.ts': 'const v = process.env.LN_FLAGS_ON;',
    'apps/web/e2e/x.spec.ts': 'const v = process.env.LN_FLAGS_ON;',
    'apps/web/docs/x.ts': 'const v = process.env.LN_FLAGS_ON;',
    'apps/workers/src/a.ts': "log('desligado (ADR-022: APP_ENV=staging e LN_FLAGS_ON)'); // staging com LN_FLAGS_ON; produção nunca\nconst msg = `LN_FLAGS_ON=openbotDispatch em staging`;",
    'packages/agents/src/b.ts': "const passos = ['Só então: `LN_FLAGS_ON=openbotDispatch` (set_env)'];",
  });
  try {
    const r = ci(d);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('ci-checks: o repositório real passa na regra (nenhum código fora do resolvedor lê LN_FLAGS_ON)', () => {
  const r = spawnSync(process.execPath, [join(S, 'ci-checks.mjs'), '--root', RAIZ], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.doesNotMatch(r.stderr + r.stdout, /LN_FLAGS_ON lida em/);
});
