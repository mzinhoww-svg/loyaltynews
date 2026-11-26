import { expect, test, type Page } from '@playwright/test';

/**
 * CLS do rodapé: os grupos de links recolhem por JS depois do paint e, em página curta (conteúdo <= viewport), o fechamento
 * desloca o rodapé dentro da tela — medido em 25/11 no 42e80ab: 0,196 a 390 e 0,143 a 768 (janela de 5 s). A correção faz o
 * grupo nascer recolhido no HTML (CSS-first). Este teste reprova a volta do fechamento pós-paint: no código anterior dava
 * 0,196/0,143/0 e falhava nas duas primeiras larguras.
 */
async function clsJanela5s(page: Page, rota: string): Promise<number> {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(rota, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(5000);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

test.describe('CLS do rodapé em página curta (janela de 5 s)', () => {
  test.beforeEach(({ page }, info) => {
    void page;
    test.skip(info.project.name !== 'desktop', 'mede em larguras próprias');
  });

  for (const largura of [390, 768, 1280]) {
    test(`/flash a ${largura} px: CLS <= 0,10`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      const v = await clsJanela5s(page, '/flash');
      expect(v, `CLS medido a ${largura}px: ${v.toFixed(3)}`).toBeLessThanOrEqual(0.1);
    });
  }

  // A página longa continua em 0; o teste garante que a correção não introduziu shift em home/perfil.
  for (const [nome, rota] of [['home', '/'], ['pessoa-vazia', '/intelligence/pessoas']] as const) {
    test(`${nome} a 390 px: CLS <= 0,10`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 900 });
      const v = await clsJanela5s(page, rota);
      expect(v, `CLS medido em ${nome}: ${v.toFixed(3)}`).toBeLessThanOrEqual(0.1);
    });
  }
});
