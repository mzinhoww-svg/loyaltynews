import { expect, test } from '@playwright/test';

/**
 * Assinatura "Redação Loyalty News" em demonstração (auditoria de estado honesto, 26/11, P2). Telas que a exibem: o cartão grande da home
 * (os cartões menores não mostram autor) e a linha de autoria da matéria. Demonstração = fixture MOCK ou título com o rótulo do seed;
 * conteúdo real não muda (controle negativo).
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const AUTOR = 'Redação Loyalty News';
const DEMO = `Demonstração: ${AUTOR}`;

test.describe('assinatura em demonstração (fixtures MOCK)', () => {
  test.skip(mode !== 'mock', 'conteúdo de demonstração do modo mock');

  for (const largura of [390, 1280]) {
    test(`home @${largura}: todo autor visível em cartão sai marcado e a marca não é cortada`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      await page.goto('/');
      const autores = page.locator('.ln-card__author:visible');
      expect(await autores.count()).toBeGreaterThan(0);
      for (const texto of await autores.allInnerTexts()) expect(texto).toBe(DEMO);
      // A marca fica dentro da parte visível do elemento (o corte com reticências é no fim).
      const cabe = await autores.first().evaluate((e) => {
        const trecho = document.createRange();
        trecho.setStart(e.firstChild!, 0);
        trecho.setEnd(e.firstChild!, 'Demonstração:'.length);
        return trecho.getBoundingClientRect().right <= e.getBoundingClientRect().right + 0.5;
      });
      expect(cabe).toBe(true);
    });
  }

  test('matéria aberta pela home: a linha de autoria sai marcada', async ({ page }) => {
    await page.goto('/');
    await page.locator('.pt-hero-main a').first().click();
    await page.waitForURL(/\/noticia\//);
    await expect(page.getByTestId('article-byline-author')).toHaveText(DEMO);
  });
});

test.describe('assinatura pela API (rótulo do seed contra conteúdo real)', () => {
  test.skip(
    mode !== 'api' || Boolean(process.env.PORTAL_API_INTEL || process.env.PORTAL_API_DOWN || process.env.PORTAL_API_SITE || process.env.PORTAL_API_ADS),
    'modo api completo',
  );

  test('matéria rotulada pelo seed sai marcada', async ({ page }) => {
    await page.goto('/noticia/api-demo-seed');
    await expect(page.getByTestId('article-byline-author')).toHaveText(DEMO);
  });

  test('controle negativo: matéria e home sem rótulo mantêm a assinatura exata', async ({ page }) => {
    await page.goto('/noticia/api-ilustracao-corrigida');
    await expect(page.getByTestId('article-byline-author')).toHaveText(AUTOR);
    await page.goto('/');
    const autores = page.locator('.ln-card__author:visible');
    expect(await autores.count()).toBeGreaterThan(0);
    for (const texto of await autores.allInnerTexts()) expect(texto).toBe(AUTOR);
    await expect(page.getByText('Demonstração:')).toHaveCount(0);
  });
});
