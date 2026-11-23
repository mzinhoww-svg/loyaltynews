import { expect, test, type Page } from '@playwright/test';
import { api, entrar, enviar } from './helpers';

// Pedidos do titular (DP-38: correção e remoção de pessoa): POST /api/studio/intelligence/subject-requests e ações, só admin, sessão real.
// Roda depois de studio-j-entidades.spec.ts (nome do arquivo), que semeia as pessoas MOCK.
test.describe.configure({ mode: 'serial' });

const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();

let bruno = '';
let carla = '';

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const r = await ctx.request.get('/api/e2e/login?seed=intelligence');
  expect(r.ok(), `seed do Intelligence: ${r.status()}`).toBe(true);
  ({ bruno, carla } = (await r.json()) as { bruno: string; carla: string });
  await ctx.close();
});

test('editor vê o que fazer, mas não abre pedido; a rota recusa', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto(`/studio/entidades/pessoa/${bruno}`);
  await expect(page.locator('[data-secao="pedidos-do-titular"]')).toBeVisible();
  await expect(page.locator('[data-pedidos="so-admin"]')).toContainText('tratados pelo admin');
  await expect(page.getByRole('form', { name: 'Abrir pedido do titular' })).toHaveCount(0);
  const r = await api(context, 'POST', '/api/studio/intelligence/subject-requests', { personId: bruno, kind: 'suppression' });
  expect(r.status).toBe(403);
});

test('correção do nome: abre o pedido, corrige e a página mostra o nome novo', async ({ page, context }) => {
  await entrar(context, 'adm', 'admin');
  await page.goto(`/studio/entidades/pessoa/${bruno}`);
  await page.locator('#kind').selectOption('rectification');
  await page.locator('#note').fill('Pedido do titular por e-mail, nome com grafia errada.');
  await enviar(page, page.getByRole('button', { name: 'Abrir pedido' }));
  await sucesso(page, 'Pedido aberto.');
  const form = page.getByRole('form', { name: 'Concluir correção do nome' });
  await expect(form).toBeVisible();
  await form.getByLabel('Nome correto').fill('MOCK Bruno Lima Filho');
  await enviar(page, form.getByRole('button', { name: 'Corrigir o nome' }));
  await sucesso(page, 'Nome retificado');
  await expect(page.getByRole('heading', { level: 1, name: 'MOCK Bruno Lima Filho' })).toBeVisible();
});

test('acesso: abre o pedido e exporta o que o sistema guarda (nome e cargos), sem trecho de página', async ({ page, context }) => {
  await entrar(context, 'adm', 'admin');
  await page.goto(`/studio/entidades/pessoa/${carla}`);
  await page.locator('#kind').selectOption('access');
  await enviar(page, page.getByRole('button', { name: 'Abrir pedido' }));
  await sucesso(page, 'Pedido aberto.');
  await enviar(page, page.getByRole('button', { name: 'Exportar os dados do titular' }));
  await sucesso(page, 'Pedido de acesso concluído');
  const dados = page.locator('[data-exportado="sim"]');
  await expect(dados).toContainText('MOCK Carla Dias');
  await expect(dados).not.toContainText('MOCK trecho');
});

test('remoção: exige confirmação; some do portal, das consultas e a página dá 404', async ({ page, context }) => {
  await entrar(context, 'adm', 'admin');
  await page.goto(`/studio/entidades/pessoa/${carla}`);
  await page.locator('#kind').selectOption('suppression');
  await enviar(page, page.getByRole('button', { name: 'Abrir pedido' }));
  await sucesso(page, 'Pedido aberto.');
  const form = page.getByRole('form', { name: 'Concluir remoção da pessoa' });
  await enviar(page, form.getByRole('button', { name: 'Remover a pessoa' }));
  await erro(page, 'Marque a confirmação');
  await page.getByRole('form', { name: 'Concluir remoção da pessoa' }).getByLabel(/Confirmo a remoção/).check();
  await enviar(page, page.getByRole('form', { name: 'Concluir remoção da pessoa' }).getByRole('button', { name: 'Remover a pessoa' }));
  await expect(page).toHaveURL(/\/studio\/entidades\?/);
  await sucesso(page, 'Pessoa removida');
  expect((await page.goto(`/studio/entidades/pessoa/${carla}`))?.status()).toBe(404);
  await page.goto('/studio/entidades?q=Carla');
  await expect(page.getByRole('heading', { name: 'Nenhum resultado' })).toBeVisible();
});
