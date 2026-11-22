// Prova (QA/Security) de que o build de PRODUÇÃO do Studio não contém nem aceita a sessão simulada nem o banco PGlite em memória:
//  1) `next build` com LN_STUDIO_TEST_SESSION ou LN_STUDIO_DEV_DB definida (sem LN_E2E_BUILD) deve FALHAR;
//  2) build de produção limpo não pode conter os marcadores do código simulado (ln-test-session, parseTestSession, electric-sql/pglite);
//  3) servidor de produção iniciado COM as duas variáveis no ambiente e cookie simulado continua NEGANDO (NO_SESSION) e sobe sem o código de dev;
//  4) controle positivo: se existir .next-e2e, os marcadores têm de aparecer lá (prova que a varredura enxerga o mock).
// Uso: npm run verify:no-mock -w @ln/web   (VERIFY_PORT define a porta; padrão 3190)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MARKERS = ['ln-test-session', 'parseTestSession', 'LN_STUDIO_TEST_SESSION', 'electric-sql/pglite'];
const PORT = Number(process.env.VERIFY_PORT ?? 3190);
const base = { ...process.env };
delete base.LN_E2E_BUILD;
delete base.LN_STUDIO_TEST_SESSION;
delete base.LN_STUDIO_DEV_DB;

let falhas = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const fail = (m) => {
  falhas++;
  console.log(`  FAIL ${m}`);
};

function scan(dir) {
  const achados = new Set();
  const walk = (d) => {
    for (const nome of readdirSync(d)) {
      if (nome === 'cache') continue;
      const p = join(d, nome);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(js|mjs|cjs|json|html|rsc|map|txt|css)$/.test(nome)) {
        const txt = readFileSync(p, 'utf8');
        for (const m of MARKERS) if (txt.includes(m)) achados.add(m);
      }
    }
  };
  walk(dir);
  return [...achados];
}

console.log('1) build de produção com LN_STUDIO_TEST_SESSION ou LN_STUDIO_DEV_DB definida deve falhar');
for (const v of ['LN_STUDIO_TEST_SESSION', 'LN_STUDIO_DEV_DB']) {
  const r = spawnSync('npx next build', { shell: true, env: { ...base, [v]: v === 'LN_STUDIO_DEV_DB' ? 'pglite' : '1' }, encoding: 'utf8' });
  const saida = `${r.stdout}
${r.stderr}`;
  if (r.status !== 0 && saida.includes('Build recusado') && saida.includes(v)) ok(`build recusado com ${v} definida`);
  else fail(`build deveria ser recusado com ${v} (status ${r.status})`);
}

console.log('2) build de produção limpo não contém o código simulado');
rmSync('.next', { recursive: true, force: true });
{
  const r = spawnSync('npx next build', { shell: true, env: base, encoding: 'utf8' });
  if (r.status !== 0) {
    fail(`build de produção falhou:\n${r.stdout}\n${r.stderr}`);
    process.exit(1);
  }
  const achados = scan('.next');
  if (achados.length === 0) ok('nenhum marcador do mock em .next');
  else fail(`marcadores encontrados em .next: ${achados.join(', ')}`);
}

console.log('3) servidor de produção com as variáveis no ambiente e cookie simulado continua negando');
{
  const srv = spawn('npx', ['next', 'start', '--port', String(PORT)], {
    shell: true,
    env: { ...base, LN_STUDIO_TEST_SESSION: '1', LN_STUDIO_DEV_DB: 'pglite' },
    stdio: 'ignore',
  });
  try {
    let pronto = false;
    for (let i = 0; i < 60 && !pronto; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        pronto = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok;
      } catch {
        /* aguardando */
      }
    }
    if (!pronto) fail('servidor de produção não subiu');
    else {
      for (const rota of ['/studio', '/studio/cms', '/studio/cms/nova']) {
        const r = await fetch(`http://127.0.0.1:${PORT}${rota}`, { redirect: 'manual', headers: { cookie: 'ln-test-session=ana:admin' } });
        const loc = r.headers.get('location') ?? '';
        if (r.status >= 300 && r.status < 400 && loc.includes('/studio/entrar') && loc.includes('NO_SESSION')) ok(`${rota} negado (${r.status} → ${loc})`);
        else fail(`${rota} deveria negar; status ${r.status} location ${loc}`);
      }
    }
  } finally {
    spawnSync(`taskkill /pid ${srv.pid} /T /F`, { shell: true, stdio: 'ignore' });
    srv.kill();
  }
}

console.log('4) controle positivo: o build de e2e contém o mock (a varredura enxerga)');
if (existsSync('.next-e2e')) {
  const achados = scan('.next-e2e');
  if (achados.includes('ln-test-session') && achados.includes('electric-sql/pglite')) ok('marcadores presentes em .next-e2e (varredura válida)');
  else fail(`varredura não achou todos os marcadores no build de e2e (${achados.join(', ')}): verificação inconclusiva`);
} else {
  console.log('  -    .next-e2e ausente (rode npm run e2e antes para o controle positivo)');
}

console.log(falhas === 0 ? '\nRESULTADO: ok' : `\nRESULTADO: ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
