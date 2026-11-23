import { expect, test, type BrowserContext } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;

async function entrar(context: BrowserContext, userId: string, roles: string) {
  await context.clearCookies();
  await context.addCookies([{ name: 'ln-test-session', value: `${userId}:${roles}`, url: BASE }]);
}
const erro = (page: import('@playwright/test').Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: import('@playwright/test').Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();

test.describe('Comercial (@ln/commercial)', () => {
  test.describe.configure({ mode: 'serial' });

  test('papéis: só comercial e admin; editor é negado', async ({ page, context }) => {
    await entrar(context, 'ed', 'editor');
    for (const m of ['crm', 'inventario', 'campanhas']) {
      await page.goto(`/studio/${m}`);
      await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    }
  });

  test('inventário: 9 posições, sem número inventado, venda desligada, filtros do catálogo', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/inventario');
    await expect(page.getByRole('heading', { level: 1, name: 'Inventário' })).toBeVisible();
    await expect(page.getByText('Venda no ad server:')).toContainText('desligada');
    await expect(page.locator('tr[data-posicao]')).toHaveCount(9);
    await expect(page.locator('tr[data-posicao="TOP"]')).toContainText('1280x150');
    await expect(page.getByText(/Capacidades: venda desligada.*Instagram desligado/)).toBeVisible();
    await expect(page.getByText('Audiência:')).toBeVisible();

    const linhas = page.getByRole('table').nth(1).locator('tbody tr');
    const todos = await linhas.count();
    expect(todos).toBe(47);
    await page.getByLabel('Disponibilidade').selectOption('indisponivel');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    const filtrados = await page.getByRole('table').nth(1).locator('tbody tr').count();
    expect(filtrados).toBeLessThan(47);
    await page.goto('/studio/inventario?status=xyz');
    await expect(page.getByText('Filtro inválido.')).toBeVisible();
  });

  test('CRM: estado vazio, validação, lead → qualificado → oportunidade → estágios', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/crm');
    await expect(page.getByRole('heading', { name: 'Nenhum lead' })).toBeVisible();
    await page.getByRole('button', { name: 'Registrar lead' }).click();
    await erro(page, /obrigatórios|Entrada inválida/);

    await page.getByLabel('Nome', { exact: true }).fill('Maria Souza');
    await page.getByLabel('Empresa').fill('Banco Exemplo');
    await page.getByLabel('E-mail').fill('maria@bancoexemplo.com.br');
    await page.getByLabel('Objetivo').fill('Campanha de cartão');
    await page.getByRole('button', { name: 'Registrar lead' }).click();
    await sucesso(page, 'Lead registrado');
    await expect(page.getByRole('row', { name: /Maria Souza/ })).toContainText('novo');

    await page.getByRole('button', { name: 'qualificar Maria Souza' }).click();
    await sucesso(page, 'Lead qualificado.');
    await page.getByRole('button', { name: 'converter Maria Souza' }).click();
    await sucesso(page, 'Lead convertido em oportunidade.');
    await expect(page.getByRole('row', { name: /Maria Souza/ })).toContainText('convertido');
    await expect(page.locator('[data-stage="novo"]')).toContainText('Banco Exemplo');

    await page.getByLabel(/Mover .* para/).first().selectOption('perdido');
    await page.getByRole('button', { name: /^Mover / }).first().click();
    await erro(page, /motivo/i);
    await page.getByLabel(/Mover .* para/).first().selectOption('perdido'); // a página recarregou após a recusa
    await page.getByLabel(/Motivo da perda/).first().fill('Sem verba');
    await page.getByRole('button', { name: /^Mover / }).first().click();
    await sucesso(page, 'Estágio atualizado.');
    await expect(page.locator('[data-stage="perdido"]')).toContainText('Banco Exemplo');

    await page.goto('/studio/crm?status=descartado');
    await expect(page.getByRole('heading', { name: 'Nenhum lead' })).toBeVisible();
    await page.goto('/studio/crm?status=zzz');
    await expect(page.getByText('Filtro inválido.')).toBeVisible();
  });

  test('campanhas: criar a partir da conta, estados do blueprint e recusas do domínio', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/campanhas');
    await expect(page.getByText('Venda no ad server:')).toContainText('desligada');
    await page.getByLabel('Nome', { exact: true }).fill('Cartão Verão');
    await page.getByLabel('Início (AAAA-MM-DD)').fill('2099-01-10');
    await page.getByLabel('Fim (AAAA-MM-DD)').fill('2099-01-09');
    await page.getByRole('button', { name: 'Criar campanha' }).click();
    await erro(page, /endDate|anterior/);

    await page.getByLabel('Nome', { exact: true }).fill('Cartão Verão');
    await page.getByLabel('Início (AAAA-MM-DD)').fill('2099-01-10');
    await page.getByLabel('Fim (AAAA-MM-DD)').fill('2099-01-20');
    await page.getByRole('button', { name: 'Criar campanha' }).click();
    await sucesso(page, 'Campanha criada em rascunho.');
    await page.getByRole('link', { name: 'Cartão Verão' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cartão Verão' })).toBeVisible();
    await expect(page.getByText('sem impressões')).toBeVisible();
    await expect(page.getByText('não disponível (sem analytics)')).toBeVisible();

    await page.getByRole('button', { name: 'Mover para reserved' }).click();
    await erro(page, /reserva/i);
    await expect(page.getByRole('button', { name: 'Mover para active' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Mover para cancelled' }).click();
    await sucesso(page, 'Estado da campanha atualizado.');
    await expect(page.getByText('Estado final.')).toBeVisible();
    const r = await page.goto('/studio/campanhas/inexistente');
    expect(r?.status()).toBe(404);
  });
});
