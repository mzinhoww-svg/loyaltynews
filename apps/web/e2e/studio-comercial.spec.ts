import { expect, test } from '@playwright/test';
import { entrar, enviar } from './helpers';

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
    await enviar(page, page.getByRole('button', { name: 'Filtrar' }));
    const filtrados = await page.getByRole('table').nth(1).locator('tbody tr').count();
    expect(filtrados).toBeLessThan(47);
    await page.goto('/studio/inventario?status=xyz');
    await expect(page.getByText('Filtro inválido.')).toBeVisible();
  });

  test('CRM: estado vazio, validação, lead → qualificado → oportunidade → estágios', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/crm');
    await expect(page.getByRole('heading', { name: 'Nenhum lead' })).toBeVisible();
    await enviar(page, page.getByRole('button', { name: 'Registrar lead' }));
    await erro(page, /obrigatórios|Entrada inválida/);

    await page.getByLabel('Nome', { exact: true }).fill('Maria Souza');
    await page.getByLabel('Empresa').fill('Banco Exemplo');
    await page.getByLabel('E-mail').fill('maria@bancoexemplo.com.br');
    await page.getByLabel('Objetivo').fill('Campanha de cartão');
    await enviar(page, page.getByRole('button', { name: 'Registrar lead' }));
    await sucesso(page, 'Lead registrado');
    await expect(page.getByRole('row', { name: /Maria Souza/ })).toContainText('novo');

    await enviar(page, page.getByRole('button', { name: 'qualificar Maria Souza' }));
    await sucesso(page, 'Lead qualificado.');
    await enviar(page, page.getByRole('button', { name: 'converter Maria Souza' }));
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
    await expect(page.getByRole('heading', { name: 'Nenhuma campanha' })).toBeVisible();
    await expect(page.locator('[data-estado="draft"]')).toContainText('draft: 0');
    await page.getByLabel('Nome', { exact: true }).fill('Cartão Verão');
    await page.getByLabel('Início (AAAA-MM-DD)').fill('2099-01-10');
    await page.getByLabel('Fim (AAAA-MM-DD)').fill('2099-01-09');
    await enviar(page, page.getByRole('button', { name: 'Criar campanha' }));
    await erro(page, /endDate|anterior/);

    await page.getByLabel('Nome', { exact: true }).fill('Cartão Verão');
    await page.getByLabel('Início (AAAA-MM-DD)').fill('2099-01-10');
    await page.getByLabel('Fim (AAAA-MM-DD)').fill('2099-01-20');
    await enviar(page, page.getByRole('button', { name: 'Criar campanha' }));
    await sucesso(page, 'Campanha criada em rascunho.');
    await expect(page.getByRole('heading', { level: 1, name: 'Cartão Verão' })).toBeVisible();
    await expect(page.getByText('sem impressões')).toBeVisible();
    await expect(page.getByText('não disponível (sem analytics)')).toBeVisible();

    await enviar(page, page.getByRole('button', { name: 'Mover para reserved' }));
    await erro(page, /reserva/i);
    await expect(page.getByRole('button', { name: 'Mover para active' })).toHaveCount(0);

    await enviar(page, page.getByRole('button', { name: 'Mover para cancelled' }));
    await sucesso(page, 'Estado da campanha atualizado.');
    await expect(page.getByText('Estado final.')).toBeVisible();
    await page.goto('/studio/campanhas');
    await expect(page.locator('[data-estado="cancelled"]')).toContainText('cancelled: 1');
    await expect(page.locator('[data-estado="draft"]')).toContainText('draft: 0');
    // lista do Backend (GET /api/commercial/studio/campaigns): linha com estado, formato, período e anunciante; filtros e recusa de filtro
    const linha = page.locator('tr[data-campanha]').filter({ hasText: 'Cartão Verão' });
    await expect(linha).toHaveAttribute('data-status', 'cancelled');
    await expect(linha).toContainText('2099-01-10 → 2099-01-20');
    await expect(page.getByText('1 campanha(s) · página 1 de 1')).toBeVisible();
    await page.getByLabel('Estado', { exact: true }).selectOption('active');
    await enviar(page, page.getByRole('button', { name: 'Filtrar' }));
    await expect(page.locator('[data-vazio="filtro"]')).toBeVisible();
    await page.goto('/studio/campanhas?status=cancelled&q=verao');
    await expect(page.locator('[data-vazio="filtro"]')).toBeVisible(); // 'verao' sem acento não casa com 'Verão': busca é por nome contém
    await page.goto('/studio/campanhas?status=cancelled&q=Cartão');
    await expect(page.locator('tr[data-campanha]')).toHaveCount(1);
    await page.goto('/studio/campanhas');
    await page.getByLabel('ID da campanha').fill('campanha-que-nao-existe');
    await enviar(page, page.getByRole('button', { name: 'Abrir' }));
    await expect(page).toHaveURL(/campanhas[/]campanha-que-nao-existe/);
    const r = await page.goto('/studio/campanhas/inexistente');
    expect(r?.status()).toBe(404);
  });
});
