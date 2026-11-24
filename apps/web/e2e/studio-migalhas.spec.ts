import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrar, enviar } from './helpers';

// Migalhas (Studio › Seção › Página) em todas as telas, com /studio como raiz clicável e visão geral útil (atalhos + áreas agrupadas).
const trilha = (page: Page) => page.getByRole('navigation', { name: 'Você está aqui' });
const rotulos = async (page: Page) => (await trilha(page).getByRole('listitem').allInnerTexts()).map((t) => t.trim());

test('a visão geral (/studio) leva a todas as áreas visíveis, agrupadas, e tem atalhos', async ({ page, context }) => {
  await entrar(context, 'nav1', 'admin');
  await page.goto('/studio');
  await expect(page.getByRole('heading', { level: 1, name: 'LN Studio' })).toBeVisible();
  expect(await rotulos(page)).toEqual(['Studio']); // na raiz a trilha é só "Studio" (página atual, sem link)
  await expect(trilha(page).locator('a')).toHaveCount(0);
  await expect(page.locator('[data-atalhos] a').filter({ hasText: 'Nova matéria' })).toHaveAttribute('href', '/studio/cms/nova');
  await expect(page.locator('[data-atalhos] a').filter({ hasText: 'Fontes da Fábrica' })).toHaveAttribute('href', '/studio/fontes/fabrica');
  await expect(page.locator('[data-atalhos] a').filter({ hasText: 'Minha conta' })).toHaveAttribute('href', '/studio/conta');
  // as áreas aparecem em grupos com título, e cada área do menu lateral está na visão geral
  expect(await page.locator('[data-grupo]').count()).toBeGreaterThanOrEqual(5);
  const doMenu = (await page.getByRole('navigation', { name: 'Módulos do Studio' }).locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).filter((h) => h !== '/studio'); // sem o próprio "Visão geral"
  const daVisaoGeral = await page.locator('[data-grupo] a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(doMenu.length).toBeGreaterThan(20);
  for (const href of doMenu) expect(daVisaoGeral, `a visão geral não leva a ${href}`).toContain(href);
});

test('toda área tem a trilha Studio › Seção, com "Studio" levando de volta à visão geral', async ({ page, context }) => {
  await entrar(context, 'nav1', 'admin');
  await page.goto('/studio');
  const hrefs = await page.locator('[data-grupo] a').evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  for (const href of hrefs) {
    await page.goto(href);
    const itens = await rotulos(page);
    expect(itens.length, `${href}: ${itens.join(' › ')}`).toBeGreaterThanOrEqual(2);
    expect(itens[0], href).toBe('Studio');
    await expect(trilha(page).getByRole('link', { name: 'Studio' }), href).toHaveAttribute('href', '/studio');
    await expect(trilha(page).locator('[aria-current="page"]'), href).toHaveCount(1);
  }
  await trilha(page).getByRole('link', { name: 'Studio' }).click();
  await expect(page).toHaveURL(/\/studio$/);
});

test('páginas internas: Studio › Seção › Página, cada nível clicável, e a trilha acompanha a navegação suave (sem recarregar)', async ({ page, context }) => {
  await entrar(context, 'nav1', 'admin');
  await page.goto('/studio/cms');
  await page.evaluate(() => ((window as unknown as { __semRecarga?: number }).__semRecarga = 1));
  expect(await rotulos(page)).toEqual(['Studio', 'CMS editorial']);
  await page.getByRole('link', { name: 'Nova matéria' }).first().click(); // navegação do próprio Next, sem recarregar a página
  await expect(page).toHaveURL(/\/studio\/cms\/nova$/);
  await expect.poll(() => rotulos(page)).toEqual(['Studio', 'CMS editorial', 'Nova matéria']);
  expect(await page.evaluate(() => (window as unknown as { __semRecarga?: number }).__semRecarga)).toBe(1);
  await trilha(page).getByRole('link', { name: 'CMS editorial' }).click();
  await expect(page).toHaveURL(/\/studio\/cms$/);

  await page.goto('/studio/fontes/fabrica');
  expect(await rotulos(page)).toEqual(['Studio', 'Banco de fontes', 'Fontes da Fábrica']);
  await trilha(page).getByRole('link', { name: 'Banco de fontes' }).click();
  await expect(page).toHaveURL(/\/studio\/fontes$/);

  // página de detalhe (matéria): o identificador não aparece na trilha
  await page.goto('/studio/cms/nova');
  await page.getByLabel('Título', { exact: true }).fill('Matéria para a trilha de navegação');
  await page.getByLabel(/Resumo/).fill('Resumo curto da matéria da trilha de navegação.');
  await page.getByLabel('Editoria', { exact: true }).selectOption('bancos');
  await page.getByLabel('Corpo da matéria').fill('Texto completo da matéria da trilha de navegação.');
  await enviar(page, page.getByRole('button', { name: 'Criar rascunho' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Matéria para a trilha de navegação' })).toBeVisible();
  const detalhe = await rotulos(page);
  expect(detalhe).toEqual(['Studio', 'CMS editorial', 'Matéria']);
  expect(detalhe.join(' ')).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
});

test('papel limitado vê só os atalhos do que acessa (comercial não tem "Nova matéria")', async ({ page, context }) => {
  await entrar(context, 'nav2', 'comercial');
  await page.goto('/studio');
  await expect(page.locator('[data-atalhos] a').filter({ hasText: 'Nova matéria' })).toHaveCount(0);
  await expect(page.locator('[data-atalhos] a').filter({ hasText: 'Fontes da Fábrica' })).toHaveCount(0);
  await expect(page.locator('[data-atalhos] a').filter({ hasText: 'Minha conta' })).toBeVisible();
  await page.goto('/studio/crm');
  expect(await rotulos(page)).toEqual(['Studio', 'CRM']);
});

test('acessibilidade e celular: uma só trilha com nome, axe sem violação, alvo de toque de 44 px e sem rolagem horizontal', async ({ page, context }) => {
  await entrar(context, 'nav1', 'admin');
  await page.setViewportSize({ width: 390, height: 800 });
  for (const rota of ['/studio', '/studio/cms/nova', '/studio/fontes/fabrica']) {
    await page.goto(rota);
    await expect(trilha(page)).toHaveCount(1);
    const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ax.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 2).join(' | ')}`), rota).toEqual([]);
    const pequenos = await trilha(page).locator('a').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height).filter((h) => h < 43.5));
    expect(pequenos, `${rota}: links da trilha abaixo de 44 px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${rota} rola na horizontal`).toBe(true);
  }
});
