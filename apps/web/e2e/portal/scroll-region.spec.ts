import { expect, test } from '@playwright/test';

/**
 * Toda região de rolagem do portal (.pt-scroll) é o bloco de contenção dos filhos absolutos (texto só para leitor de tela, .pt-sr):
 * a página não pode passar da largura da tela a 390 px, e as tabelas de Intelligence ficam em região focável com nome.
 * (P1-1 da revisão visual do staging 56e4cdc; dono do perfil de pessoa: Frontend 2, 4aa8e52.)
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const PAGINAS = [
  '/midia-kit',
  '/intelligence/pessoas/00000000-0000-4000-8000-0000000000f1',
  '/intelligence/empresas/00000000-0000-4000-8000-00000000000a',
] as const;

test.describe('regiões de rolagem a 390 px', () => {
  test.skip(mode !== 'mock', 'precisa de mídia kit, pessoa e empresa com tabelas (fixtures MOCK)');

  for (const rota of PAGINAS) {
    test(`${rota}: toda .pt-scroll é position: relative e a página não passa de 390 px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      expect((await page.goto(rota))?.status()).toBe(200);
      await page.waitForLoadState('load');
      await expect(page.locator('.pt-scroll').first()).toBeVisible();
      const r = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        estaticas: [...document.querySelectorAll('.pt-scroll')].filter((e) => getComputedStyle(e).position !== 'relative').length,
        total: document.querySelectorAll('.pt-scroll').length,
        alem: [...document.querySelectorAll('body *')]
          .filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && !e.closest('.pt-scroll'))
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`),
      }));
      expect(r.total).toBeGreaterThan(0);
      expect(r.estaticas, 'região de rolagem sem position: relative').toBe(0);
      expect(r.sw, `scrollWidth ${r.sw} > ${r.cw}`).toBeLessThanOrEqual(r.cw);
      expect(r.alem, 'elementos além da borda fora de uma região de rolagem').toEqual([]);
    });
  }

  test('tabelas de Intelligence (cargos e vínculos) ficam em região focável, com papel e nome', async ({ page }) => {
    for (const [rota, tabela] of [
      ['/intelligence/pessoas/00000000-0000-4000-8000-0000000000f1', 'current-roles'],
      ['/intelligence/empresas/00000000-0000-4000-8000-00000000000a', 'relations'],
    ] as const) {
      await page.goto(rota);
      const regiao = page.getByTestId(tabela).locator('xpath=ancestor::div[contains(@class,"pt-scroll")][1]');
      await expect(regiao, rota).toHaveAttribute('role', 'region');
      await expect(regiao, rota).toHaveAttribute('tabindex', '0');
      await expect(regiao, rota).toHaveAttribute('aria-label', /rolagem lateral/);
    }
  });
});
