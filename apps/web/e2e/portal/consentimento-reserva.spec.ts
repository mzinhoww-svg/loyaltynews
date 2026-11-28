import { expect, test } from '@playwright/test';

/**
 * Com o aviso de cookies aberto, nada do rodapé pode ficar preso embaixo dele (QA 8, 27/11: "Institucional" a 390 px).
 * O aviso só existe na produção indexável com o ID do GA4 (build de e2e de produção, fonte vazia).
 */
const mode = process.env.PORTAL_MODE ?? 'empty';

test.describe('aviso de cookies aberto não cobre o rodapé', () => {
  test.skip(mode !== 'empty' || process.env.PORTAL_APP_ENV === 'staging', 'o aviso aparece na produção com a fonte vazia');

  for (const largura of [320, 390, 768]) {
    test(`a ${largura} px, no fim da rolagem, o rodapé inteiro fica acima do aviso; ao fechar não sobra espaço`, async ({ page }) => {
      await page.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.abort());
      await page.setViewportSize({ width: largura, height: 900 });
      await page.goto('/');
      const aviso = page.getByTestId('consentimento-banner');
      await expect(aviso).toBeVisible();
      const reserva = () => page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
      await expect.poll(reserva).toBeGreaterThanOrEqual(Math.floor((await aviso.boundingBox())!.height));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const topoDoAviso = (await aviso.boundingBox())!.y;
      const rodape = (await page.locator('footer').boundingBox())!;
      expect(rodape.y + rodape.height, 'fim do rodapé acima do aviso').toBeLessThanOrEqual(topoDoAviso + 1);
      // Cada grupo recolhível recebe o clique com o aviso aberto.
      for (const titulo of ['Editorias', 'Conteúdo', 'Institucional', 'Contato']) {
        await page.locator('footer summary', { hasText: titulo }).click({ timeout: 5000 });
      }
      await expect(aviso).toBeVisible();
      await aviso.getByRole('button', { name: 'Recusar' }).click();
      await expect(aviso).toHaveCount(0);
      await expect.poll(reserva).toBe(0);
    });
  }
});
