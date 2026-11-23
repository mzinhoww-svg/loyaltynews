import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

test.describe('Home e menus', () => {
  test.describe.configure({ mode: 'serial' });

  test('mostra a ordem do blueprint; header e footer não saem do lugar nem se escondem', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus');
    const blocos = page.getByRole('list', { name: 'Blocos da home em ordem' }).getByRole('listitem');
    await expect(blocos).toHaveCount(13);
    await expect(blocos.nth(1)).toContainText('Logo, header e menu');
    await expect(blocos.nth(12)).toContainText('Footer');
    await expect(page.getByRole('button', { name: 'Subir Logo, header e menu' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ocultar Footer' })).toHaveCount(0);
    await expect(blocos.nth(2)).toContainText('reserva 1280×150');
    await expect(blocos.nth(10)).toContainText('reserva 1280×200');
  });

  test('editar é rascunho; salvar cria versão; reverter cria nova versão', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus');
    await page.getByRole('button', { name: 'Subir Destaques' }).click();
    await expect(page.getByText('Rascunho com alterações não salvas')).toBeVisible();
    await expect(page.getByText('Versão vigente: v1')).toBeVisible();
    const blocos = page.getByRole('list', { name: 'Blocos da home em ordem' }).getByRole('listitem');
    await expect(blocos.nth(2)).toContainText('Destaques');

    await page.getByRole('button', { name: 'Ocultar Banner topo' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Banner topo' })).toContainText('reserva 1280×150');
    await page.getByLabel('Nota da versão').fill('destaques antes do banner');
    await page.getByRole('button', { name: 'Salvar versão' }).click();
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Versão v2 salva.' }).first()).toBeVisible();
    await expect(page.getByText('Versão vigente: v2')).toBeVisible();

    await page.getByRole('button', { name: 'Reverter para v1' }).click();
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'nova versão v3' }).first()).toBeVisible();
    await expect(page.getByText('Versão vigente: v3')).toBeVisible();
    await expect(blocos.nth(2)).toContainText('Banner topo');
    await expect(page.getByText('rollback para v1')).toBeVisible();
    await expect(page.getByText(/v2 · [0-9a-f-]{36} · /)).toBeVisible();
  });

  test('item de menu com flag desligada não pode ficar visível', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus');
    await page.getByRole('button', { name: 'Mostrar Market Data no menu' }).click();
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'portalMarketData' }).first()).toBeVisible();
    await page.getByLabel('Nota da versão').fill('tentativa');
    await page.getByRole('button', { name: 'Salvar versão' }).click();
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'flag portalMarketData, desligada' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Descartar rascunho' }).click();
    await expect(page.getByText('Rascunho descartado.')).toBeVisible();
  });

  test('editor sem chefia não acessa', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/home-menus');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  });
});

test.describe('SEO', () => {
  test.describe.configure({ mode: 'serial' });

  test('redirecionamentos válidos; recusa ciclo, rota canônica e domínio', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/seo');
    await expect(page.getByRole('heading', { name: 'Nenhum redirecionamento' })).toBeVisible();
    const criar = async (de: string, para: string) => {
      await page.getByLabel(/Origem \(caminho\)/).fill(de);
      await page.getByLabel(/Destino \(caminho\)/).fill(para);
      await page.getByRole('button', { name: 'Criar redirecionamento' }).click();
    };
    await criar('/noticia-antiga/', '/noticia/nova');
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Redirecionamento criado.' }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /noticia-antiga/ })).toContainText('301');

    await criar('/noticia/nova', '/noticia-antiga');
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'formaria um ciclo' }).first()).toBeVisible();
    await criar('/editoria/pontos', '/outra');
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'rota canônica ativa' }).first()).toBeVisible();
    await criar('https://x.com/a', '/b');
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'Origem inválida' }).first()).toBeVisible();

    await criar('/noticia/nova', '/noticia/final');
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Redirecionamento criado.' }).first()).toBeVisible();
    await expect(page.getByText(/Cadeias de redirecionamento/)).toContainText('/noticia-antiga → /noticia/nova → /noticia/final');

    await page.getByRole('button', { name: 'Remover redirecionamento de /noticia-antiga' }).click();
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'removido' }).first()).toBeVisible();
  });

  test('prévia do sitemap lista as dez editorias', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/seo');
    await expect(page.getByRole('list', { name: 'Rotas canônicas' }).getByText(/\/editoria\//)).toHaveCount(10);
    await expect(page.getByRole('button', { name: 'Criar redirecionamento' })).toHaveCount(0);
  });
});
