// DP-54: go-live por COMMIT REVISADO. O domínio próprio e a indexação da produção são declarados no environments.json do commit e lidos pelo package-web (lib/go-live.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HOST_DOMINIO, resolverGoLive } from '../scripts/lib/go-live.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const RAIZ = join(S, '..', '..');
const prod = { profile: 'production', appKey: 'web' };

test('HOST_DOMINIO: hostname DNS em minúsculas; recusa esquema, barra, porta, curinga, maiúsculas, IP e underscore', () => {
  for (const ok of ['www.loyaltynews.com.br', 'loyaltynews.com.br', 'a-b.example.org', 'x.co']) assert.ok(HOST_DOMINIO.test(ok), ok);
  for (const ruim of ['https://www.x.com.br', 'www.x.com.br/', 'www.x.com.br:443', '*.x.com.br', 'WWW.x.com.br', '1.2.3.4', 'a_b.x.com', '-a.x.com', 'a-.x.com', 'semponto', '.x.com', 'x..com', 'x.com.', 'x y.com']) assert.ok(!HOST_DOMINIO.test(ruim), ruim);
});

test('resolverGoLive: produção/web com dominio e indexavel declarados → domínio e indexável; sem declaração → como antes do go-live', () => {
  assert.deepEqual(resolverGoLive({ web: { dominio: 'www.loyaltynews.com.br', indexavel: true }, ...prod }), { dominio: 'www.loyaltynews.com.br', indexavel: true, gaId: null });
  assert.deepEqual(resolverGoLive({ web: { subdominio: 'loyaltynews' }, ...prod }), { dominio: null, indexavel: false, gaId: null });
  assert.deepEqual(resolverGoLive({ web: { dominio: 'www.loyaltynews.com.br', indexavel: false }, ...prod }), { dominio: 'www.loyaltynews.com.br', indexavel: false, gaId: null });
  assert.deepEqual(resolverGoLive({ web: { indexavel: true }, ...prod }), { dominio: null, indexavel: true, gaId: null });
});

test('resolverGoLive: --sem-go-live ignora a declaração; --indexavel da linha de comando continua valendo; o worker nunca é afetado', () => {
  const web = { dominio: 'www.loyaltynews.com.br', indexavel: true };
  assert.deepEqual(resolverGoLive({ web, ...prod, semGoLive: true }), { dominio: null, indexavel: false, gaId: null });
  assert.deepEqual(resolverGoLive({ web: {}, ...prod, indexavelArg: true }), { dominio: null, indexavel: true, gaId: null });
  assert.deepEqual(resolverGoLive({ web: {}, profile: 'production', appKey: 'workers' }), { dominio: null, indexavel: false, gaId: null });
});

test('resolverGoLive: recusa domínio inválido, domínio da Vertra, tipos errados, e qualquer declaração fora de produção/web', () => {
  const erro = (web, ctx = prod) => { try { resolverGoLive({ web, ...ctx }); return null; } catch (e) { return e.message; } };
  assert.match(erro({ dominio: 'https://www.x.com.br' }), /inválido/);
  assert.match(erro({ dominio: 'WWW.X.COM.BR' }), /inválido/);
  assert.match(erro({ dominio: 'loyaltynews.vertraweb.app' }), /fora de \*\.vertraweb\.app/);
  assert.match(erro({ dominio: 42 }), /inválido/);
  assert.match(erro({ dominio: 'a'.repeat(260) + '.com' }), /inválido/);
  assert.match(erro({ indexavel: 'true' }), /true ou false/);
  assert.match(erro({ indexavel: 1 }), /true ou false/);
  for (const ctx of [{ profile: 'staging', appKey: 'web' }, { profile: 'staging-min', appKey: 'web' }, { profile: 'production', appKey: 'workers' }]) {
    assert.match(erro({ dominio: 'www.loyaltynews.com.br' }, ctx), /só vale para o web do perfil production/, JSON.stringify(ctx));
    assert.match(erro({ indexavel: true }, ctx), /só vale para o web do perfil production/, JSON.stringify(ctx));
  }
  assert.equal(erro({ indexavel: false }, { profile: 'staging', appKey: 'web' }), null, 'false em staging é inofensivo');
});

