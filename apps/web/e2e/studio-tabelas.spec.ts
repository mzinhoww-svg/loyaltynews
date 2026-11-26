import { expect, test, type Page } from '@playwright/test';
import { entrar, enviar } from './helpers';

// Refino do lançamento, pacote C, item 2 (tabelas): cabeçalho fixo na rolagem, densidade única e tons de status só com tokens.
// A lista do CMS precisa ter linhas: cria uma matéria e repete a linha no próprio DOM (só para o teste ter altura para rolar).

async function listaComLinhas(page: Page, titulo: string) {
  await page.goto('/studio/cms/nova');
  await page.getByLabel('Título', { exact: true }).fill(titulo);
  await page.getByLabel(/Resumo/).fill('Resumo curto da matéria da tabela do Studio.');
  await page.getByLabel('Editoria', { exact: true }).selectOption('bancos');
  await page.getByLabel('Corpo da matéria').fill('Texto completo da matéria da tabela do Studio.');
  await enviar(page, page.getByRole('button', { name: 'Criar rascunho' }));
  await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible();
  await page.goto('/studio/cms');
  await expect(page.getByRole('link', { name: titulo })).toBeVisible();
  await page.evaluate(() => {
    const corpo = document.querySelector('main table tbody')!;
    const modelo = corpo.querySelector('tr')!;
    for (let i = 0; i < 60; i++) corpo.appendChild(modelo.cloneNode(true));
  });
}

test('desktop: o cabeçalho da tabela fica fixo no topo enquanto a página rola', async ({ page, context }) => {
  await entrar(context, 'tab1', 'admin');
  await page.setViewportSize({ width: 1280, height: 700 });
  await listaComLinhas(page, 'Matéria da tabela com cabeçalho fixo desktop');
  const cab = page.locator('main table thead th').first();
  expect(await cab.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  expect(await page.locator('main table').first().evaluate((el) => getComputedStyle(el).overflow)).not.toBe('hidden');
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(async () => Math.round((await cab.boundingBox())!.y)).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(400); // a página rolou de verdade
});

test('celular (390 px): o cabeçalho fixa DENTRO do quadro de rolagem e a página não rola na horizontal', async ({ page, context }) => {
  await entrar(context, 'tab1', 'admin');
  await page.setViewportSize({ width: 390, height: 700 });
  await listaComLinhas(page, 'Matéria da tabela com cabeçalho fixo celular');
  const quadro = page.locator('main .st-quadro').first();
  expect(await quadro.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
  const topoDoQuadro = (await quadro.boundingBox())!.y;
  await quadro.evaluate((el) => (el.scrollTop = 600));
  const cab = quadro.locator('thead th').first();
  await expect.poll(async () => Math.abs((await cab.boundingBox())!.y - topoDoQuadro)).toBeLessThanOrEqual(2);
  expect(await quadro.evaluate((el) => el.scrollTop)).toBeGreaterThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('densidade única e selos com tokens: células com o mesmo espaçamento, estado com o par -bg/-fg do mesmo tom', async ({ page, context }) => {
  await entrar(context, 'tab1', 'admin');
  await listaComLinhas(page, 'Matéria da tabela para a densidade e os selos');
  const ritmo = async (sel: string) => page.locator(sel).first().evaluate((el) => { const c = getComputedStyle(el); return `${c.paddingTop} ${c.paddingRight}`; });
  // cabeçalho e células de corpo: o mesmo respiro (8 px vertical, 12 px horizontal)
  expect(await ritmo('main table thead th')).toBe('8px 12px');
  expect(await ritmo('main table tbody td')).toBe('8px 12px');
  // cada tom de selo vem do par de tokens: confere com uma sonda que resolve o token no navegador
  const ok = await page.evaluate(() => {
    const sonda = (v: string) => { const t = document.createElement('span'); t.style.color = `var(${v})`; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; };
    const casos: [string, string][] = [['rascunho', 'neutral'], ['em_checagem', 'warning'], ['bloqueado', 'danger'], ['aprovado', 'success'], ['publicado', 'info']];
    return casos.map(([cls, tom]) => {
      const el = document.createElement('span');
      el.className = `st-badge ${cls}`;
      document.querySelector('main')!.appendChild(el);
      const cs = getComputedStyle(el);
      const r = { cls, fundo: cs.backgroundColor === sonda(`--ln-color-${tom}-bg`), texto: cs.color === sonda(`--ln-color-${tom}-fg`) };
      el.remove();
      return r;
    });
  });
  for (const c of ok) {
    expect(c.fundo, `selo ${c.cls}: fundo fora do token`).toBe(true);
    expect(c.texto, `selo ${c.cls}: cor do texto fora do token`).toBe(true);
  }
});
