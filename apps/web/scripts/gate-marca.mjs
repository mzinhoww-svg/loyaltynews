// Gate de marca do portal (UI/UX): CLS, acessibilidade (axe WCAG 2.0/2.1 AA), fonte da marca e contraste dos tokens.
// Transforma os numeros que viviam em relatorio em porta de CI: sai com codigo 1 se qualquer peca falhar.
//
// Uso:
//   node apps/web/scripts/gate-marca.mjs                 # sobe o build de vitrine (reaproveita se o carimbo bate) e mede
//   node apps/web/scripts/gate-marca.mjs --base-url URL  # mede um servidor ja no ar (nao sobe nada)
//   node apps/web/scripts/gate-marca.mjs --sem-unit      # pula a fase estatica (vitest do @ln/ui)
//   node apps/web/scripts/gate-marca.mjs --so-cls        # somente CLS (usado no controle negativo)
//
// Protocolo: auditoria-design/acessibilidade/gate-marca-portal.md
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const WEB = resolve(AQUI, '..'); // apps/web
const RAIZ = resolve(WEB, '../..');

// Criterio (mesmo do aceite de tipografia e do PM): CLS <= 0,10 em cada largura; axe 0 violacoes;
// 1 arquivo de fonte da marca por pagina; familia Inter resolvida na manchete.
const CLS_MAX = 0.1;
const LARGURAS = [390, 768, 1280];
const ROTAS = (argumento('--rotas', '') || '/,/noticia/mock-mercado-1,/editoria/mercado')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);
const FONTE_ESPERADA = /inter/i;
const WOFF2_MAX = 1;

function argumento(nome, padrao = null) {
  const i = process.argv.indexOf(nome);
  return i === -1 ? padrao : process.argv[i + 1] ?? padrao;
}
const baseUrl = argumento('--base-url', process.env.GATE_MARCA_BASE_URL ?? null);
const semUnit = process.argv.includes('--sem-unit');
const soCls = process.argv.includes('--so-cls');
const porta = argumento('--porta', '3199');

function rodar(comando, args, opcoes = {}) {
  const r = spawnSync(comando, args, { stdio: 'inherit', ...opcoes });
  return r.status ?? 1;
}

function faseEstatica() {
  process.stdout.write('\n== fase estatica: tokens, contraste e templates (@ln/ui) ==\n');
  const vitest = join(RAIZ, 'node_modules', 'vitest', 'vitest.mjs');
  if (!existsSync(vitest)) {
    process.stdout.write(`! vitest nao encontrado em ${vitest}\n`);
    return 1;
  }
  return rodar(process.execPath, [vitest, 'run', 'packages/ui/src/__tests__/contrast.test.ts'], { cwd: RAIZ });
}

