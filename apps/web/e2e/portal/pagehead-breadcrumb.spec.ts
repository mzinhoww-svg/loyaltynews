import { expect, test } from '@playwright/test';

/**
 * P3-1 da revisão visual do staging 56e4cdc: perfil de pessoa e de empresa a 390 px mostravam o nome 3 vezes.
 * No celular o último item do breadcrumb do cabeçalho de página fica fora da vista (continua no DOM, para leitor de tela).
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const PERFIS = [
  ['pessoa', '/intelligence/pessoas/00000000-0000-4000-8000-0000000000f1', 'Pessoa de Teste Um (MOCK)'],
  ['empresa', '/intelligence/empresas/00000000-0000-4000-8000-00000000000a', 'Empresa de Teste (MOCK)'],
] as const;

test.describe('breadcrumb do cabeçalho de página', () => {
  test.skip(mode !== 'mock', 'precisa de pessoa e empresa (fixtures MOCK)');

  for (const [nome, rota, titulo] of PERFIS) {
    test(`${nome} a 390 px: o nome aparece uma vez à vista (h1); o último item do breadcrumb fica só para leitor de tela`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(rota);
      const ultimo = page.locator('.pt-pagehead .ln-breadcrumb__item:last-child');
      await expect(ultimo).toHaveText(titulo); // continua no DOM (leitor de tela)
      const box = (await ultimo.boundingBox())!;
      expect(Math.max(box.width, box.height), 'fora da vista (1 px)').toBeLessThanOrEqual(1);
      // sem barra pendurada: o item antes do escondido não tem separador, e os anteriores a ele continuam com "/"
      const seps = await page.locator('.pt-pagehead .ln-breadcrumb__item').evaluateAll((els) => els.map((e) => getComputedStyle(e, '::after').content));
      expect(seps[seps.length - 2], 'item antes do último: ::after').toBe('none');
      for (const c of seps.slice(0, -2)) expect(c, 'itens anteriores mantêm o separador').toBe('"/"');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(titulo);
      // a navegação do breadcrumb continua com os itens anteriores à vista
      await expect(page.locator('.pt-pagehead .ln-breadcrumb__item').first()).toBeVisible();
      expect((await page.locator('.pt-pagehead .ln-breadcrumb__item').first().boundingBox())!.width).toBeGreaterThan(8);
    });

    test(`${nome} a 1280 px: o último item do breadcrumb continua visível`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop');
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(rota);
      const box = (await page.locator('.pt-pagehead .ln-breadcrumb__item:last-child').boundingBox())!;
      expect(box.width, 'visível no desktop').toBeGreaterThan(20);
      // no desktop o separador antes do último item continua
      const seps = await page.locator('.pt-pagehead .ln-breadcrumb__item').evaluateAll((els) => els.map((e) => getComputedStyle(e, '::after').content));
      expect(seps[seps.length - 2], 'desktop: item antes do último mantém o "/"').toBe('"/"');
    });
  }
});
