import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, entrar, enviar } from './helpers';

// Watchlists (Studio 2) pelas rotas reais /api/studio/intelligence/watchlists|alerts, com sessão real.
// Roda DEPOIS de studio-intelligence, studio-j-entidades e studio-k-pedidos-titular (nome do arquivo): usa as entidades MOCK
// do seed de Intelligence e usuários próprios (wl-*), para não tocar nas listas dos outros specs.
test.describe.configure({ mode: 'serial' });

const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();

let lista = '';

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const r = await ctx.request.get('/api/e2e/login?seed=intelligence');
  expect(r.ok(), `seed do Intelligence: ${r.status()}`).toBe(true);
  await ctx.close();
});

test('editor cria a lista e adiciona empresa e executivo pela busca, sem digitar UUID', async ({ page, context }) => {
  await entrar(context, 'wl-ed', 'editor');
  await page.goto('/studio/watchlists');
  await expect(page.getByRole('heading', { name: 'Nenhuma watchlist' })).toBeVisible();
  await page.getByLabel('Nome', { exact: true }).fill('MOCK Monitorados');
  await enviar(page, page.getByRole('button', { name: 'Criar watchlist' }));
  await sucesso(page, 'Watchlist criada.');
  lista = new URL(page.url()).searchParams.get('lista') ?? '';
  expect(lista).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 2, name: 'MOCK Monitorados' })).toBeVisible();
  await expect(page.locator('[data-vazio="itens"]')).toBeVisible();
  await expect(page.locator('[data-vazio="alertas"]')).toBeVisible();

  await page.locator('#tipoBusca').selectOption('organization');
  await page.locator('#q').fill('Alfa');
  await enviar(page, page.getByRole('button', { name: 'Buscar' }));
  await enviar(page, page.getByRole('button', { name: 'Adicionar MOCK Alfa Fidelidade S.A.' }));
  await sucesso(page, 'Entidade adicionada à watchlist.');

  await page.locator('#tipoBusca').selectOption('person');
  await page.locator('#q').fill('Ana');
  await enviar(page, page.getByRole('button', { name: 'Buscar' }));
  await enviar(page, page.getByRole('button', { name: 'Adicionar MOCK Ana Souza' }));
  await sucesso(page, 'Entidade adicionada à watchlist.');

  const itens = page.getByRole('list', { name: 'Entidades de MOCK Monitorados' });
  await expect(itens).toContainText('MOCK Alfa Fidelidade S.A.');
  await expect(itens).toContainText('MOCK Ana Souza');
  // busca que não acha nada diz isso, sem inventar
  await page.locator('#q').fill('Inexistente Zeta');
  await enviar(page, page.getByRole('button', { name: 'Buscar' }));
  await expect(page.locator('[data-vazio="busca"]')).toContainText('Nada encontrado');
});

test('alerta de Move com antes e depois, fonte e link; aprovar registra quem revisou', async ({ page, context }) => {
  const r = await context.request.get('/api/e2e/login?seed=alertas-watchlist');
  expect(r.ok()).toBe(true);
  await entrar(context, 'wl-ed', 'editor');
  await page.goto(`/studio/watchlists?lista=${lista}`);
  await expect(page.locator(`[data-lista="${lista}"] [data-pendentes="1"]`)).toBeVisible();
  const alerta = page.locator('[data-alerta]').first();
  await expect(alerta).toContainText('MOCK Ana Souza');
  await expect(alerta.locator('[data-estado-alerta]')).toHaveText('Pendente de revisão');
  await expect(alerta.locator('[data-estado-move]')).toContainText('Move'); // o estado do Move aparece ao lado do estado do alerta
  await expect(alerta.locator('[data-lado="antes"]')).toContainText('Diretora de Marketing');
  await expect(alerta.locator('[data-lado="depois"]')).toContainText('Diretora de CRM');
  await expect(alerta.locator('[data-lado="depois"] a').first()).toHaveAttribute('href', /^https:\/\/mock\.invalid\//);
  await expect(alerta).toContainText('MOCK');

  await enviar(page, page.getByRole('button', { name: 'Aprovar alerta de MOCK Ana Souza' }));
  await sucesso(page, 'Alerta aprovado.');
  await expect(page.locator('[data-vazio="alertas"]')).toBeVisible();
  await page.getByRole('link', { name: 'Aprovado' }).click();
  const aprovado = page.locator('[data-alerta][data-estado="approved"]');
  await expect(aprovado).toContainText('por');
  await expect(aprovado.getByRole('button')).toHaveCount(0);
  // revisar de novo pela rota: 409
  const id = await aprovado.getAttribute('data-alerta');
  const again = await api(context, 'POST', `/api/studio/intelligence/alerts/${id}/review`, { id, status: 'rejected' });
  expect(again.status).toBe(409);
});

test('lista é privada: outro usuário não a vê, nem pela tela nem pela rota', async ({ page, context }) => {
  await entrar(context, 'wl-outro', 'editor_chefe');
  await page.goto(`/studio/watchlists?lista=${lista}`);
  await expect(page.locator('[data-lista-ausente]')).toContainText('não encontrada');
  await expect(page.getByText('MOCK Monitorados')).toHaveCount(0);
  expect((await api(context, 'GET', `/api/studio/intelligence/watchlists/${lista}`)).status).toBe(404);
  expect((await api(context, 'DELETE', `/api/studio/intelligence/watchlists/${lista}`, { id: lista })).status).toBe(404);
});

test('papéis: leitor e revisor não criam (tela sem formulário e rota 403)', async ({ page, context }) => {
  for (const [u, papel] of [['wl-lei', 'leitor'], ['wl-rev', 'revisor']] as const) {
    await entrar(context, u, papel);
    await page.goto('/studio/watchlists');
    await expect(page.getByRole('form', { name: 'Nova watchlist' })).toHaveCount(0);
    await expect(page.getByText('Seu papel só lê as watchlists.')).toBeVisible();
    expect((await api(context, 'POST', '/api/studio/intelligence/watchlists', { name: 'x' })).status).toBe(403);
  }
});

test('axe sem violações com a lista aberta', async ({ page, context }) => {
  await entrar(context, 'wl-ed', 'editor');
  await page.goto(`/studio/watchlists?lista=${lista}&estado=approved`);
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test('remover item e apagar a lista (pede confirmação)', async ({ page, context }) => {
  await entrar(context, 'wl-ed', 'editor');
  await page.goto(`/studio/watchlists?lista=${lista}`);
  await enviar(page, page.getByRole('button', { name: 'Remover MOCK Ana Souza' }));
  await sucesso(page, 'Entidade removida da watchlist.');
  await expect(page.getByRole('list', { name: 'Entidades de MOCK Monitorados' })).not.toContainText('MOCK Ana Souza');

  const apagar = page.getByRole('form', { name: 'Apagar watchlist' });
  await enviar(page, apagar.getByRole('button', { name: 'Apagar watchlist' }));
  await erro(page, 'Marque a confirmação');
  await page.getByRole('form', { name: 'Apagar watchlist' }).getByRole('checkbox').check();
  await enviar(page, page.getByRole('form', { name: 'Apagar watchlist' }).getByRole('button', { name: 'Apagar watchlist' }));
  await sucesso(page, 'Watchlist apagada');
  await expect(page.getByRole('heading', { name: 'Nenhuma watchlist' })).toBeVisible();
});
