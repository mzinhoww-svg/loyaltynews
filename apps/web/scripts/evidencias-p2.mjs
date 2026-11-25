#!/usr/bin/env node
/**
 * Evidências dos P2 da auditoria do int/031 (Frontend 2), contra um servidor já no ar.
 *
 * Uso:
 *   node apps/web/scripts/evidencias-p2.mjs http://localhost:3425 <pasta-de-saida>
 *
 * Gera, por largura (320, 375, 390, 768, 1280):
 *   - captura do perfil de empresa e do perfil de pessoa;
 *   - medida da legenda da tabela: está FORA da região de rolagem e cabe na largura (sem corte à direita).
 * E gera o PDF do mídia kit (impressão) mais uma captura da prévia de impressão.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const base = (process.argv[2] ?? 'http://localhost:3425').replace(/\/$/, '');
const out = process.argv[3] ?? 'evidencias';
mkdirSync(out, { recursive: true });

const EMPRESA = '/intelligence/empresas/10000000-0000-4000-8000-000000000001';
const PESSOA = '/intelligence/pessoas/10000000-0000-4000-8000-000000000201';
const LARGURAS = [320, 375, 390, 768, 1280];

const browser = await chromium.launch();
const resultado = { legendas: [], pdf: null };

for (const w of LARGURAS) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  for (const [nome, rota, seletor] of [
    ['empresa', EMPRESA, '[data-testid="relations"]'],
    ['pessoa', PESSOA, 'table.pt-table'],
  ]) {
    await page.goto(base + rota, { waitUntil: 'networkidle' });
    const medida = await page.evaluate((sel) => {
      const table = document.querySelector(sel);
      if (!table) return null;
      const caption = document.getElementById(table.getAttribute('aria-describedby') ?? '');
      const regiao = table.closest('.pt-scroll');
      if (!caption) return { semLegenda: true };
      const foraDaRegiao = !regiao || !regiao.contains(caption);
      const r = caption.getBoundingClientRect();
      return {
        foraDaRegiao,
        cabeNaViewport: r.right <= window.innerWidth + 0.5,
        larguraLegenda: Math.round(r.width),
        direita: Math.round(r.right),
        viewport: window.innerWidth,
      };
    }, seletor);
    resultado.legendas.push({ largura: w, pagina: nome, ...medida });
    await page.screenshot({ path: join(out, `${nome}-${w}.png`), fullPage: true });
  }
  await page.close();
}

// Mídia kit: prévia de impressão e PDF de verdade.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${base}/midia-kit`, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
await page.screenshot({ path: join(out, 'midia-kit-impressao-1280.png'), fullPage: true });
const cabecalhoVisivel = await page.locator('header.ln-header').first().isVisible().catch(() => false);
const rodapeVisivel = await page.locator('footer.ln-footer').first().isVisible().catch(() => false);
const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
const pdfPath = join(out, 'midia-kit.pdf');
writeFileSync(pdfPath, pdf);
resultado.pdf = { caminho: pdfPath, bytes: pdf.byteLength, cabecalhoVisivel, rodapeVisivel };

await browser.close();
console.log(JSON.stringify(resultado, null, 2));
