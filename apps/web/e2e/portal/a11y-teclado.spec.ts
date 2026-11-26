import { expect, test } from '@playwright/test';

/**
 * Acessibilidade de teclado, foco e alvos de toque do portal (item 4 do PM).
 * Complementa o axe (a11y.spec.ts): aqui o que o axe não mede — ordem de foco, Escape, 44 px e movimento reduzido.
 */
test.describe('acessibilidade de teclado e alvos', () => {
  test.beforeEach(({ browserName }, info) => {
    void browserName;
    test.skip(info.project.name !== 'desktop', 'comportamento de teclado não depende do aparelho');
  });

  test('o primeiro Tab chega ao "Pular para o conteúdo" e Enter leva ao main', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const ativo = page.locator(':focus');
    await expect(ativo).toHaveClass(/ln-skip-link/);
    const larguraOutline = await ativo.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth) || 0);
    expect(larguraOutline).toBeGreaterThanOrEqual(2);
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).hash).toBe('#conteudo');
  });

  test('menu do cabeçalho: Enter abre, Escape fecha e devolve o foco ao botão', async ({ page }) => {
    await page.goto('/');
    const botao = page.locator('.ln-header__menu-btn').first();
    await botao.focus();
    await page.keyboard.press('Enter');
    await expect(botao).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(botao).toHaveAttribute('aria-expanded', 'false');
    await expect(botao).toBeFocused();
  });

  test('controles de desktop com 44 px: CTA do cabeçalho e filtros de editoria', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    const cta = await page.locator('.ln-header__cta').first().boundingBox();
    expect(cta?.height ?? 0, 'CTA do cabeçalho').toBeGreaterThanOrEqual(44);

    await page.goto('/noticias');
    const chips = page.locator('.pt-chip');
    expect(await chips.count(), 'filtros de editoria').toBeGreaterThan(0);
    for (const box of await chips.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box, 'altura do filtro').toBeGreaterThanOrEqual(44);
    }
  });

  test('com prefers-reduced-motion, nada anima ou transiciona acima de 20 ms', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const restante = await page.evaluate(() => {
      const fora: string[] = [];
      for (const el of document.querySelectorAll('.ln-root *')) {
        const cs = getComputedStyle(el);
        const anim = parseFloat(cs.animationDuration) || 0;
        const trans = cs.transitionDuration.split(',').map((t) => parseFloat(t) || 0);
        if (anim > 0.02 || trans.some((t) => t > 0.02)) fora.push(`${el.tagName}.${String(el.className).slice(0, 40)}`);
        if (fora.length > 10) break;
      }
      return fora;
    });
    expect(restante).toEqual([]);
  });
});
