import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

// Auditoria: só admin; a única trilha com rota hoje é a do publicador social (simulado); o resto aparece como lacuna, sem dado inventado.
test.describe('Auditoria', () => {
  test('só admin acessa', async ({ page, context }) => {
    for (const role of ['editor_chefe', 'revisor', 'comercial']) {
      await entrar(context, 'ana', role);
      await page.goto('/studio/auditoria');
      await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    }
  });

  test('trilha social vazia diz que está vazia; trilhas sem rota são lacuna declarada', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/auditoria');
    await expect(page.getByRole('heading', { level: 1, name: 'Auditoria' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Nenhum registro' })).toBeVisible();
    await expect(page.getByText('não tem rota de leitura')).toBeVisible();
    await expect(page.locator('[data-lacuna="trilha-do-banco"]')).toContainText('audit_log');
    await page.locator('#limit').selectOption('200');
    await Promise.all([page.waitForLoadState('load'), page.getByRole('button', { name: 'Aplicar' }).click()]);
    await expect(page).toHaveURL(/limit=200/);
    await expect(page.locator('#limit')).toHaveValue('200');
  });

  test('telas em memória dizem de onde vêm os dados', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    for (const m of ['organizacao', 'reunioes', 'decisoes', 'modelops', 'finops']) {
      await page.goto(`/studio/${m}`);
      await expect(page.locator('[data-origem="memoria-do-processo"]')).toContainText('memória do processo do Studio');
    }
  });
});
