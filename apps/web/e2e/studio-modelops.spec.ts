import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

test.describe('ModelOps e FinOps (@ln/modelops)', () => {
  test('só admin acessa', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    for (const m of ['modelops', 'finops']) {
      await page.goto(`/studio/${m}`);
      await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    }
  });

  test('catálogo: política rotulada como PROPOSTA, chamadas reais bloqueadas, modelos com preço e data', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/modelops');
    await expect(page.getByRole('heading', { level: 1, name: 'ModelOps' })).toBeVisible();
    await expect(page.getByText(/PROPOSTA DP-02 v5/).first()).toBeVisible();
    await expect(page.locator('[data-reais="nao"]')).toHaveText('bloqueadas');
    expect(await page.locator('tr[data-modelo]').count()).toBeGreaterThan(3);
    await expect(page.locator('tr[data-modelo]').first()).toContainText(/em 20\d\d-\d\d-\d\d|sem preço/);
  });

  test('simulação de rota: sem qualificação bloqueia com motivos; classe não pública bloqueia; determinística não usa modelo; não gasta', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/modelops?task=editorial_draft&classe=public');
    const r = page.getByRole('region', { name: 'Resultado da simulação' });
    await expect(r).toHaveAttribute('data-status', 'blocked');
    await expect(r).toContainText('no_eligible_candidate');
    await expect(page.getByRole('list', { name: 'Motivos por candidato' })).toContainText('not_qualified');
    await expect(r).toContainText('nenhum custo foi reservado');

    await page.goto('/studio/modelops?task=editorial_draft&classe=personal');
    await expect(page.getByRole('region', { name: 'Resultado da simulação' })).toContainText('personal_no_approved_processor');

    await page.goto('/studio/modelops?task=source_ingestion&classe=public');
    await expect(page.getByRole('region', { name: 'Resultado da simulação' })).toHaveAttribute('data-status', 'deterministic');

    await page.goto('/studio/modelops?task=tarefa_inexistente');
    await expect(page.getByRole('region', { name: 'Resultado da simulação' })).toContainText('unknown_task');
    await page.goto('/studio/finops');
    await expect(page.locator('[data-consumo]')).not.toHaveText(/US\$ [1-9]/); // a simulação não consumiu nada (sem banco: indisponível; com banco: US$ 0.00)
  });

  test('finops: teto, verbas e degraus da política, consumo zero sem inventar projeção', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/finops');
    await expect(page.getByRole('heading', { level: 1, name: 'FinOps' })).toBeVisible();
    await expect(page.locator('[data-teto]')).toHaveText('US$ 50.00');
    // sem banco no e2e: o consumo é "indisponível" (nunca um zero inventado); com banco e sem chamadas: "Sem consumo"
    await expect(page.locator('[data-consumo]')).toHaveText(/indisponível|US\$ 0\.00/);
    await expect(page.locator('tr[data-provedor="openai"]')).toContainText('US$ 20.00');
    await expect(page.locator('tr[data-provedor="anthropic"]')).toContainText('US$ 22.00');
    await expect(page.getByRole('list', { name: 'Degraus de gasto' })).toContainText('US$ 42.00');
    await expect(page.getByText('Chamadas de modelo: desabilitadas')).toBeVisible();
    await expect(page.getByText('Forecast e alertas dependem de consumo real')).toBeVisible();
  });
});