test('package-web (repositório real): produção sai com o domínio do environments.json e indexável; --sem-go-live volta ao subdomínio e não indexável; staging nunca muda', () => {
  const out = mkdtempSync(join(tmpdir(), 'ln-golive-'));
  try {
    const rodar = (sub, extra) => {
      const d = join(out, sub);
      const r = spawnSync(process.execPath, [join(S, 'package-web.mjs'), '--repo', '.', '--commit', 'HEAD', '--out', d, '--subdomain', sub, ...extra], { encoding: 'utf8', cwd: RAIZ });
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const j = JSON.parse(r.stdout);
      return { release: JSON.parse(readFileSync(join(j.pasta, 'release.json'), 'utf8')), manifesto: JSON.parse(readFileSync(j.manifesto, 'utf8')) };
    };
    const real = JSON.parse(readFileSync(join(RAIZ, 'infra/vertra/environments.json'), 'utf8')).ambientes.production.recursos.web;
    assert.equal(real.dominio, 'www.loyaltynews.com.br', 'o environments.json de produção declara o domínio (DP-54)');
    assert.equal(real.indexavel, true);
    const a = rodar('loyaltynews', ['--profile', 'production']);
    assert.equal(a.release.siteUrl, 'https://www.loyaltynews.com.br');
    assert.equal(a.release.dominio, 'www.loyaltynews.com.br');
    assert.equal(a.release.indexavel, true);
    assert.equal(a.manifesto.siteUrl, 'https://www.loyaltynews.com.br');
    const vars = JSON.stringify(a.manifesto.depois_do_create);
    assert.match(vars, /"nome":"NEXT_PUBLIC_SITE_URL","valor":"https:\/\/www\.loyaltynews\.com\.br"/);
    assert.match(vars, /"nome":"BETTER_AUTH_URL","valor":"https:\/\/www\.loyaltynews\.com\.br"/);
    assert.match(vars, /"nome":"PORTAL_INDEXAVEL","valor":"1"/);
    const b = rodar('loyaltynews', ['--profile', 'production', '--sem-go-live', '--force']);
    assert.equal(b.release.siteUrl, 'https://loyaltynews.vertraweb.app');
    assert.equal(b.release.dominio, null);
    assert.equal(b.release.indexavel, false);
    const c = rodar('loyaltynews-stg', ['--profile', 'staging']);
    assert.equal(c.release.siteUrl, 'https://loyaltynews-stg.vertraweb.app');
    assert.equal(c.release.indexavel, false);
    assert.equal(c.release.dominio, null);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('package-web (CLI) recusa um commit cujo environments.json declara domínio inválido ou go-live fora de produção/web (exit 2, antes de montar qualquer pacote)', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'ln-golive-repo-'));
  try {
    const git = (...a) => spawnSync('git', ['-C', raiz, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
    assert.equal(git('init', '-q').status, 0);
    mkdirSync(join(raiz, 'infra/vertra'), { recursive: true });
    const base = JSON.parse(readFileSync(join(RAIZ, 'infra/vertra/environments.json'), 'utf8'));
    const casos = [
      ['dominio inválido', (e) => { e.ambientes.production.recursos.web.dominio = 'https://www.x.com.br/'; }, /inválido/, ['--profile', 'production']],
      ['domínio da Vertra no campo dominio', (e) => { e.ambientes.production.recursos.web.dominio = 'loyaltynews.vertraweb.app'; }, /fora de \*\.vertraweb\.app/, ['--profile', 'production']],
      ['dominio no staging', (e) => { e.ambientes.staging.recursos.web.dominio = 'www.loyaltynews.com.br'; }, /só vale para o web do perfil production/, ['--profile', 'staging']],
      ['indexavel true no staging', (e) => { e.ambientes.staging.recursos.web.indexavel = true; }, /só vale para o web do perfil production/, ['--profile', 'staging']],
      ['indexavel não booleano', (e) => { e.ambientes.production.recursos.web.indexavel = 'sim'; }, /true ou false/, ['--profile', 'production']],
    ];
    for (const [nome, muda, esperado, perfil] of casos) {
      const e = structuredClone(base);
      muda(e);
      writeFileSync(join(raiz, 'infra/vertra/environments.json'), JSON.stringify(e, null, 2));
      assert.equal(git('add', '-A').status, 0);
      assert.equal(git('commit', '-q', '-m', nome).status, 0);
      const r = spawnSync(process.execPath, [join(S, 'package-web.mjs'), '--repo', raiz, '--commit', 'HEAD', '--out', join(raiz, 'saida'), '--subdomain', 'loyaltynews', ...perfil], { encoding: 'utf8' });
      assert.equal(r.status, 2, `${nome}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, esperado, nome);
      assert.ok(!readdirSync(raiz).includes('saida'), `${nome}: nenhum pacote montado`);
    }
    assert.ok(statSync(raiz).isDirectory());
  } finally { rmSync(raiz, { recursive: true, force: true }); }
});
