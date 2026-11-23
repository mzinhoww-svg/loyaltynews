import { expect, test } from '@playwright/test';

/**
 * Regra A6 (Security): API pública fora do ar ou sem banco = estado vazio honesto, nunca 500 e nunca MOCK.
 * PORTAL_MODE=api com PORTAL_API_DOWN=1 (conexão recusada) ou PORTAL_API_DOWN=503 (API sem banco, NOT_CONFIGURED).
 */
const down = process.env.PORTAL_API_DOWN;

test.describe(`API indisponível (PORTAL_API_DOWN=${down})`, () => {
  test.skip(process.env.PORTAL_MODE !== 'api' || !down, 'somente em PORTAL_MODE=api com PORTAL_API_DOWN');

  test('páginas de listagem respondem 200 com estado vazio honesto, sem erro 500 nem MOCK', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(e.message));
    for (const [rota, texto] of [
      ['/', /Em breve: primeiras matérias/],
      ['/noticias', /Em breve: primeiras matérias/],
      ['/flash', /Loyalty Flash em breve/],
      ['/editoria/bancos', /Em breve: primeiras matérias/],
      ['/em-alta', /Ranking em formação/],
    ] as const) {
      const res = await page.goto(rota);
      expect(res?.status(), rota).toBe(200);
      await expect(page.getByText(texto).first(), rota).toBeVisible();
      await expect(page.getByTestId('demo-banner'), rota).toHaveCount(0);
      expect(await page.locator('body').innerText(), rota).not.toMatch(/MOCK|Internal Server Error|Application error/i);
    }
    expect(erros).toEqual([]);
  });

  test('busca sem resultado e matéria 404, nunca 500', async ({ page }) => {
    const busca = await page.goto('/busca?q=bancos');
    expect(busca?.status()).toBe(200);
    await expect(page.getByText(/Nenhum resultado para/)).toBeVisible();
    const noticia = await page.goto('/noticia/api-ilustracao-corrigida');
    expect(noticia?.status()).toBe(404);
    await expect(page.getByText('Não encontramos o que você procurava')).toBeVisible();
  });

  test('feed.xml e sitemap.xml respondem 200: feed sem itens, sitemap sem matérias', async ({ request }) => {
    const feed = await request.get('/feed.xml');
    expect(feed.status()).toBe(200);
    const feedBody = await feed.text();
    expect(feedBody).toContain('<rss');
    expect(feedBody).not.toContain('<item>');
    const sm = await request.get('/sitemap.xml');
    expect(sm.status()).toBe(200);
    expect(await sm.text()).not.toContain('/noticia/');
  });

  test('demais páginas do portal continuam de pé (agenda, intelligence, mídia kit, institucionais)', async ({ request }) => {
    for (const rota of ['/agenda', '/intelligence', '/moves', '/midia-kit', '/sobre', '/robots.txt']) {
      expect((await request.get(rota)).status(), rota).toBe(200);
    }
  });
});
