import { expect, test } from '@playwright/test';

/**
 * Parecer do Senior Auditor (D-5): a 768 px "Anuncie" (40 px), o breadcrumb (32 px) e "Ver todas →" (21 px) ficavam abaixo de 44 px,
 * porque as regras de toque só valiam até 767 px. Agora valem até 1023 px (tablet).
 */
test.skip(process.env.PORTAL_MODE !== 'mock', 'usa os dados MOCK');
test.use({ viewport: { width: 768, height: 1024 } });

const altura = (page: import('@playwright/test').Page, seletor: string) =>
  page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).map((e) => Math.round(e.getBoundingClientRect().height)), seletor);

test('home a 768 px: botões do cabeçalho e "Ver todas" com pelo menos 44 px', async ({ page }) => {
  await page.goto('/');
  for (const s of ['.ln-header__cta', '.pt-more']) {
    const hs = await altura(page, s);
    expect(hs.length, `sem elementos para ${s}`).toBeGreaterThan(0);
    for (const h of hs) expect(h, `${s} com ${h}px`).toBeGreaterThanOrEqual(44);
  }
});

test('matéria a 768 px: links do breadcrumb com pelo menos 44 px e respiro de 16 px sob o cabeçalho', async ({ page }) => {
  await page.goto('/noticia/mock-mercado-1');
  for (const h of await altura(page, '.ln-breadcrumb__item a')) expect(h).toBeGreaterThanOrEqual(44);
  const gap = await page.evaluate(() => document.querySelector('.ln-breadcrumb')!.getBoundingClientRect().top - document.querySelector('header')!.getBoundingClientRect().bottom);
  expect(gap).toBeGreaterThanOrEqual(16);
});
