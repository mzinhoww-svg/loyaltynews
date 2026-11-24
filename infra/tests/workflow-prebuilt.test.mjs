// Guarda do workflow .github/workflows/web-prebuilt.yml (texto, sem rodar o Actions): o que o ato G3 e o QA 6 exigem fica fixo em teste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bruto = readFileSync(join(RAIZ, '.github/workflows/web-prebuilt.yml'), 'utf8');
const linhas = bruto.split('\n');

/** Linhas de comando (corpo dos blocos `run: |`), sem os comentários de linha inteira. */
function linhasDeRun() {
  const out = [];
  let recuo = -1;
  for (const l of linhas) {
    const ind = l.length - l.trimStart().length;
    if (recuo >= 0) {
      if (l.trim() === '' || ind > recuo) { out.push(l); continue; }
      recuo = -1;
    }
    if (/^\s*run:\s*\|\s*$/.test(l)) recuo = ind;
  }
  return out;
}

test('workflow web-prebuilt: sem CRLF, sem segredos, único gatilho workflow_dispatch, permissão só de leitura', () => {
  assert.ok(!bruto.includes('\r'), 'CRLF no workflow');
  assert.ok(!/\$\{\{\s*secrets\./.test(bruto), 'secrets.* no workflow');
  assert.match(bruto, /^on:\n {2}workflow_dispatch:/m);
  assert.ok(!/^\s+(push|pull_request|pull_request_target|schedule|workflow_run):/m.test(bruto), 'gatilho além de workflow_dispatch');
  assert.match(bruto, /^permissions:\n {2}contents: read\n/m);
  assert.ok(!/(contents|actions|id-token|packages|pull-requests): write/.test(bruto), 'permissão de escrita');
});

test('workflow web-prebuilt: as 3 actions fixadas por SHA de 40 caracteres e checkout sem credencial gravada', () => {
  const usos = linhas.filter((l) => /^\s*-?\s*uses:/.test(l));
  assert.equal(usos.length, 3);
  for (const u of usos) assert.match(u, /uses:\s+actions\/[a-z-]+@[0-9a-f]{40}\s+# v\d/, u);
  assert.match(bruto, /persist-credentials: false/);
});

test('workflow web-prebuilt: nada de ${{ }} dentro de run: (entradas só por env)', () => {
  for (const l of linhasDeRun()) assert.ok(!l.includes('${{'), `expressão em run: ${l.trim()}`);
});

test('workflow web-prebuilt: produção exige commit ancestral da main ANTES do build, com história completa e mensagem clara', () => {
  assert.match(bruto, /fetch-depth: 0/);
  assert.match(bruto, /git fetch --no-tags origin main/);
  assert.match(bruto, /git merge-base --is-ancestor "\$LN_COMMIT" origin\/main/);
  assert.match(bruto, /RECUSADO: o commit .* NÃO é ancestral da main/);
  assert.ok(!/x-access-token|https:\/\/[^\s"']*@github\.com/.test(bruto), 'token na URL');
  const iAncestral = bruto.indexOf('merge-base --is-ancestor');
  const iBuild = bruto.indexOf('build-web.mjs');
  const iNpm = bruto.indexOf('npm ci');
  assert.ok(iAncestral > 0 && iAncestral < iNpm && iAncestral < iBuild, 'a conferência vem depois do npm ci/build');
  // o passo só vale em produção; o staging não é barrado
  assert.match(bruto, /if \[\[ "\$LN_PERFIL" == "production" \]\]; then\n\s+# repositório público/);
});

test('workflow web-prebuilt: não atribui LN_FLAGS_ON (ci-checks, ADR-022)', () => {
  assert.ok(!/LN_FLAGS_ON\s*[:=]/.test(bruto.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n')));
});

test('workflow web-prebuilt: o passo da ancestralidade, executado de verdade num repositório de teste (ancestral passa; fora da main e commit inexistente são recusados; staging não é barrado)', (t) => {
  const tem = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' });
  if (tem.status !== 0) { t.skip('sem bash/git'); return; }
  const ini = bruto.indexOf('      - name: Produção só constrói commit');
  const fim = bruto.indexOf('      - name: Versão do Node da Vertra');
  assert.ok(ini > 0 && fim > ini);
  const bloco = bruto.slice(ini, fim);
  const script = bloco.slice(bloco.indexOf('run: |\n') + 'run: |\n'.length).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  const d = mkdtempSync(join(tmpdir(), 'ln-wf-'));
  const sh = (cmd, env = {}) => spawnSync('bash', ['-c', cmd], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...env } });
  try {
    const o = join(d, 'origem').split('\\').join('/');
    const c = join(d, 'clone').split('\\').join('/');
    const arq = join(d, 'passo.sh').split('\\').join('/');
    writeFileSync(arq, script);
    assert.equal(sh(`git init -q -b main "${o}" && cd "${o}" && git commit -q --allow-empty -m a && git commit -q --allow-empty -m b`).status, 0);
    assert.equal(sh(`cd "${o}" && git checkout -q -b lateral && git commit -q --allow-empty -m so-lateral && git checkout -q main`).status, 0);
    assert.equal(sh(`git clone -q "${o}" "${c}" && cd "${c}" && git fetch -q origin lateral`).status, 0);
    const ancestral = sh(`cd "${o}" && git rev-parse main~1`).stdout.trim();
    const lateral = sh(`cd "${o}" && git rev-parse lateral`).stdout.trim();
    const roda = (commit, perfil) => sh(`cd "${c}" && bash "${arq}"`, { LN_COMMIT: commit, LN_PERFIL: perfil });
    const ok = roda(ancestral, 'production');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /ok: .* é ancestral de origin\/main/);
    const ruim = roda(lateral, 'production');
    assert.equal(ruim.status, 1);
    assert.match(ruim.stdout, /RECUSADO: o commit .* NÃO é ancestral da main/);
    const inexistente = roda('0'.repeat(40), 'production');
    assert.equal(inexistente.status, 1);
    assert.match(inexistente.stdout, /ERRO ao conferir a ancestralidade/);
    assert.equal(roda(lateral, 'staging').status, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
