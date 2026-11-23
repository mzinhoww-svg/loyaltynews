import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Entity Intelligence no portal: lista de empresas com filtro por tipo, página da empresa com vínculos e fonte de cada um,
 * navegação entre empresas relacionadas, estado vazio honesto (empty; pessoas e Moves) e axe nos três modos.
 *   empty → fonte vazia; mock → fixtures MOCK; api → e2e/fake-api.mjs no formato do contrato público.
 */
const mode = (process.env.PORTAL_MODE ?? 'empty') as 'empty' | 'mock' | 'api';

async function axe(page: Page) {
  await page.waitForLoadState('networkidle');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(summary, summary.join('\n')).toEqual([]);
}

test.describe('empty', () => {
  test.skip(mode !== 'empty', 'somente no modo empty');

  test('diretório, pessoas e Moves vazios e honestos; perfil inexistente é 404', async ({ page }) => {
    await page.goto('/intelligence/empresas');
    await expect(page.getByText('Em breve: primeiros perfis verificados')).toBeVisible();
    await expect(page.getByTestId('company-list')).toHaveCount(0);
    await axe(page);
    await page.goto('/intelligence/empresas?tipo=company');
    await expect(page.getByText('Nenhuma empresa com esse filtro')).toBeVisible();
    const r = await page.goto('/intelligence/empresas/00000000-0000-4000-8000-00000000000a');
    expect(r?.status()).toBe(404);
    await page.goto('/moves');
    await expect(page.getByText('Em breve: primeiras movimentações confirmadas')).toBeVisible();
  });
});

test.describe('mock', () => {
  test.skip(mode !== 'mock', 'somente no modo mock');

  test('lista MOCK rotulada, perfil com vínculos e navegação de ida e volta', async ({ page }) => {
    await page.goto('/intelligence/empresas');
    const list = page.getByTestId('company-list');
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list).toContainText('MOCK');
    await axe(page);
    await page.getByRole('link', { name: 'Programa', exact: false }).filter({ hasText: 'Programa de Teste' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Programa de Teste (MOCK)');
    await expect(page.getByTestId('relations')).toContainText('Controlada por');
    await axe(page);
    await page.getByTestId('relations').getByRole('link', { name: 'Empresa de Teste (MOCK)' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Empresa de Teste (MOCK)');
    await expect(page.getByTestId('relations').locator('tbody tr')).toHaveCount(2);
  });
});

test.describe('api', () => {
  test.skip(mode !== 'api', 'somente no modo api');

  test('lista com filtro por tipo e contagens', async ({ page }) => {
    await page.goto('/intelligence/empresas');
    await expect(page.getByTestId('company-list').getByRole('listitem')).toHaveCount(5);
    const chips = page.getByRole('list', { name: 'Filtrar por tipo' });
    await expect(chips.getByRole('link', { name: 'Todos (5)' })).toHaveAttribute('aria-current', 'true');
    await chips.getByRole('link', { name: 'Empresa (2)' }).click();
    await expect(page).toHaveURL(/tipo=company/);
    await expect(page.getByTestId('company-list').getByRole('listitem')).toHaveCount(2);
    await expect(page.getByTestId('directory-count')).toContainText('2 organizações · Empresa');
    await expect(chips.getByRole('link', { name: 'Empresa (2)' })).toHaveAttribute('aria-current', 'true');
    await axe(page);
    // Tipo inválido na URL é ignorado (mostra todos), nunca erro.
    await page.goto('/intelligence/empresas?tipo=%3Cscript%3E');
    await expect(page.getByTestId('company-list').getByRole('listitem')).toHaveCount(5);
  });

  test('perfil: vínculos com fonte, link e data; sem trecho literal; navegação entre relacionadas', async ({ page }) => {
    await page.goto('/intelligence/empresas');
    await page.getByRole('link', { name: '[MOCK API] Programa Alfa' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK API] Programa Alfa');
    const rel = page.getByTestId('relations');
    await expect(rel.locator('tbody tr')).toHaveCount(3);
    await expect(rel).toContainText('Parceria anunciada com');
    await expect(rel).toContainText('Vínculo declarado com');
    const src = rel.getByRole('link', { name: /Fonte de teste/ }).first();
    await expect(src).toHaveAttribute('href', /^https:\/\/fonte-.*\.invalid\//);
    await expect(src).toHaveAttribute('rel', /noopener/);
    await expect(rel.locator('time').first()).toHaveAttribute('datetime', '2026-11-23T00:00:00.000Z');
    await expect(page.locator('main')).not.toContainText('TRECHO LITERAL');
    await expect(page.getByText('Em breve: executivos verificados')).toBeVisible();
    await axe(page);

    await rel.getByRole('link', { name: '[MOCK API] Clube Delta' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK API] Clube Delta');
    await expect(page.getByTestId('company-meta')).toContainText('Tipo não declarado na fonte');
    await page.getByTestId('relations').getByRole('link', { name: '[MOCK API] Associação Gama' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK API] Associação Gama');
    await expect(page.getByTestId('relations').locator('tbody tr')).toHaveCount(2);
  });

  test('perfil inexistente ou id fora do formato: 404', async ({ page }) => {
    expect((await page.goto('/intelligence/empresas/10000000-0000-4000-8000-000000000999'))?.status()).toBe(404);
    expect((await page.goto('/intelligence/empresas/nao-e-uuid'))?.status()).toBe(404);
  });

  test('hub conta empresas; pessoas e Moves seguem vazios', async ({ page }) => {
    await page.goto('/intelligence');
    await expect(page.getByTestId('count-empresas')).toHaveText('5 cadastrado(s) e verificado(s)');
    await expect(page.getByTestId('count-pessoas')).toHaveText('Cadastros verificados: em breve');
    await page.goto('/intelligence/pessoas');
    await expect(page.getByText('Em breve: primeiros perfis verificados')).toBeVisible();
    await axe(page);
    await page.goto('/moves');
    await expect(page.getByText('Em breve: primeiras movimentações confirmadas')).toBeVisible();
    await axe(page);
  });
});
