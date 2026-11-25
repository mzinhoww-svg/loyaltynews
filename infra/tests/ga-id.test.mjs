// GA4: o ID de medição é constante de BUILD (NEXT_PUBLIC_GA_ID embutida no bundle do cliente). O workflow web-prebuilt (congelado) não repassa NEXT_PUBLIC_*; o ID é declarado no environments.json
// da produção web, vai no release.json (gaId) e o build-web o põe no ambiente do next build; o pré-construído só vale com o MESMO ID.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { GA_ID, resolverGoLive } from '../scripts/lib/go-live.mjs';
import { problemasPrebuilt } from '../scripts/lib/prebuilt.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const RAIZ = join(S, '..', '..');
const prod = { profile: 'production', appKey: 'web' };
const erro = (web, ctx = prod) => { try { resolverGoLive({ web, ...ctx }); return null; } catch (e) { return e.message; } };

test('GA_ID: G- e 6 a 12 letras maiúsculas ou números; recusa minúsculas, tamanho errado, UA- e injeção', () => {
  for (const ok of ['G-3Y3YMHMLHZ', 'G-ABCDEF', 'G-ABCDEF123456']) assert.ok(GA_ID.test(ok), ok);
  for (const ruim of ['g-3y3ymhmlhz', 'G-ABC', 'G-ABCDEF1234567', 'UA-12345-1', 'G-ABC DEF1', 'G-ABCDEF"+alert(1)+"', 'G-', '', ' G-ABCDEF', 'G-ABCDEF\n']) assert.ok(!GA_ID.test(ruim), JSON.stringify(ruim));
});

test('resolverGoLive: gaId declarado na produção web é devolvido; --sem-go-live e o worker não o recebem; formato inválido e fora de produção/web recusam', () => {
  assert.equal(resolverGoLive({ web: { gaId: 'G-3Y3YMHMLHZ' }, ...prod }).gaId, 'G-3Y3YMHMLHZ');
  assert.equal(resolverGoLive({ web: {}, ...prod }).gaId, null);
  assert.equal(resolverGoLive({ web: { gaId: 'G-3Y3YMHMLHZ' }, ...prod, semGoLive: true }).gaId, null);
  assert.equal(resolverGoLive({ web: {}, profile: 'production', appKey: 'workers' }).gaId, null);
  assert.match(erro({ gaId: 'g-minusculo' }), /gaId .* inválido/);
  assert.match(erro({ gaId: 123 }), /gaId .* inválido/);
  assert.match(erro({ gaId: 'G-3Y3YMHMLHZ' }, { profile: 'staging', appKey: 'web' }), /só vale para o web do perfil production/);
  assert.match(erro({ gaId: 'G-3Y3YMHMLHZ' }, { profile: 'production', appKey: 'workers' }), /só vale para o web do perfil production/);
});

