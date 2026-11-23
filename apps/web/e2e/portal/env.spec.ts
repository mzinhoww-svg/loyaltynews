import { expect, test } from '@playwright/test';

/**
 * Política de indexação por ambiente (APP_ENV). Rode com PORTAL_APP_ENV=staging e com production (padrão).
 * Em modo MOCK a indexação fica bloqueada em qualquer ambiente.
 */
const appEnv = process.env.PORTAL_APP_ENV ?? 'production';
const mode = process.env.PORTAL_MODE ?? 'empty';
// DP-24: produção só é indexável com PORTAL_INDEXAVEL=1; PORTAL_INDEXAVEL_E2E=0 testa a produção SEM o interruptor.
const semInterruptor = process.env.PORTAL_INDEXAVEL_E2E === '0';
const blocked = appEnv !== 'production' || mode === 'mock' || semInterruptor;

const URLS = ['/', '/noticias', '/editoria/bancos', '/sobre', '/busca', '/robots.txt', '/sitemap.xml', '/feed.xml', '/api/health'];

test.describe(`indexação com APP_ENV=${appEnv}${semInterruptor ? ' sem PORTAL_INDEXAVEL' : ''} (${mode})`, () => {
  test('robots.txt', async ({ request }) => {
    const r = await request.get('/robots.txt');
    expect(r.status()).toBe(200);
    const body = await r.text();
    if (blocked) {
      expect(body).toBe('User-agent: *\nDisallow: /\n');
      expect(body).not.toContain('Sitemap');
    } else {
      expect(body).toContain('Allow: /');
      expect(body).toContain('Sitemap: https://portal.example.test/sitemap.xml');
    }
  });

  test('sitemap', async ({ request }) => {
    const body = await (await request.get('/sitemap.xml')).text();
    if (blocked) expect(body).not.toContain('<loc>');
    else {
      expect(body).toContain('<loc>https://portal.example.test/</loc>');
      expect(body).toContain('https://portal.example.test/editoria/bancos');
    }
  });

  test('X-Robots-Tag em todas as respostas', async ({ request }) => {
    test.setTimeout(90_000);
    for (const u of URLS) {
      const r = await request.get(u);
      const h = r.headers()['x-robots-tag'];
      if (blocked) expect(h, `${u}`).toBe('noindex, nofollow');
      else expect(h, `${u}`).toBeUndefined();
    }
    // 404 e redirecionamento também levam o cabeçalho quando bloqueado.
    const nf = await request.get('/pagina-que-nao-existe');
    expect(nf.status()).toBe(404);
    if (blocked) expect(nf.headers()['x-robots-tag']).toBe('noindex, nofollow');
  });

  test('meta robots e canonical na home', async ({ page }) => {
    await page.goto('/');
    const robots = page.locator('meta[name="robots"]');
    if (blocked) {
      await expect(robots).toHaveAttribute('content', /noindex/);
      await expect(robots).toHaveAttribute('content', /nofollow/);
    } else {
      await expect(robots).toHaveCount(0);
    }
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://portal.example.test');
  });
});
