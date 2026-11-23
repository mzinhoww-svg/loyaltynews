import { expect, test, type Page } from '@playwright/test';
import { entrar } from './helpers';

const UUID_INEXISTENTE = '11111111-1111-4111-8111-111111111111';

const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();

test.describe('Entity intelligence (@ln/intelligence)', () => {
  test('entidades: banco temporário declarado, flag desligada, busca sem inventar resultado, fila vazia', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/entidades');
    await expect(page.getByRole('heading', { level: 1, name: 'Entity intelligence' })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('Banco temporário em memória');
    await expect(page.getByText('Ingestão de pessoas (flag intelligencePessoas):')).toContainText('desligada');
    await expect(page.locator('[data-vazio="moves"]')).toBeVisible();
    await page.getByLabel('Buscar empresa ou executivo').fill('Banco Inexistente');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page.getByRole('heading', { name: 'Nenhum resultado' })).toBeVisible();
    await expect(page.getByText('Ausência de registro não prova inexistência.').first()).toBeVisible();
  });

  test('empresa inexistente ou id inválido dá 404', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    expect((await page.goto(`/studio/entidades/${UUID_INEXISTENTE}`))?.status()).toBe(404);
    expect((await page.goto('/studio/entidades/nao-e-uuid'))?.status()).toBe(404);
  });

  test('organogramas: sem arestas inventadas; parâmetros inválidos recusados', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/organogramas');
    await expect(page.getByText('Busque uma empresa para ver o organograma.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Buscar empresa' }).fill('Qualquer');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page.getByRole('heading', { name: 'Nenhuma empresa encontrada' })).toBeVisible();
    await page.goto(`/studio/organogramas?org=${UUID_INEXISTENTE}`);
    await expect(page.locator('[data-vazio="orgchart"]')).toBeVisible();
    await expect(page.getByText('0 aresta(s) declarada(s) · 0 inferida(s)')).toBeVisible();
    await page.goto('/studio/organogramas?org=abc');
    await erro(page, 'Parâmetros inválidos.');
  });

  // O fluxo completo das watchlists (criar, buscar e adicionar, alertas com antes/depois, revisar, remover, apagar, dono) está em studio-w-watchlists.spec.ts.
  test('watchlists: estado vazio honesto pela rota', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/watchlists');
    await expect(page.getByRole('heading', { name: 'Nenhuma watchlist' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Nova watchlist' })).toBeVisible();
  });

  test('papéis: leitor lê watchlists mas não cria; comercial não acessa entidades', async ({ page, context }) => {
    await entrar(context, 'lia', 'leitor');
    await page.goto('/studio/watchlists');
    await expect(page.getByRole('button', { name: 'Criar watchlist' })).toHaveCount(0);
    await expect(page.getByText('Seu papel só lê as watchlists.')).toBeVisible();
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/entidades');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  });
});
