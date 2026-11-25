import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Medição da tipografia conforme auditoria-design/tipografia/aceite-tipografia.md (UI/UX, 25/11/2026).
 * Chromium headless, processo de navegador novo por rodada (cache frio), CDP 1,6 Mbps / 750 kbps / 150 ms e CPU 4x.
 * Antes e depois usam este mesmo spec, contra um build de produção local (next build + next start).
 *
 *   TIPOGRAFIA_BASE=http://localhost:3000
 *   TIPOGRAFIA_LADO=antes|depois|negativo   (nome das pastas de evidência)
 *   TIPOGRAFIA_SAIDA=<pasta>                (padrão: e2e/tipografia/evidencias/<lado>)
 *   TIPOGRAFIA_RODADAS=3
 *   TIPOGRAFIA_FONTE_BLOQUEADA=1            (roda só o caso do .woff2 abortado a 768 no perfil)
 */
const BASE = process.env.TIPOGRAFIA_BASE ?? 'http://localhost:3000';
const LADO = process.env.TIPOGRAFIA_LADO ?? 'depois';
const SAIDA = process.env.TIPOGRAFIA_SAIDA ?? join('e2e', 'tipografia', 'evidencias', LADO);
const RODADAS = Number(process.env.TIPOGRAFIA_RODADAS ?? 3);
const SO_FONTE_BLOQUEADA = process.env.TIPOGRAFIA_FONTE_BLOQUEADA === '1';

const PESSOA = '/intelligence/pessoas/00000000-0000-4000-8000-0000000000f1';
const LARGURAS = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const;
const PAGINAS = [
  { slug: 'home', path: '/' },
  { slug: 'pessoa', path: PESSOA },
] as const;

mkdirSync(join(SAIDA, 'screenshots'), { recursive: true });

type Perf = { fcp: number | null; lcp: number | null; cls: number; fontes: { url: string; decoded: number; transfer: number; responseEnd?: number }[]; preload: string | null; faces: number; facesUrl: number; shifts: unknown[]; lcpEl: { tag: string; cls: string; size: number; url: string | null } | null };

const COLETA = () => {
  const w = window as unknown as { __perf: { fcp: number | null; lcp: number; cls: number; shifts: unknown[]; lcpEl?: unknown } };
  w.__perf = { fcp: null, lcp: 0, cls: 0, shifts: [] };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') w.__perf.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as Array<PerformanceEntry & { element?: Element | null; url?: string; size?: number }>) {
      w.__perf.lcp = e.startTime;
      w.__perf.lcpEl = e.element
        ? { tag: e.element.tagName.toLowerCase(), cls: String((e.element as HTMLElement).className ?? ''), size: Math.round(e.size ?? 0), url: e.url ?? null }
        : null;
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number; sources?: Array<{ node?: Node | null; previousRect?: DOMRectReadOnly; currentRect?: DOMRectReadOnly }> }>) {
      if (!e.hadRecentInput) w.__perf.cls += e.value ?? 0;
      if (!e.hadRecentInput && (e.value ?? 0) > 0) {
        w.__perf.shifts.push({
          t: Math.round(e.startTime),
          value: Math.round((e.value ?? 0) * 1000) / 1000,
          fontes: (e.sources ?? []).map((s) => ({
            no: s.node instanceof HTMLElement ? `${s.node.tagName.toLowerCase()}.${String(s.node.className)}` : s.node?.nodeName ?? null,
            de: s.previousRect ? { y: Math.round(s.previousRect.y), h: Math.round(s.previousRect.height) } : null,
            para: s.currentRect ? { y: Math.round(s.currentRect.y), h: Math.round(s.currentRect.height) } : null,
          })),
        });
      }
    }
  }).observe({ type: 'layout-shift', buffered: true });
};

