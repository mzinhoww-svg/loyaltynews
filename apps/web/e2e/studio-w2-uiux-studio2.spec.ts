import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

// Revisão visual da UI/UX (revisao-visual-staging-int012.md), telas da frente Studio 2. Celular (390 px), onde as tabelas viram blocos com rolagem.
test.use({ viewport: { width: 390, height: 844 } });

// P2-1: tabela com rolagem precisa ser alcançável por teclado (axe scrollable-region-focusable, grave).
for (const rota of ['/studio/modelops', '/studio/organizacao', '/studio/reunioes', '/studio/finops', '/studio/social']) {
  test(`P2-1: ${rota} sem região com rolagem fora do teclado, no celular`, async ({ page, context }) => {
    await entrar(context, 'uiux-adm', 'admin');
    await page.goto(rota);
    const r = await new AxeBuilder({ page }).include('main').withRules(['scrollable-region-focusable']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    for (const t of await page.locator('main table.st-table').all()) {
      await expect(t).toHaveAttribute('tabindex', '0');
      await expect(t).toHaveAttribute('aria-label', /.+/);
    }
  });
}
