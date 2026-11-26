import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrar } from './helpers';

// Refino do lançamento, pacote C, item 1 (casca): menu lateral com grupos recolhíveis, item ativo claro e selo "desligado nesta fase" como StatusPill.
const menu = (page: Page) => page.getByRole('navigation', { name: 'Módulos do Studio' });
const grupo = (page: Page, titulo: string) => menu(page).locator(`[data-grupo-menu="${titulo}"]`);

test('os grupos do menu são recolhíveis: só o grupo da tela atual abre sozinho, e cada grupo abre e fecha por botão', async ({ page, context }) => {
  await entrar(context, 'casca1', 'admin');
  await page.goto('/studio/cms');
  const editorial = grupo(page, 'Editorial');
  const inteligencia = grupo(page, 'Intelligence');
  await expect(editorial.getByRole('button', { name: /Editorial/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(editorial.getByRole('link', { name: 'CMS editorial' })).toBeVisible();
  await expect(inteligencia.getByRole('button', { name: /Intelligence/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(inteligencia.getByRole('link', { name: 'Watchlists' })).toBeHidden();

  const botao = inteligencia.getByRole('button', { name: /Intelligence/ });
  await botao.click();
  await expect(botao).toHaveAttribute('aria-expanded', 'true');
  await expect(inteligencia.getByRole('link', { name: 'Watchlists' })).toBeVisible();
  // pelo teclado (Enter/Espaço no botão)
  await botao.focus();
  await page.keyboard.press('Enter');
  await expect(botao).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Space');
  await expect(botao).toHaveAttribute('aria-expanded', 'true');
  // o número de itens aparece no grupo (e é só decoração: fora do nome acessível)
  await expect(botao).toContainText(/\d+/);
});

test('o que a pessoa abriu continua aberto ao navegar, e chegar a uma tela abre o grupo dela', async ({ page, context }) => {
  await entrar(context, 'casca1', 'admin');
  await page.goto('/studio/cms');
  await page.evaluate(() => ((window as unknown as { __semRecarga?: number }).__semRecarga = 1));
  await grupo(page, 'Intelligence').getByRole('button', { name: /Intelligence/ }).click();
  await menu(page).getByRole('link', { name: 'Banco de fontes' }).click(); // navegação do Next: o menu não remonta
  await expect(page).toHaveURL(/\/studio\/fontes$/);
  await expect(grupo(page, 'Intelligence').getByRole('button', { name: /Intelligence/ })).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => (window as unknown as { __semRecarga?: number }).__semRecarga)).toBe(1);
  // uma tela de outro grupo (CRM, pela barra de endereço da navegação suave: migalha/atalho) abre o grupo dela
  await page.goto('/studio/crm');
  await expect(grupo(page, 'Comercial').getByRole('button', { name: /Comercial/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(grupo(page, 'Comercial').getByRole('link', { name: 'CRM' })).toHaveAttribute('aria-current', 'page');
});

test('o item ativo é claro (fundo branco, texto da cor primária) e se distingue dos outros', async ({ page, context }) => {
  await entrar(context, 'casca1', 'admin');
  await page.goto('/studio/cms');
  const ativo = menu(page).getByRole('link', { name: 'CMS editorial' });
  await expect(ativo).toHaveAttribute('aria-current', 'page');
  const outro = menu(page).getByRole('link', { name: 'Banco de fontes' });
  const cores = async (l: typeof ativo) => l.evaluate((el) => ({ fundo: getComputedStyle(el).backgroundColor, texto: getComputedStyle(el).color }));
  const a = await cores(ativo);
  const o = await cores(outro);
  expect(a.fundo).toBe('rgb(255, 255, 255)');
  expect(a.texto, 'texto do item ativo na cor primária').not.toBe('rgb(255, 255, 255)');
  expect(a).not.toEqual(o);
});

test('o foco do menu é visível sobre o fundo escuro (anel branco) e a ordem de foco segue a do menu', async ({ page, context }) => {
  await entrar(context, 'casca1', 'admin');
  await page.goto('/studio/cms');
  const botao = grupo(page, 'Intelligence').getByRole('button', { name: /Intelligence/ });
  await botao.focus();
  expect(await botao.evaluate((el) => getComputedStyle(el).outlineColor)).toBe('rgb(255, 255, 255)');
  expect(await botao.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThan(1);
  // ordem: Visão geral → botões e links na ordem do menu
  const ordem = await menu(page).locator('a, button').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.textContent!.trim().replace(/\s+/g, ' ')));
  expect(ordem[0]).toContain('Visão geral');
  expect(ordem.findIndex((t) => t.startsWith('Editorial'))).toBeLessThan(ordem.findIndex((t) => t.startsWith('Distribuição')));
});

test('o selo "desligado nesta fase" é um StatusPill neutro (glifo + texto), não só cor nem parênteses', async ({ page, context }) => {
  await entrar(context, 'casca1', 'admin');
  await page.goto('/studio');
  const social = grupo(page, 'Distribuição e Growth');
  await social.getByRole('button', { name: /Distribuição e Growth/ }).click();
  const pill = social.locator('.ln-pill--neutral').filter({ hasText: 'Desligado nesta fase' }).first();
  await expect(pill).toBeVisible();
  await expect(pill.locator('.ln-pill__glyph')).toHaveAttribute('aria-hidden', 'true');
  await expect(menu(page)).not.toContainText('(desligado nesta fase)');
  // as cores vêm dos tokens neutros do design system
  const par = await pill.evaluate((el) => {
    const raiz = getComputedStyle(document.documentElement);
    const cs = getComputedStyle(el);
    const probe = (v: string) => {
      const t = document.createElement('span');
      t.style.color = `var(${v})`;
      document.body.appendChild(t);
      const c = getComputedStyle(t).color;
      t.remove();
      return c;
    };
    return { fundo: cs.backgroundColor, texto: cs.color, tokenFundo: probe('--ln-color-neutral-bg'), tokenTexto: probe('--ln-color-neutral-fg'), definido: raiz.getPropertyValue('--ln-color-neutral-bg').trim() !== '' };
  });
  expect(par.fundo).toBe(par.tokenFundo);
  expect(par.texto).toBe(par.tokenTexto);
});

test('celular (390 px): o menu abre e fecha, os grupos recolhem, os alvos têm 44 px, axe limpo e sem rolagem horizontal', async ({ page, context }) => {
  await entrar(context, 'casca1', 'admin');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/studio/cms');
  await expect(menu(page)).toBeHidden();
  await page.getByRole('button', { name: 'Navegação' }).click();
  await expect(menu(page)).toBeVisible();
  const botao = grupo(page, 'Intelligence').getByRole('button', { name: /Intelligence/ });
  await botao.click();
  await expect(grupo(page, 'Intelligence').getByRole('link', { name: 'Watchlists' })).toBeVisible();
  const pequenos = await menu(page).locator('a, button').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getBoundingClientRect().height).filter((h) => h < 43.5));
  expect(pequenos, 'alvos do menu abaixo de 44 px').toEqual([]);
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(ax.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 2).join(' | ')}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Navegação' })).toBeFocused();
});

test('desktop (1280 px): axe limpo com o menu aberto e sem rolagem horizontal', async ({ page, context }) => {
  await entrar(context, 'casca1', 'admin');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/studio');
  await page.getByRole('navigation', { name: 'Módulos do Studio' }).locator('button[aria-expanded="false"]').first().click();
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(ax.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 2).join(' | ')}`)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
