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

  test('P3-3 /moves vazio: texto do aviso em linha própria e bloco "Enquanto isso"', async ({ page }) => {
    test.skip(mode !== 'empty', 'o estado vazio só aparece com a fonte vazia');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/moves');
    const titulo = page.getByText('Em breve: primeiras movimentações confirmadas', { exact: true });
    const texto = page.getByTestId('moves-empty-text');
    const bt = (await titulo.boundingBox())!;
    const bx = (await texto.boundingBox())!;
    expect(bx.y, 'o texto começa abaixo do título').toBeGreaterThanOrEqual(bt.y + bt.height - 1);
    const meanwhile = page.getByTestId('moves-meanwhile');
    await expect(meanwhile.getByRole('link', { name: /Diretório de empresas/ })).toHaveAttribute('href', '/intelligence/empresas');
    await expect(meanwhile.getByRole('link', { name: /Pessoas e cargos/ })).toHaveAttribute('href', '/intelligence/pessoas');
  });
});
