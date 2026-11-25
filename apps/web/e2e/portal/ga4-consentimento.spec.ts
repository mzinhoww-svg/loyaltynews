import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * GA4 com consentimento (LGPD): na produção indexável (modo empty do e2e = APP_ENV=production + PORTAL_INDEXAVEL=1) com um ID de
 * medição FALSO (G-E2ETESTE00, só no build de e2e). Toda requisição ao Google é interceptada e respondida localmente: nada sai.
 *  - sem aceite: banner visível e NENHUMA requisição ao Google;
 *  - recusar: banner some e nenhuma requisição;
 *  - aceitar: o gtag carrega do googletagmanager.com com o ID, e as coletas vão sem query string da página;
 *  - GPC ligado: mesmo aceitando, nada carrega;
 *  - fora da produção (modo mock = vitrine do staging): sem banner e sem tag.
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const GOOGLE = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/;

function vigiarGoogle(page: Page) {
  const pedidos: Request[] = [];
  page.on('request', (r) => {
    if (GOOGLE.test(r.url())) pedidos.push(r);
  });
  return pedidos;
}
async function interceptar(page: Page) {
  // Responde no lugar do Google: um gtag mínimo que só registra as chamadas (nenhum tráfego real).
  await page.route(GOOGLE, (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.__gtagCarregado = true;' }));
}

test.describe('GA4 com consentimento', () => {
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(info.project.name !== 'desktop', 'comportamento não depende da largura');
  });

  test.describe('produção indexável', () => {
    test.skip(mode !== 'empty', 'a produção indexável do e2e é o modo empty');

    test('sem aceite: banner e nenhuma requisição ao Google', async ({ page }) => {
      const pedidos = vigiarGoogle(page);
      await interceptar(page);
      await page.goto('/');
      await expect(page.getByTestId('consentimento-banner')).toBeVisible();
      await page.goto('/noticias');
      await page.waitForLoadState('networkidle');
      expect(pedidos.map((r) => r.url())).toEqual([]);
      await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0);
    });

    test('recusar: banner some, escolha guardada e nenhuma requisição', async ({ page }) => {
      const pedidos = vigiarGoogle(page);
      await interceptar(page);
      await page.goto('/');
      await page.getByRole('button', { name: 'Recusar' }).click();
      await expect(page.getByTestId('consentimento-banner')).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId('consentimento-banner')).toHaveCount(0);
      expect(pedidos).toEqual([]);
    });

    test('aceitar: o gtag carrega com o ID; a página vai sem query string', async ({ page }) => {
      const pedidos = vigiarGoogle(page);
      await interceptar(page);
      await page.goto('/busca?q=fulano@exemplo.com');
      await page.getByRole('button', { name: 'Aceitar cookies analíticos' }).click();
      await expect(page.getByTestId('consentimento-banner')).toHaveCount(0);
      await expect.poll(() => pedidos.map((r) => r.url()).find((u) => u.includes('googletagmanager.com/gtag/js'))).toContain('id=G-E2ETESTE00');
      const config = await page.evaluate(() => (window as unknown as { dataLayer: IArguments[] }).dataLayer.map((a) => Array.from(a)).find((a) => a[0] === 'config'));
      expect(config?.[1]).toBe('G-E2ETESTE00');
      expect(config?.[2]).toMatchObject({ anonymize_ip: true, allow_google_signals: false, page_path: '/busca' });
      expect(JSON.stringify(config)).not.toContain('fulano');
      // Preferências no rodapé reabrem o aviso (revogar).
      await page.getByTestId('preferencias-cookies').click();
      await expect(page.getByTestId('consentimento-banner')).toBeVisible();
    });

    test('GPC ligado: mesmo aceitando, nada é enviado ao Google', async ({ page }) => {
      await page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { get: () => true }));
      const pedidos = vigiarGoogle(page);
      await interceptar(page);
      await page.goto('/');
      await page.getByRole('button', { name: 'Aceitar cookies analíticos' }).click();
      await page.waitForLoadState('networkidle');
      expect(pedidos).toEqual([]);
    });

    test('política de cookies publicada com âncora #cookies', async ({ page }) => {
      await page.goto('/privacidade#cookies');
      const s = page.locator('#cookies');
      await expect(s).toContainText('Google Analytics 4');
      await expect(s).toContainText('Preferências de cookies');
    });
  });

  test('fora da produção (vitrine do staging, modo mock): sem banner e sem tag', async ({ page }) => {
    test.skip(mode !== 'mock', 'somente no modo mock');
    const pedidos = vigiarGoogle(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('consentimento-banner')).toHaveCount(0);
    await expect(page.getByTestId('preferencias-cookies')).toHaveCount(0);
    expect(pedidos).toEqual([]);
  });
});
