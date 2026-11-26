import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * L-09 (auditoria pré-lançamento): CLS de ~0,2 em /intelligence/empresas a 768 e 1280 px, "sempre pelo rodapé que desce depois".
 * Meta: CLS < 0,1. Mede o Cumulative Layout Shift real (PerformanceObserver 'layout-shift', sem os deslocamentos causados por
 * interação) do carregamento da página até 2 s depois do load, em navegação nova (sem cache de página).
 */
async function cls(page: Page, rota: string): Promise<number> {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((lista) => {
      for (const e of lista.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(rota, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

/**
 * Causa medida no staging (24/11, int/029, 3 medições por largura): CLS 0,13–0,14, quase todo do rodapé (footer.ln-footer), que descia
 * quando a lista real substituía o esqueleto do loading.tsx. Localmente a API do e2e responde na hora e o esqueleto mal aparece, então
 * a medição local sozinha não reprova a regressão: por isso há também o guarda abaixo, que reprova a volta do esqueleto nesta rota.
 */
test('guarda: /intelligence/empresas sem loading.tsx (o esqueleto trocado pela lista empurrava o rodapé)', () => {
  const loading = path.resolve(import.meta.dirname, '..', '..', 'app', '(portal)', 'intelligence', 'empresas', '(lista)', 'loading.tsx');
  expect(existsSync(loading), loading).toBe(false);
});

test.describe('CLS das páginas de dados (L-09)', () => {
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(info.project.name !== 'desktop', 'mede em larguras próprias');
  });

  for (const largura of [768, 1280]) {
    test(`/intelligence/empresas a ${largura} px: CLS < 0,1`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 900 });
      const v = await cls(page, '/intelligence/empresas');
      expect(v, `CLS medido: ${v.toFixed(3)}`).toBeLessThan(0.1);
    });
  }
});