async function medir(page: Page): Promise<Perf> {
  const perf = await page.evaluate(() => {
    const w = window as unknown as { __perf: { fcp: number | null; lcp: number; cls: number } };
    const fontes = performance
      .getEntriesByType('resource')
      .filter((e) => /\.woff2?($|\?)/.test(e.name))
      .map((e) => ({ url: e.name, decoded: (e as PerformanceResourceTiming).decodedBodySize, transfer: (e as PerformanceResourceTiming).transferSize, responseEnd: Math.round((e as PerformanceResourceTiming).responseEnd) }));
    const link = document.querySelector('link[rel="preload"][as="font"]');
    let faces = 0;
    let facesUrl = 0;
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (!(rule instanceof CSSFontFaceRule)) continue;
          faces++;
          if (/url\(/.test(rule.cssText)) facesUrl++;
        }
      } catch {
        /* folha de outra origem */
      }
    }
    return {
      fcp: w.__perf.fcp === null ? null : Math.round(w.__perf.fcp),
      lcp: w.__perf.lcp ? Math.round(w.__perf.lcp) : null,
      cls: Math.round(w.__perf.cls * 1000) / 1000,
      fontes,
      preload: link ? link.getAttribute('href') : null,
      faces,
      facesUrl,
      shifts: w.__perf.shifts ?? [],
      lcpEl: (w.__perf.lcpEl as Perf["lcpEl"]) ?? null,
    };
  });
  return perf;
}

async function rodada(browser: Browser, url: string, width: number, height: number, bloquearFonte: boolean, captura?: string): Promise<Perf & { chromium: string }> {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: 200 * 1024,
    uploadThroughput: 750 * 1024 / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  if (bloquearFonte) await context.route('**/*.woff2', (r) => r.abort());
  await page.addInitScript(COLETA);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const perf = await medir(page);
  if (captura) await page.screenshot({ path: join(SAIDA, 'screenshots', captura), fullPage: true });
  const chromiumVersion = browser.version();
  await context.close();
  return { ...perf, chromium: chromiumVersion };
}

function mediana(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round(((s[m - 1]! + s[m]!) / 2) * 1000) / 1000;
}

const url = (path: string) => new URL(path, BASE).toString();

if (SO_FONTE_BLOQUEADA) {
  const BW = Number(process.env.TIPOGRAFIA_BLOQUEADA_LARGURA ?? 768);
  const BH = BW >= 1280 ? 800 : BW >= 768 ? 1024 : 844;
  test(`perfil a ${BW} com o .woff2 abortado: CLS <= 0,10 (ajuste da reserva)`, async () => {
    const rodadas = [];
    for (let i = 0; i < RODADAS; i++) {
      const browser = await chromium.launch();
      rodadas.push(await rodada(browser, url(PESSOA), BW, BH, true));
      await browser.close();
    }
    writeFileSync(join(SAIDA, `fonte-bloqueada-${BW}.json`), JSON.stringify({ base: BASE, lado: LADO, largura: BW, rodadas }, null, 2));
    expect(mediana(rodadas.map((r) => r.cls))).toBeLessThanOrEqual(0.1);
  });
} else {
  for (const { width, height } of LARGURAS) {
    for (const { slug, path } of PAGINAS) {
      test(`${slug} @${width}: FCP/LCP/CLS (${RODADAS} rodadas, mediana)`, async () => {
        const rodadas = [];
        for (let i = 0; i < RODADAS; i++) {
          const browser = await chromium.launch();
          rodadas.push(await rodada(browser, url(path), width, height, false, i === 0 ? `${LADO}-${slug}-${width}.png` : undefined));
          await browser.close();
        }
        const resumo = {
          base: BASE,
          lado: LADO,
          pagina: slug,
          largura: width,
          rodadas,
          mediana: {
            fcp: mediana(rodadas.map((r) => r.fcp ?? 0)),
            lcp: mediana(rodadas.map((r) => r.lcp ?? 0)),
            cls: mediana(rodadas.map((r) => r.cls)),
          },
        };
        writeFileSync(join(SAIDA, `${slug}-${width}.json`), JSON.stringify(resumo, null, 2));

        // Prova de artefato: 1 @font-face com arquivo (o outro é a reserva local com métricas, do adjustFontFallback).
        // Com display optional e sem preload, a primeira visita lenta pode nem baixar a fonte: os bytes são conferidos quando ela vier.
        const uma = rodadas[0]!;
        if (uma.fontes.length) {
          expect(uma.fontes[0]!.decoded, `${slug} @${width}: bytes da fonte`).toBeGreaterThanOrEqual(48256 - 1024);
          expect(uma.fontes[0]!.decoded, `${slug} @${width}: bytes da fonte`).toBeLessThanOrEqual(48256 + 1024);
          expect(uma.fontes[0]!.url, `${slug} @${width}: subset inesperado`).toMatch(/inter[_-]latin[_-]wght[_-]normal/);
        }
        expect(uma.facesUrl, `${slug} @${width}: @font-face com url no CSS`).toBe(1);
        expect(uma.faces, `${slug} @${width}: @font-face total`).toBeLessThanOrEqual(2);
        expect(resumo.mediana.cls, `${slug} @${width}: CLS`).toBeLessThanOrEqual(0.1);
      });
    }
  }
}

