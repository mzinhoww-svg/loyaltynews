// DP-76: o smoke da produção exige EXATAMENTE as flags por commit do commit publicado (PRODUCTION_FLAGS_ON) e pessoas desligadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { contratoCom, repoDeFlags } from './apoio-repo-flags.mjs';

const S = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const RAIZ = join(S, '..', '..');

/** Produção limpa de mentira; `estado` muda o que o health e as rotas de pessoas dizem. */
async function producaoFalsa() {
  const estado = { sha: '', flags: [], pessoas: false };
  const s = createServer((req, res) => {
    const u = req.url.split('?')[0];
    const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const texto = (tipo, b) => { res.writeHead(200, { 'content-type': tipo }); res.end(b); };
    if (u === '/api/health') return json({ status: 'ok', version: estado.sha, env: 'production', ...(estado.flags === null ? {} : { flags: estado.flags }) });
    if (u === '/api/ready') return json({ status: 'ok', mode: 'completo', db: 'ok', redis: 'ok', migracoes: 'ok' });
    if (u === '/api/publico/site') return json({ nome: 'Loyalty News' });
    if (u === '/api/publico/editorias') return json({ data: Array.from({ length: 10 }, (_, i) => ({ slug: 'e' + i })) });
    if (u === '/api/publico/materias' || u === '/api/publico/agenda') return json({ data: [] });
    if (u.startsWith('/api/publico/intelligence/')) return json({ data: [], total: 0, disponivel: estado.pessoas });
    if (['/', '/noticias', '/midia-kit', '/intelligence'].includes(u)) return texto('text/html', '<meta name="robots" content="noindex"/>ok');
    if (u === '/robots.txt') return texto('text/plain', 'User-agent: *\nDisallow: /\n');
    if (u === '/sitemap.xml') return texto('application/xml', '<urlset></urlset>');
    if (u === '/feed.xml') return texto('application/rss+xml', '<rss></rss>');
    if (u === '/studio') { res.writeHead(307, { location: '/studio/entrar' }); return res.end(); }
    if (u === '/studio/entrar') return texto('text/html', 'login');
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + s.address().port;
  const smoke = (args) => new Promise((resolve) => {
    const c = spawn(process.execPath, [join(S, 'smoke-producao.mjs'), '--url', url, '--consecutivas', '1', ...args]);
    let stdout = '', stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stderr, j: stdout ? JSON.parse(stdout) : null }));
  });
  return { estado, smoke, fechar: () => s.close() };
}
const falhas = (r) => r.j.checagens.filter((c) => !c.ok);
const nomes = (r) => falhas(r).map((c) => c.nome.split(' (')[0].replace(/ \[[^\]]*\]$/, ''));
const FLAGS = 'health: flags ligadas = exatamente as do commit publicado';

test('smoke-producao: flags do /api/health = exatamente PRODUCTION_FLAGS_ON do commit; a mais, a menos, repetida ou ausente reprova', async () => {
  const repo = repoDeFlags([contratoCom(['portalFormularios']), contratoCom(['publicacaoPortal', 'portalFormularios']), contratoCom([])]);
  const p = await producaoFalsa();
  const [soFormulario, comPublicacao, semFlags] = repo.commits;
  const roda = (sha, flags) => { p.estado.sha = sha; p.estado.flags = flags; return p.smoke(['--expect-commit', sha, '--repo', repo.dir]); };
  try {
    const casos = [
      [soFormulario, ['portalFormularios'], [[], ['publicacaoPortal'], ['portalFormularios', 'publicacaoPortal'], ['portalFormularios', 'portalFormularios']]],
      [comPublicacao, ['portalFormularios', 'publicacaoPortal'], [[], ['portalFormularios'], ['publicacaoPortal'], ['portalFormularios', 'publicacaoPortal', 'publicacaoAutonoma']]],
      [semFlags, [], [['portalFormularios']]],
    ];
    for (const [sha, certas, erradas] of casos) {
      for (const flags of [certas, [...certas].reverse()]) {
        const ok = await roda(sha, flags);
        assert.equal(ok.status, 0, JSON.stringify(falhas(ok)));
        assert.deepEqual(ok.j.exigiu.flags, certas);
      }
      for (const flags of [...erradas, null]) {
        const r = await roda(sha, flags);
        assert.equal(r.status, 1, `commit com [${certas}] e health [${flags}] tinha de reprovar`);
        assert.ok(nomes(r).includes(FLAGS), JSON.stringify(falhas(r)));
      }
    }
    const aMais = await roda(soFormulario, ['portalFormularios', 'publicacaoPortal']);
    assert.match(falhas(aMais)[0].detalhe, /a mais=\[publicacaoPortal\] a menos=\[\]/);
    const aMenos = await roda(comPublicacao, ['portalFormularios']);
    assert.match(falhas(aMenos)[0].detalhe, /a mais=\[\] a menos=\[publicacaoPortal\]/);
  } finally { p.fechar(); repo.apagar(); }
});

