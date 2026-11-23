import { expect, test } from '@playwright/test';

/**
 * Regra A6 (Security): API pública fora do ar ou sem banco = página 200 com estado de ERRO honesto (nunca confundido com "vazio"), nunca 500 e nunca MOCK.
 * PORTAL_MODE=api com PORTAL_API_DOWN=1 (conexão recusada) ou PORTAL_API_DOWN=503 (API sem banco, NOT_CONFIGURED).
 */
const down = process.env.PORTAL_API_DOWN;

test.describe(`API indisponível (PORTAL_API_DOWN=${down})`, () => {
  test.skip(process.env.PORTAL_MODE !== 'api' || !down, 'somente em PORTAL_MODE=api com PORTAL_API_DOWN');

  test('páginas de listagem respondem 200 com estado de erro honesto (não "vazio"), sem erro 500 nem MOCK', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(e.message));
    for (const [rota, texto] of [
      ['/', /Não conseguimos carregar as matérias agora/],
      ['/noticias', /Não conseguimos carregar as matérias agora/],
      ['/flash', /Não conseguimos carregar as matérias agora/],
      ['/editoria/bancos', /Não conseguimos carregar as matérias agora/],
      ['/agenda', /Não conseguimos carregar a agenda agora/],
      ['/em-alta', /Ranking em formação/],
    ] as const) {
      const res = await page.goto(rota);
      expect(res?.status(), rota).toBe(200);
      await expect(page.getByText(texto).first(), rota).toBeVisible();
      await expect(page.getByTestId('demo-banner'), rota).toHaveCount(0);
      if (rota !== '/em-alta') await expect(page.getByTestId('error-state').first(), rota).toBeVisible();
      expect(await page.locator('body').innerText(), rota).not.toMatch(/MOCK|Internal Server Error|Application error|NOT_CONFIGURED|Banco não configurado/i);
    }
    expect(erros).toEqual([]);
  });

  test('busca, matéria e evento: erro honesto com 200 (matéria com noindex), nunca 500 nem "não encontrado"', async ({ page }) => {
    const busca = await page.goto('/busca?q=bancos');
    expect(busca?.status()).toBe(200);
    await expect(page.getByTestId('error-state')).toContainText('Não conseguimos buscar agora');
    await expect(page.getByText(/Nenhum resultado para/)).toHaveCount(0);
    const noticia = await page.goto('/noticia/api-ilustracao-corrigida');
    expect(noticia?.status()).toBe(200);
    await expect(page.getByTestId('error-state')).toContainText('Não conseguimos carregar esta matéria agora');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const evento = await page.goto('/agenda/ev-1');
    expect(evento?.status()).toBe(200);
    await expect(page.getByTestId('error-state')).toContainText('Não conseguimos carregar este evento agora');
    await expect(page.getByText('Não encontramos o que você procurava')).toHaveCount(0);
  });

  test('.ics com a API fora: 503 curto com Retry-After, sem detalhe', async ({ request }) => {
    const r = await request.get('/agenda/ev-1/ics');
    expect(r.status()).toBe(503);
    expect(r.headers()['retry-after']).toBe('60');
    expect(await r.text()).not.toMatch(/NOT_CONFIGURED|Banco/);
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

  test('Intelligence: diretório e perfil dizem "indisponível" (role=alert), sem fingir vazio, sem 500 nem MOCK', async ({ page }) => {
    for (const rota of [
      '/intelligence/empresas', '/intelligence/empresas/10000000-0000-4000-8000-000000000001', '/intelligence/pessoas',
      '/intelligence/pessoas/10000000-0000-4000-8000-000000000201', '/moves', '/moves/10000000-0000-4000-8000-000000000401',
    ]) {
      const res = await page.goto(rota);
      expect(res?.status(), rota).toBe(200);
      await expect(page.getByRole('alert').filter({ hasText: /temporariamente indispon/ }), rota).toBeVisible();
      await expect(page.getByText('Em breve: primeiros perfis verificados'), rota).toHaveCount(0);
      expect(await page.locator('main').innerText(), rota).not.toMatch(/MOCK|Internal Server Error|Application error/i);
    }
  });

  test('demais páginas do portal continuam de pé (agenda, intelligence, mídia kit, institucionais)', async ({ request }) => {
    for (const rota of ['/intelligence', '/moves', '/midia-kit', '/sobre', '/robots.txt']) {
      expect((await request.get(rota)).status(), rota).toBe(200);
    }
  });
});
