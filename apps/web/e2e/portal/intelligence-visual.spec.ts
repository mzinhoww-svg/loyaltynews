import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Revisão visual do staging da int/012 (packages/ui/docs/revisao-visual-staging-int012.md), itens da Frontend 2:
 *  - P2-4: alvos de toque >= 44px no mobile (hub /intelligence, link da política em /moves, botões de rádio de /correcoes >= 24px
 *    com a linha inteira de 44px); o desktop não muda.
 *  - P3-3: /moves vazio com o texto do aviso em linha própria (não colado ao título em negrito) e um bloco "Enquanto isso".
 * Só no projeto desktop (que muda a largura da janela); as medidas valem para qualquer fonte de dados.
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const altura = async (l: Locator) => (await l.boundingBox())!.height;
const mobile = (page: Page) => page.setViewportSize({ width: 375, height: 812 });

test.describe('revisão visual int/012 — Frontend 2', () => {
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(info.project.name !== 'desktop', 'mede em larguras próprias');
  });

  test('P2-4 /intelligence: os três atalhos têm 44px no mobile e ficam como antes no desktop', async ({ page }) => {
    await mobile(page);
    await page.goto('/intelligence');
    for (const t of ['empresas', 'pessoas', 'moves']) expect(await altura(page.getByTestId(`tile-${t}`)), t).toBeGreaterThanOrEqual(44);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/intelligence');
    expect(await altura(page.getByTestId('tile-empresas'))).toBeLessThan(44);
  });

  test('P2-4 /moves: o link da política tem 44px no mobile', async ({ page }) => {
    await mobile(page);
    await page.goto('/moves');
    expect(await altura(page.getByTestId('moves-privacy'))).toBeGreaterThanOrEqual(44);
  });

  test('P2-4 /correcoes: botões de rádio com 24px e a linha clicável com 44px', async ({ page }) => {
    await mobile(page);
    await page.goto('/correcoes');
    const form = page.getByTestId('pedido-form');
    for (const nome of ['Correção de um dado', 'Remoção de um dado']) {
      const radio = form.getByLabel(nome);
      const box = (await radio.boundingBox())!;
      expect(box.width, nome).toBeGreaterThanOrEqual(24);
      expect(box.height, nome).toBeGreaterThanOrEqual(24);
      expect(await altura(form.locator('label').filter({ hasText: nome })), nome).toBeGreaterThanOrEqual(44);
    }
  });

  // P1-1 (revisão visual do staging, int/022): o perfil de pessoa estourava a 390 px (scrollWidth 554–595). Causa: o texto para leitor
  // de tela (`.pt-sr`, position: absolute) dentro da região de rolagem da tabela era posicionado em relação a um ancestral FORA dela e
  // esticava a página. A região de rolagem passa a ser o bloco de referência; a tabela rola por dentro.
  test('P1-1 390 px: perfil de pessoa e de empresa sem rolagem horizontal; a tabela rola por dentro da região', async ({ page }) => {
    test.skip(mode !== 'mock', 'precisa de pessoa e empresa com cargos (fixtures MOCK)');
    await mobile(page);
    for (const [rota, tabela] of [
      ['/intelligence/pessoas/00000000-0000-4000-8000-0000000000f1', 'current-roles'],
      ['/intelligence/empresas/00000000-0000-4000-8000-00000000000a', 'relations'],
    ] as const) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(rota);
      await expect(page.getByTestId(tabela)).toBeVisible();
      const doc = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(doc, `${rota}: rolagem horizontal da página`).toBeLessThanOrEqual(1);
      if (tabela === 'current-roles') {
        const regiao = await page.getByTestId(tabela).evaluate((t) => {
          const r = t.closest('.pt-scroll') as HTMLElement;
          return { sw: r.scrollWidth, cw: r.clientWidth };
        });
        expect(regiao.sw, 'a tabela de cargos é mais larga que a tela e rola dentro da região').toBeGreaterThan(regiao.cw);
        // As colunas da direita (fonte, validação e o pedido LGPD) continuam alcançáveis rolando a região.
        await page.getByTestId('role-correction').first().scrollIntoViewIfNeeded();
        await expect(page.getByTestId('role-correction').first()).toBeInViewport();
      }
    }
  });

  test('P2-4 (int/022) nome nos cartões de pessoas e de empresas com 44 px no mobile e menos no desktop', async ({ page }) => {
    test.skip(mode !== 'mock', 'precisa de cartões (fixtures MOCK)');
    for (const [rota, id] of [['/intelligence/pessoas', 'person-card-link'], ['/intelligence/empresas', 'company-card-link']] as const) {
      await mobile(page);
      await page.goto(rota);
      const links = page.getByTestId(id);
      expect(await links.count(), rota).toBeGreaterThan(0);
      for (let i = 0; i < (await links.count()); i++) expect(await altura(links.nth(i)), ` #${i}`).toBeGreaterThanOrEqual(44);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(rota);
      // Desktop sem mudança: a regra de 44 px só vale abaixo de 768 px (a altura em si depende de o nome quebrar linha).
      expect(await page.getByTestId(id).first().evaluate((e) => getComputedStyle(e).minHeight), ` desktop`).not.toBe('44px');
    }
  });

  test('M-02 (revisão 25/11) 390 px: legenda da tabela da empresa inteira e fora da rolagem; dica de rolagem; sem coluna repetida', async ({ page }) => {
    test.skip(mode !== 'mock', 'precisa das empresas MOCK');
    await mobile(page);
    // Empresa de Teste (2 vínculos de tipos diferentes). A coluna "Vínculo" sem repetição é conferida no modo api (intelligence.spec, Associação Gama).
    await page.goto('/intelligence/empresas/00000000-0000-4000-8000-00000000000a');
    const legenda = page.locator('#legenda-relations');
    await expect(legenda).toContainText('nenhum vínculo é inferido');
    const caixa = (await legenda.boundingBox())!;
    expect(caixa.x + caixa.width, 'legenda inteira dentro da tela').toBeLessThanOrEqual(375);
    expect(await legenda.evaluate((e) => Boolean(e.closest('[role="region"]'))), 'legenda fora da região de rolagem').toBe(false);
    await expect(page.getByText('Deslize a tabela para o lado')).toBeVisible();
    // Tipos diferentes: a coluna "Vínculo" continua.
    await expect(page.getByTestId('relations').locator('th', { hasText: 'Vínculo' })).toHaveCount(1);
    // No desktop a tabela cabe: sem dica.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/intelligence/empresas/00000000-0000-4000-8000-00000000000a');
    await expect(page.getByText('Deslize a tabela para o lado')).toBeHidden();
  });

  test('M-04 (revisão 25/11): "Período" não mostra a data da coleta como início; coluna de ação com título', async ({ page }) => {
    test.skip(mode !== 'mock', 'precisa da pessoa MOCK');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/intelligence/pessoas/00000000-0000-4000-8000-0000000000f1');
    // Cargo atual: início gravado = dia da coleta/validação (20/11) → início não informado.
    await expect(page.getByTestId('current-roles').getByTestId('periodo')).toHaveText('início não informado na fonte');
    // Cargo anterior: início declarado (1/10) diferente da coleta → período real.
    await expect(page.getByTestId('history-roles').getByTestId('periodo')).toHaveText('01 de outubro de 2026 a 20 de novembro de 2026');
    await expect(page.getByTestId('current-roles').locator('th', { hasText: 'Correção' })).toBeVisible();
  });

  test('P3-3 /moves vazio: texto do aviso em linha própria e bloco "Enquanto isso"', async ({ page }) => {
    test.skip(mode !== 'empty', 'o estado vazio só aparece com a fonte vazia');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/moves');
    const titulo = page.getByText('Ainda não há Moves publicados', { exact: true });
    const texto = page.getByTestId('moves-empty-text');
    const bt = (await titulo.boundingBox())!;
    const bx = (await texto.boundingBox())!;
    expect(bx.y, 'o texto começa abaixo do título').toBeGreaterThanOrEqual(bt.y + bt.height - 1);
    const meanwhile = page.getByTestId('moves-meanwhile');
    await expect(meanwhile.getByRole('link', { name: /Diretório de empresas/ })).toHaveAttribute('href', '/intelligence/empresas');
    await expect(meanwhile.getByRole('link', { name: /Pessoas e cargos/ })).toHaveAttribute('href', '/intelligence/pessoas');
  });
});