async function esperarServidor(url, limiteMs) {
  const inicio = Date.now();
  while (Date.now() - inicio < limiteMs) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

/** CLS pela mesma fonte que o Chrome usa: entradas layout-shift sem interacao recente, janela de 5 s. */
async function medirCls(page, rota) {
  await page.goto(rota, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);
  return page.evaluate(() => window.__clsGate ?? 0);
}

async function medirFonte(page) {
  return page.evaluate(() => {
    const woff2 = performance
      .getEntriesByType('resource')
      .filter((r) => /\.woff2(\?|$)/i.test(r.name))
      .map((r) => ({ url: r.name.split('/').pop(), bytes: r.transferSize || r.encodedBodySize }));
    const alvo = document.querySelector('h1, h2');
    const familia = alvo ? getComputedStyle(alvo).fontFamily : '';
    return { woff2, familia };
  });
}

async function main() {
  const resultados = [];
  let falhas = 0;

  if (!semUnit && !soCls) {
    const status = faseEstatica();
    if (status !== 0) {
      falhas += 1;
      process.stdout.write('FALHA na fase estatica (@ln/ui)\n');
    }
  }

  let servidor = null;
  let url = baseUrl;
  if (!url) {
    process.stdout.write(`\n== servidor de vitrine na porta ${porta} (build reaproveitado se o carimbo bate) ==\n`);
    // O MODO é do perfil 'vitrine' do portal-server (PORTAL_VITRINE=1 + APP_ENV=staging, a mesma vitrine do staging):
    // o gate mede o build real de vitrine, não um servidor de teste. PORTAL_SOURCE=mock é variável só de teste e NÃO
    // é atribuída aqui (GLOBAL-TESTFLAGS; e o portal não aceita mock em deploy de qualquer forma).
    servidor = spawn(process.execPath, [join(WEB, 'e2e', 'portal-server.mjs'), porta, 'vitrine'], {
      cwd: WEB,
      env: {
        ...process.env,
        NEXT_PUBLIC_SITE_URL: 'https://portal.example.test',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    url = `http://localhost:${porta}`;
    const subiu = await esperarServidor(url, 25 * 60 * 1000);
    if (!subiu) {
      process.stdout.write(`FALHA: servidor nao respondeu em ${url}\n`);
      servidor.kill();
      process.exit(1);
    }
  }

  const { chromium } = await import('@playwright/test');
  const navegador = await chromium.launch();
  try {
    const contexto = await navegador.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    const page = await contexto.newPage();
    // Uma vez por contexto: o init script roda em cada navegacao e zera o acumulador no documento novo.
    await page.addInitScript(() => {
      window.__clsGate = 0;
      new PerformanceObserver((lista) => {
        for (const e of lista.getEntries()) {
          if (!e.hadRecentInput) window.__clsGate += e.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    for (const rota of ROTAS) {
      for (const largura of LARGURAS) {
        await page.setViewportSize({ width: largura, height: 900 });
        const cls = await medirCls(page, `${url}${rota}`);
        resultados.push({ rota, largura, checagem: 'CLS', valor: cls, limite: CLS_MAX, ok: cls <= CLS_MAX });

        if (soCls) continue;

        const fonte = await medirFonte(page);
        const woff2 = fonte.woff2.length;
        resultados.push({
          rota,
          largura,
          checagem: 'arquivos de fonte',
          valor: woff2,
          limite: WOFF2_MAX,
          ok: woff2 <= WOFF2_MAX,
        });
        resultados.push({
          rota,
          largura,
          checagem: 'familia da manchete',
          valor: fonte.familia,
          limite: 'Inter',
          ok: FONTE_ESPERADA.test(fonte.familia),
        });

        const { default: AxeBuilder } = await import('@axe-core/playwright');
        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        resultados.push({
          rota,
          largura,
          checagem: 'axe (violacoes)',
          valor: axe.violations.length,
          limite: 0,
          ok: axe.violations.length === 0,
          detalhe: axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`).join(' ; '),
        });
      }
    }
  } finally {
    await navegador.close().catch(() => {});
    if (servidor) {
      // Arvore do next start no Windows: taskkill /T para nao deixar processo orfao na porta.
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(servidor.pid), '/T', '/F'], { stdio: 'ignore' });
      else servidor.kill('SIGTERM');
    }
  }

  const problemas = resultados.filter((r) => !r.ok);
  falhas += problemas.length;

  process.stdout.write('\n| rota | largura | checagem | medido | limite | resultado |\n|---|---|---|---|---|---|\n');
  for (const r of resultados) {
    const medido = typeof r.valor === 'number' ? r.valor.toFixed(3) : String(r.valor).slice(0, 60);
    process.stdout.write(`| ${r.rota} | ${r.largura} | ${r.checagem} | ${medido} | ${r.limite} | ${r.ok ? 'passa' : 'FALHA'} |\n`);
  }
  for (const p of problemas.filter((p) => p.detalhe)) process.stdout.write(`\n- ${p.rota} @${p.largura} ${p.checagem}: ${p.detalhe}\n`);

  const saida = join(RAIZ, '.test-results', 'gate-marca.json');
  mkdirSync(dirname(saida), { recursive: true });
  writeFileSync(saida, JSON.stringify({ data: new Date().toISOString(), url, resultados }, null, 2));

  process.stdout.write(`\n${falhas === 0 ? 'GATE DE MARCA: VERDE' : `GATE DE MARCA: VERMELHO (${falhas} falha(s))`}\n`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((erro) => {
  process.stdout.write(`FALHA no gate: ${erro?.stack ?? erro}\n`);
  process.exit(1);
});