test('package-web (repositório real): a produção leva o gaId do environments.json no release.json e no manifesto; staging e --sem-go-live não levam', () => {
  const out = mkdtempSync(join(tmpdir(), 'ln-ga-'));
  try {
    const rodar = (sub, extra) => {
      const r = spawnSync(process.execPath, [join(S, 'package-web.mjs'), '--repo', '.', '--commit', 'HEAD', '--out', join(out, sub + extra.join('')), '--subdomain', sub, ...extra], { encoding: 'utf8', cwd: RAIZ });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const j = JSON.parse(r.stdout);
      return { release: JSON.parse(readFileSync(join(j.pasta, 'release.json'), 'utf8')), manifesto: JSON.parse(readFileSync(j.manifesto, 'utf8')) };
    };
    const declarado = JSON.parse(readFileSync(join(RAIZ, 'infra/vertra/environments.json'), 'utf8')).ambientes.production.recursos.web.gaId;
    assert.match(declarado, GA_ID, 'o environments.json de produção declara o ID do GA4');
    const a = rodar('loyaltynews', ['--profile', 'production']);
    assert.equal(a.release.gaId, declarado);
    assert.equal(a.manifesto.gaId, declarado);
    assert.equal(rodar('loyaltynews', ['--profile', 'production', '--sem-go-live']).release.gaId, null);
    assert.equal(rodar('loyaltynews-stg', ['--profile', 'staging']).release.gaId, null);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

/** Pasta de pacote mínima + um `npm` falso (que só despeja NEXT_PUBLIC_GA_ID e sai com erro) à frente do PATH: prova o ambiente REAL do `next build` pelo build-web.mjs. */
function ambienteDoBuild(release, painel = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ln-gabuild-'));
  const bin = join(d, 'bin');
  mkdirSync(bin);
  const dump = join(d, 'dump.txt');
  if (process.platform === 'win32') writeFileSync(join(bin, 'npm.cmd'), '@echo off\r\n>"%LN_DUMP%" echo GA=%NEXT_PUBLIC_GA_ID%\r\nexit /b 1\r\n');
  else { writeFileSync(join(bin, 'npm'), '#!/bin/sh\necho "GA=$NEXT_PUBLIC_GA_ID" > "$LN_DUMP"\nexit 1\n'); chmodSync(join(bin, 'npm'), 0o755); }
  writeFileSync(join(d, 'release.json'), JSON.stringify({ siteUrl: 'https://www.loyaltynews.com.br', appEnv: 'production', indexavel: true, ...release }));
  const env = { PATH: bin + delimiter + process.env.PATH, SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, LN_DUMP: dump, ...painel };
  const r = spawnSync(process.execPath, [join(S, 'build-web.mjs')], { cwd: d, encoding: 'utf8', env });
  let visto = null;
  try { visto = readFileSync(dump, 'utf8').replace(/^﻿/, '').trim(); } catch { /* o build-web nem chegou ao npm */ }
  rmSync(d, { recursive: true, force: true });
  return { visto, r };
}

test('build-web: NEXT_PUBLIC_GA_ID do next build vem SÓ do release.json (o painel e o runner não decidem; ausente ou inválido = apagada)', () => {
  const com = ambienteDoBuild({ gaId: 'G-3Y3YMHMLHZ' }, { NEXT_PUBLIC_GA_ID: 'G-PAINEL99999' });
  assert.equal(com.visto, 'GA=G-3Y3YMHMLHZ', com.r.stdout + com.r.stderr);
  const semNoRelease = ambienteDoBuild({}, { NEXT_PUBLIC_GA_ID: 'G-PAINEL99999' });
  assert.equal(semNoRelease.visto, 'GA=', 'sem gaId no release.json a variável do ambiente é apagada');
  const invalido = ambienteDoBuild({ gaId: 'g-injetado"' }, {});
  assert.equal(invalido.visto, 'GA=', 'gaId inválido no release.json não vira variável');
  const nulo = ambienteDoBuild({ gaId: null }, {});
  assert.equal(nulo.visto, 'GA=');
});

test('pré-construído: o .next só vale com o MESMO gaId do release.json (o ID é embutido no bundle); sem ID nos dois lados passa', () => {
  const commit = 'c'.repeat(40);
  const base = { commit, appEnv: 'production', siteUrl: 'https://www.loyaltynews.com.br', vitrine: false, indexavel: true, flagsLigadas: [], buildId: 'build_abc123', nextVersion: null, externos: [] };
  assert.deepEqual(problemasPrebuilt({ ...base, gaId: 'G-3Y3YMHMLHZ' }, { ...base, gaId: 'G-3Y3YMHMLHZ' }, null), []);
  assert.deepEqual(problemasPrebuilt({ ...base }, { ...base }, null), []);
  assert.deepEqual(problemasPrebuilt({ ...base, gaId: null }, { ...base }, null), []);
  assert.match(problemasPrebuilt({ ...base, gaId: 'G-AAAAAAAAAA' }, { ...base, gaId: 'G-3Y3YMHMLHZ' }, null).join('|'), /gaId do pré-construído/);
  assert.match(problemasPrebuilt({ ...base }, { ...base, gaId: 'G-3Y3YMHMLHZ' }, null).join('|'), /gaId do pré-construído \("nenhum"\)/);
  assert.match(problemasPrebuilt({ ...base, gaId: 'G-3Y3YMHMLHZ' }, { ...base }, null).join('|'), /difere do release\.json \("nenhum"\)/);
});
