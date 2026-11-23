import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

test.describe('Organização agêntica (@ln/agents)', () => {
  test('organização: 7 diretorias, 10 redações e 64 agentes dos registros oficiais; nada executa', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/organizacao');
    await expect(page.getByRole('heading', { level: 1, name: 'Organização agêntica' })).toBeVisible();
    await expect(page.getByText(/64 perfis, 19 workflows e 28 rituais/)).toBeVisible();
    await expect(page.getByText('Rituais: desligados e chamadas de modelo', { exact: false })).toBeVisible();
    await expect(page.locator('tr[data-diretoria]')).toHaveCount(7);
    await expect(page.locator('tr[data-redacao]')).toHaveCount(10);
    await expect(page.locator('tr[data-agente]')).toHaveCount(64);
    await page.getByLabel('Departamento').selectOption('editorial');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    const n = await page.locator('tr[data-agente]').count();
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(64);
  });

  test('perfil do agente: missão, ferramentas, equipe e 404', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/organizacao');
    await page.locator('tr[data-agente] a').first().click();
    await expect(page.getByRole('heading', { name: 'Missão' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Ferramentas permitidas' })).toBeVisible();
    await expect(page.getByText('A execução do agente (chamadas de modelo) só acontece quando elas forem ligadas')).toBeVisible();
    expect((await page.goto('/studio/organizacao/agente-que-nao-existe'))?.status()).toBe(404);
  });

  test('reuniões: dia útil tem rituais, domingo/feriado não; execução não registrada; navegação por dia', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/reunioes?data=2026-11-23'); // segunda-feira útil
    await expect(page.locator('[data-dia="2026-11-23"]')).toBeVisible();
    const linhas = page.locator('tr[data-ritual]');
    expect(await linhas.count()).toBeGreaterThan(5);
    await expect(linhas.first()).toContainText('não executada');
    await expect(page.getByText('Execução dos rituais: desligada')).toBeVisible();

    await page.goto('/studio/reunioes?data=2026-11-22'); // domingo
    await expect(page.getByRole('heading', { name: 'Nenhum ritual neste dia' })).toBeVisible();
    await page.goto('/studio/reunioes?data=2026-12-25'); // Natal
    await expect(page.getByRole('heading', { name: 'Nenhum ritual neste dia' })).toBeVisible();

    await page.goto('/studio/reunioes?data=2026-11-23');
    await page.getByRole('link', { name: 'Próximo dia →' }).click();
    await expect(page.locator('[data-dia="2026-11-24"]')).toBeVisible();
    await page.goto('/studio/reunioes?data=2040-01-02');
    await expect(page.locator('main .st-alert.err')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Todos os rituais \(28\)/ })).toBeVisible();
  });

  test('decisões e atas: vazio honesto, filtro inválido, papéis', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/decisoes');
    await expect(page.getByRole('heading', { name: 'Nenhuma decisão registrada' })).toBeVisible();
    await expect(page.locator('[data-vazio="acoes"]')).toBeVisible();
    await expect(page.getByText('hoje desligada (flag rituais)')).toBeVisible();
    await page.goto('/studio/decisoes?status=zzz');
    await expect(page.getByText('Filtro inválido.')).toBeVisible();
    await entrar(context, 'ed', 'editor');
    await page.goto('/studio/decisoes');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  });
});
