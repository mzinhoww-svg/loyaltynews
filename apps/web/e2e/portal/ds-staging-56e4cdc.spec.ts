import { expect, test } from '@playwright/test';

/**
 * Revisão visual do staging 56e4cdc: botão ghost com contorno visível em fundo claro (P2-1).
 * Dados MOCK: a página do evento tem o botão "Adicionar ao calendário (.ics)" (ln-btn--ghost).
 */
test.skip(process.env.PORTAL_MODE !== 'mock', 'usa os dados MOCK');

test('P2-1: o botão ghost em fundo claro tem contorno visível (não parece texto solto)', async ({ page }) => {
  await page.goto('/agenda/mock-evento-1');
  const botao = page.locator('a.ln-btn--ghost').first();
  await expect(botao).toBeVisible();
  const estilo = await botao.evaluate((e) => { const c = getComputedStyle(e); return { largura: parseFloat(c.borderTopWidth), cor: c.borderTopColor, fundo: c.backgroundColor }; });
  expect(estilo.largura).toBeGreaterThanOrEqual(1);
  expect(estilo.cor, 'a borda não pode ser transparente').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
});