test('smoke-producao: pessoas ligadas reprovam, mesmo que o commit liste intelligencePessoas', async () => {
  const repo = repoDeFlags([contratoCom(['portalFormularios', 'intelligencePessoas']), contratoCom(['portalFormularios'])]);
  const p = await producaoFalsa();
  const [comPessoas, semPessoas] = repo.commits;
  try {
    p.estado.sha = comPessoas; p.estado.flags = ['intelligencePessoas', 'portalFormularios'];
    const r = await p.smoke(['--expect-commit', comPessoas, '--repo', repo.dir]);
    assert.equal(r.status, 1);
    assert.deepEqual(nomes(r), ['health: intelligencePessoas desligada em produção']);
    p.estado.sha = semPessoas; p.estado.flags = ['portalFormularios']; p.estado.pessoas = true;
    const dados = await p.smoke(['--expect-commit', semPessoas, '--repo', repo.dir]);
    assert.equal(dados.status, 1);
    assert.deepEqual(nomes(dados), ['intelligence/pessoas: desligada em produção', 'intelligence/moves: desligada em produção']);
  } finally { p.fechar(); repo.apagar(); }
});

test('smoke-producao: sem saber as flags do commit, reprova (sem --expect-commit, commit ausente ou contrato inválido), mesmo com health sem flags', async () => {
  const invalido = "export const PRODUCTION_FLAGS_ON = ['adServerVendas'];\nexport function productionFlagsByCommit() { throw new Error('flag sem decisão para production'); }\n";
  const repo = repoDeFlags([invalido, 'isto não é typescript {{{\n']);
  const p = await producaoFalsa();
  try {
    for (const [args, motivo] of [
      [[], /--expect-commit/],
      [['--expect-commit', 'a'.repeat(40), '--repo', repo.dir], /não li packages\/contracts\/src\/flags\.ts/],
      [['--expect-commit', repo.commits[0], '--repo', repo.dir], /sem decisão para production/],
      [['--expect-commit', repo.commits[1], '--repo', repo.dir], /não carrega/],
    ]) {
      p.estado.sha = args[1] ?? 'a'.repeat(40);
      for (const flags of [[], ['adServerVendas']]) {
        p.estado.flags = flags;
        const r = await p.smoke(args);
        assert.equal(r.status, 1, JSON.stringify(args));
        const c = falhas(r).find((x) => x.nome.startsWith(FLAGS));
        assert.ok(c, JSON.stringify(falhas(r)));
        assert.match(c.detalhe, motivo);
        assert.equal(r.j.exigiu.flags, null);
      }
    }
  } finally { p.fechar(); repo.apagar(); }
});

test('smoke-producao sem --repo lê o commit do checkout do próprio script (HEAD), de qualquer pasta', async () => {
  const sha = spawnSync('git', ['-C', RAIZ, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const { flagsDoCommit } = await import(pathToFileURL(join(S, 'lib', 'flags-do-commit.mjs')).href);
  const certas = await flagsDoCommit({ commit: sha });
  assert.ok(certas.length > 0, 'o contrato do HEAD tem flags por commit');
  const p = await producaoFalsa();
  try {
    p.estado.sha = sha; p.estado.flags = certas;
    const ok = await p.smoke(['--expect-commit', sha]);
    assert.equal(ok.status, 0, JSON.stringify(falhas(ok)));
    p.estado.flags = certas.slice(1);
    assert.equal((await p.smoke(['--expect-commit', sha])).status, 1);
  } finally { p.fechar(); }
});
