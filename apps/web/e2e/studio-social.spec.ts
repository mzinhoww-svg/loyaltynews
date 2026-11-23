import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

test.describe('Social dashboard (@ln/growth)', () => {
  test('resumo honesto: sem pacotes, canais desligados, métricas indisponíveis, sem publicar', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/social');
    await expect(page.getByRole('heading', { level: 1, name: 'Social dashboard' })).toBeVisible();
    await expect(page.getByText(/A publicação é somente simulada/)).toBeVisible();
    const resumo = page.getByRole('region', { name: 'Resumo do Social Dashboard' });
    await expect(resumo.getByText('Modo simulado: nada é enviado ao mLabs.')).toBeVisible();
    await expect(resumo.locator('[data-channel="instagram"]')).toContainText('Chave desligada');
    await expect(resumo.locator('[data-channel="the_loyal"]')).toContainText('Chave desligada');
    await expect(resumo.locator('[data-metrics]')).toContainText('indisponíveis');
    await expect(page.getByText('Canais: LinkedIn desligado nesta fase · Instagram desligado nesta fase · The Loyal desligado nesta fase.')).toBeVisible();
    await expect(page.getByRole('button', { name: /publicar/i })).toHaveCount(0);
  });

  test('filtros válidos e inválidos; pacote inexistente dá 404', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/social');
    await page.getByRole('search', { name: 'Filtrar pacotes' }).getByLabel('Canal').selectOption('instagram');
    await page.getByRole('search', { name: 'Filtrar pacotes' }).getByLabel('Estado').selectOption('bloqueado');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(/channel=instagram&status=bloqueado/);
    await page.goto('/studio/social?channel=tiktok');
    await expect(page.getByText('Filtro inválido.')).toBeVisible();
    const r = await page.goto('/studio/social/materia-x:linkedin:v1');
    expect(r?.status()).toBe(404);
    const r2 = await page.goto('/studio/social/id-invalido');
    expect(r2?.status()).toBe(404);
  });

  test('métricas do mLabs: sem fonte de leitura, estado vazio honesto (sem zero inventado) e axe ok', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/social');
    const sec = page.locator('[data-metricas]');
    await expect(sec.getByRole('heading', { name: 'Métricas do LinkedIn (mLabs, só leitura)' })).toBeVisible();
    await expect(sec).toHaveAttribute('data-metricas', 'indisponivel');
    await expect(sec.locator('[data-vazio="metricas"]')).toContainText('Métricas indisponíveis.');
    await expect(sec.locator('[data-vazio="metricas"]')).toContainText('sem números fictícios');
    await expect(sec.locator('[data-metrica]')).toHaveCount(0); // nenhum número quando não há leitura
    await expect(page.getByText('Métricas de alcance: não disponível (sem integração).')).toHaveCount(0);
    const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test('papéis: revisor lê, comercial não acessa', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/social');
    await expect(page.getByRole('heading', { level: 1, name: 'Social dashboard' })).toBeVisible();
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/social');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  });
});
