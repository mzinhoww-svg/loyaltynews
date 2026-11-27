import { expect, test } from '@playwright/test';

/**
 * N5 (auditoria de estado honesto, 26/11): falha em parte das leituras da home não pode sumir em silêncio.
 * Roda com a home PADRÃO (sem home publicada no Studio) e uma falha por vez no servidor MOCK:
 *   FAKE_API_SITE=vazio FAKE_API_FALHA=flash|editoria|destaques|ultimas  e PORTAL_API_FALHA igual
 *   PORTAL_API_FALHA=nenhuma é o controle negativo (nada falha, nenhum aviso).
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const falha = process.env.PORTAL_API_FALHA ?? '';
const AVISO = 'Parte da página não carregou';

test.describe(`home com falha parcial (${falha || 'sem cenário'})`, () => {
  test.skip(mode !== 'api' || !falha, 'cenário próprio: PORTAL_API_FALHA');

  for (const largura of [390, 1280]) {
    test(`@${largura}: ${falha === 'nenhuma' ? 'sem aviso quando tudo responde' : 'avisa e mantém o que carregou'}`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      const res = await page.goto('/');
      expect(res?.status()).toBe(200);
      // O que respondeu continua na tela, e a falha nunca vira "em breve".
      await expect(page.locator('main a[href^="/noticia/"]').first()).toBeVisible();
      await expect(page.getByText('Em breve: primeiras matérias')).toHaveCount(0);
      if (falha === 'nenhuma') {
        await expect(page.getByText(AVISO)).toHaveCount(0);
        await expect(page.getByTestId('error-state')).toHaveCount(0);
        return;
      }
      await expect(page.getByText(AVISO)).toBeVisible();
      await expect(page.getByTestId('error-state')).toHaveCount(1);
      await expect(page.getByTestId('error-state').getByRole('link', { name: 'Tentar de novo' })).toHaveAttribute('href', '/');
    });
  }
});
