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

// P2-2: nada de rótulo técnico de flag para o usuário nas telas da frente Studio 2.
for (const rota of ['/studio/modelops', '/studio/organizacao', '/studio/reunioes', '/studio/finops', '/studio/social', '/studio/watchlists', '/studio/organogramas', '/studio/decisoes']) {
  test(`P2-2: ${rota} sem nome de flag no texto`, async ({ page, context }) => {
    await entrar(context, 'uiux-adm', 'admin');
    await page.goto(rota);
    await expect(page.locator('main')).not.toContainText(/\bflag\b|modelosHabilitados|linkedinPublicacao|production_enabled=/i);
  });
}
// P2-4 (parte de rota): os links dos agentes em /studio/organizacao tinham 15 px de altura; agora têm o alvo de toque do DS (44 px).
test('P2-4: links dos agentes em /studio/organizacao com alvo de toque de 44 px', async ({ page, context }) => {
  await entrar(context, 'uiux-adm', 'admin');
  await page.goto('/studio/organizacao');
  const links = page.locator('main a[href^="/studio/organizacao/"]');
  expect(await links.count()).toBeGreaterThan(10);
  for (const l of (await links.all()).slice(0, 10)) expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});