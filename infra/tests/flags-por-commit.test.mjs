// DP-57 (ADR-022, adendo 3): em produção as flags ligam POR COMMIT (PRODUCTION_FLAGS_ON do contrato). O package-web só REGISTRA a lista
// (release.json/manifesto.flagsPorCommit, lida do flags.ts DO COMMIT empacotado) para o ensaio e o smoke conferirem o /api/health;
// nunca cria LN_FLAGS_ON. Fora de production, flagsPorCommit é vazio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const S = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'scripts');
const RAIZ = join(S, '..', '..');

/** PRODUCTION_FLAGS_ON do flags.ts do HEAD (o mesmo commit que o package-web empacota), ordenado. */
async function listaDoHead() {
  const dir = mkdtempSync(join(tmpdir(), 'ln-fpc-'));
  try {
    const src = spawnSync('git', ['show', 'HEAD:packages/contracts/src/flags.ts'], { cwd: RAIZ, encoding: 'utf8' });
    assert.equal(src.status, 0, src.stderr);
    const arq = join(dir, 'flags.ts');
    writeFileSync(arq, src.stdout);
    const m = await import(pathToFileURL(arq).href);
    return Array.isArray(m.PRODUCTION_FLAGS_ON) ? [...new Set(m.PRODUCTION_FLAGS_ON.map(String))].sort() : [];
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function empacota(perfil) {
  const out = mkdtempSync(join(tmpdir(), 'ln-fpc-out-'));
  const r = spawnSync(process.execPath, [join(S, 'package-web.mjs'), '--repo', '.', '--commit', 'HEAD', '--out', out, '--profile', perfil, '--subdomain', 'loyaltynews'], { encoding: 'utf8', cwd: RAIZ });
  return { out, r };
}

test('package-web production: release.json e manifesto registram flagsPorCommit = PRODUCTION_FLAGS_ON do commit, sem LN_FLAGS_ON nas variáveis', async () => {
  const esperado = await listaDoHead();
  const { out, r } = empacota('production');
  try {
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const j = JSON.parse(r.stdout);
    const release = JSON.parse(readFileSync(join(j.pasta, 'release.json'), 'utf8'));
    const man = JSON.parse(readFileSync(j.manifesto, 'utf8'));
    assert.deepEqual(release.flagsPorCommit, esperado);
    assert.deepEqual(man.flagsPorCommit, esperado);
    assert.deepEqual(release.flagsLigadas, [], 'produção nunca tem flags por variável');
    const setEnv = man.depois_do_create?.set_env ?? [];
    assert.ok(!setEnv.some((v) => v && v.nome === 'LN_FLAGS_ON'), 'LN_FLAGS_ON não pode ir para o set_env de produção');
    assert.ok(existsSync(j.zip));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('package-web staging: flagsPorCommit vazio (a ligação por commit só vale em production)', () => {
  const { out, r } = empacota('staging');
  try {
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(JSON.parse(readFileSync(join(j.pasta, 'release.json'), 'utf8')).flagsPorCommit, []);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
