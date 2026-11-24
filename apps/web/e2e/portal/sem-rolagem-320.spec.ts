import { expect, test } from '@playwright/test';

/**
 * Sem rolagem horizontal a 320 px (menor tela móvel suportada) nas páginas principais.
 * Regressão: o botão Menu do cabeçalho estourava 22 px (scrollWidth 342 > 320) porque o logo não encolhia.
 */
const ROTAS = ['/', '/noticias', '/editoria/mercado', '/busca', '/agenda', '/em-alta', '/midia-kit', '/intelligence', '/moves', '/sobre', '/contato'];

test.describe('sem rolagem horizontal a 320 px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const rota of ROTAS) {
    test(`${rota}`, async ({ page }) => {
      await page.goto(rota);
      await page.evaluate(() => document.fonts.ready);
      const { scroll, largura, culpados } = await page.evaluate(() => {
        const w = document.documentElement.clientWidth;
        const fora = [...document.querySelectorAll('body *')]
          .filter((e) => !e.closest('.pt-scroll') && !e.closest('[role="region"][tabindex]') && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > w + 0.5)
          .slice(0, 3)
          .map((e) => `${e.tagName}.${String(e.className).slice(0, 30)}`);
        return { scroll: document.documentElement.scrollWidth, largura: w, culpados: fora };
      });
      expect(scroll, `scrollWidth ${scroll} > ${largura}; elementos além da borda: ${culpados.join(', ')}`).toBeLessThanOrEqual(largura);
    });
  }
});