const provas = SO_FONTE_BLOQUEADA ? test.describe.skip : test.describe;

provas('provas funcionais', () => {
  test('família carregada, sem Arial, e Georgia só no corpo/linha fina', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(url('/noticia/mock-mercado-1'), { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const familia = (el: Element) => getComputedStyle(el).fontFamily;
      const amostra = document.querySelector('h1') ?? document.body;
      const primeira = familia(amostra).split(',')[0]!.replace(/^["']|["']$/g, '').trim();
      const alvos = Array.from(document.querySelectorAll('h1, h2, h3, h4, .ln-card, nav a, button, td')).filter(
        // Botão só de ícone (sem texto) não tem família visível; o critério é o texto.
        (el) => el.tagName !== 'BUTTON' || (el.textContent ?? '').trim().length > 0,
      );
      const arial = alvos
        .map((el) => ({ nome: `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className)}`, ff: familia(el) }))
        .filter(({ ff }) => !ff.includes(primeira) && !/Georgia/.test(ff))
        .map(({ nome, ff }) => `${nome} => ${ff}`);
      const corpo = document.querySelector('.pt-body');
      const sub = document.querySelector('.pt-article-sub');
      return {
        primeira,
        check: document.fonts.check(`16px "${primeira}"`),
        arial,
        corpo: corpo ? familia(corpo) : null,
        sub: sub ? familia(sub) : null,
      };
    });
    await browser.close();
    expect(r.check, `document.fonts.check("16px ${r.primeira}")`).toBe(true);
    expect(r.arial, `elementos de interface fora da família: ${r.arial.join(' | ')}`).toEqual([]);
    expect(r.corpo).toMatch(/Georgia/);
    expect(r.sub).toMatch(/Georgia/);
  });

  for (const rota of ['/studio/creative', '/studio'] as const) {
    test(`Studio ${rota} a 1280: família certa, 1 fonte e CLS <= 0,05`, async () => {
      const browser = await chromium.launch();
      const rodadas = [];
      let funcional: { familia: string; check: boolean; arial: number; preload: string | null; faces: number; facesUrl: number } | null = null;
      for (let i = 0; i < RODADAS; i++) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const login = await context.request.get(url('/api/e2e/login?user=qa8&role=admin&mfa=1'));
        expect(login.ok(), 'login do fixture de e2e').toBe(true);
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200 * 1024, uploadThroughput: 750 * 1024 / 8 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await page.addInitScript(COLETA);
        await page.goto(url(rota), { waitUntil: 'load' });
        await page.waitForTimeout(1200);
        const perf = await medir(page);
        rodadas.push(perf);
        if (i === 0) {
          funcional = await page.evaluate(() => {
            const familia = (el: Element) => getComputedStyle(el).fontFamily;
            const raiz = document.querySelector('.studio') ?? document.body;
            const primeira = familia(raiz).split(',')[0]!.replace(/^["']|["']$/g, '').trim();
            const alvos = Array.from(raiz.querySelectorAll('h1, h2, h3, a, button, td, .ln-kpi__value'));
            const arial = alvos.filter((el) => !familia(el).includes(primeira)).length;
            const link = document.querySelector('link[rel="preload"][as="font"]');
            let faces = 0;
            let facesUrl = 0;
            for (const sheet of Array.from(document.styleSheets)) {
              try {
                for (const rule of Array.from(sheet.cssRules)) {
                  if (!(rule instanceof CSSFontFaceRule)) continue;
                  faces++;
                  if (/url\(/.test(rule.cssText)) facesUrl++;
                }
              } catch {
                /* outra origem */
              }
            }
            return { familia: familia(raiz), check: document.fonts.check(`16px "${primeira}"`), arial, preload: link?.getAttribute('href') ?? null, faces, facesUrl };
          });
          await page.screenshot({ path: join(SAIDA, 'screenshots', `${LADO}-studio-${rota.split('/').pop() || 'home'}-1280.png`), fullPage: true });
        }
        await context.close();
      }
      await browser.close();
      writeFileSync(join(SAIDA, `studio-${rota.split('/').pop() || 'home'}-1280.json`), JSON.stringify({ base: BASE, lado: LADO, rota, rodadas }, null, 2));
      expect(funcional!.facesUrl).toBe(1);
      expect(funcional!.faces).toBeLessThanOrEqual(2);
      expect(mediana(rodadas.map((r) => r.cls))).toBeLessThanOrEqual(0.05);
      if (rodadas[0]!.fontes.length) {
        expect(rodadas[0]!.fontes[0]!.decoded).toBeGreaterThanOrEqual(48256 - 1024);
        expect(rodadas[0]!.fontes[0]!.decoded).toBeLessThanOrEqual(48256 + 1024);
      }
    });
  }

  test('cache quente: 1 arquivo de 48.256 B e família resolvida no portal e no Studio', async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const familia = () =>
      page.evaluate(() => {
        const raiz = document.querySelector('.ln-root') ?? document.body;
        const ff = getComputedStyle(raiz).fontFamily;
        const primeira = ff.split(',')[0]!.replace(/["']/g, '').trim();
        return {
          familia: ff,
          check: document.fonts.check(`16px "${primeira}"`),
          fontes: performance
            .getEntriesByType('resource')
            .filter((e) => /\.woff2/.test(e.name))
            .map((e) => ({ url: e.name, bytes: (e as PerformanceResourceTiming).decodedBodySize })),
        };
      });

    await page.goto(url('/'), { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    await page.goto(url('/'), { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    const home = await familia();
    expect(home.check, 'portal: família carregada no cache quente').toBe(true);
    expect(home.fontes.length, 'portal: arquivos de fonte no cache quente').toBeLessThanOrEqual(1);
    if (home.fontes.length) expect(home.fontes[0]!.bytes).toBe(48256);

    const login = await context.request.get(url('/api/e2e/login?user=qa8&role=admin&mfa=1'));
    expect(login.ok(), 'login do fixture de e2e').toBe(true);
    await page.goto(url('/studio/creative'), { waitUntil: 'load' });
    await page.waitForTimeout(3000);
    await page.goto(url('/studio/creative'), { waitUntil: 'load' });
    await page.waitForTimeout(1000);
    const studio = await familia();
    expect(studio.check, 'Studio: família carregada no cache quente').toBe(true);
    expect(studio.familia, 'Studio: família resolvida').not.toMatch(/^\s*Arial/);
    writeFileSync(join(SAIDA, 'cache-quente.json'), JSON.stringify({ home, studio }, null, 2));
    await browser.close();
  });
});
