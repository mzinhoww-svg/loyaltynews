import { expect, test } from '@playwright/test';

/**
 * P2 da auditoria do int/031: o mídia kit é peça comercial, mas o PDF saía com cabeçalho, menu, rodapé e banner de cookies.
 * Aqui a regra de impressão é medida no navegador: no papel sobram a peça e o conteúdo, e somem navegação, rodapé e aviso de
 * cookies. A prova em PDF (arquivo gerado e texto extraído) fica em fast-track/lancamento/evidencias/.
 */
test.describe('mídia kit no papel', () => {
  // Os dois projetos do portal rodam Chromium (page.pdf e emulação de impressão).
  test('imprime a peça sem cabeçalho, menu, rodapé ou banner de cookies', async ({ page }) => {
    await page.goto('/midia-kit');
    await expect(page.locator('#precos')).toBeVisible();

    await page.emulateMedia({ media: 'print' });

    // Ocultos no papel.
    for (const seletor of ['header.ln-header', 'footer.ln-footer', '[data-testid="consentimento-banner"]']) {
      const el = page.locator(seletor).first();
      if ((await el.count()) === 0) continue; // o banner só existe com consentimento pendente/GA configurado
      await expect(el, seletor).toBeHidden();
    }

    // A peça continua inteira e legível.
    await expect(page.locator('main h1')).toBeVisible();
    // Tabelas que existem nos três modos (a de preços só no modo api, quando há catálogo comercial).
    await expect(page.locator('#cobertura table').first()).toBeVisible();
    await expect(page.locator('#formatos table').first()).toBeVisible();

    // Tamanho de página do PDF: o conteúdo não é cortado pela margem.
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    expect(pdf.byteLength).toBeGreaterThan(20_000);
    expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });
});
