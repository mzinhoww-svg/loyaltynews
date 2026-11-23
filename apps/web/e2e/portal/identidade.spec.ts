import { expect, test } from '@playwright/test';

/** V-14: identidade na aba e no compartilhamento (monograma .ln como ícone; imagem OG 1200×627). */
test.describe('identidade visual: favicon e og:image', () => {
  test('/favicon.ico, ícone SVG e ícone de toque respondem 200 com imagem', async ({ request }) => {
    for (const [url, tipo] of [['/favicon.ico', /image\//], ['/icon.svg', /svg/], ['/apple-icon.png', /png/]] as const) {
      const r = await request.get(url);
      expect(r.status(), url).toBe(200);
      expect(r.headers()['content-type'], url).toMatch(tipo);
    }
  });

  test('a home declara ícones e og:image com dimensões, e a imagem abre', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute('href', /.+/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    const og = page.locator('meta[property="og:image"]').first();
    await expect(og).toHaveAttribute('content', /opengraph-image/);
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '627');
    const src = new URL((await og.getAttribute('content')) as string);
    const img = await request.get(src.pathname + src.search);
    expect(img.status()).toBe(200);
    expect(img.headers()['content-type']).toMatch(/png/);
  });
});
