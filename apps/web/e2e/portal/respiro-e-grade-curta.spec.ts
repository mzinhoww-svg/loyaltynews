import { expect, test } from '@playwright/test';

/**
 * Reauditoria 1548e30: N-01 (breadcrumb da matéria encostado no cabeçalho) e N-04 (grade com colunas vazias quando há poucos itens).
 * Dados MOCK: a editoria tem 2 matérias e a home tem blocos de 1 e 2 itens.
 */
test.skip(process.env.PORTAL_MODE !== 'mock', 'usa os dados MOCK');

test('N-01: o breadcrumb da matéria começa pelo menos 16 px abaixo do cabeçalho, e o selo não encosta nele', async ({ page }) => {
  await page.goto('/noticia/mock-mercado-1');
  const m = await page.evaluate(() => {
    const header = document.querySelector('header')!.getBoundingClientRect().bottom;
    const bc = document.querySelector('.ln-breadcrumb')!.getBoundingClientRect();
    const kicker = document.querySelector('.pt-kicker')?.getBoundingClientRect();
    return { gapTopo: bc.top - header, gapKicker: kicker ? kicker.top - bc.bottom : 99 };
  });
  expect(m.gapTopo).toBeGreaterThanOrEqual(16);
  expect(m.gapKicker).toBeGreaterThanOrEqual(8);
});

test('N-04: grade com 1 ou 2 itens usa 1 ou 2 colunas, sem trilhas vazias', async ({ page }) => {
  for (const url of ['/editoria/bancos', '/']) {
    await page.goto(url);
    const grades = await page.evaluate(() =>
      [...document.querySelectorAll('.pt-grid')].map((g) => ({ itens: g.children.length, colunas: getComputedStyle(g).gridTemplateColumns.split(' ').length })),
    );
    expect(grades.length).toBeGreaterThan(0);
    for (const g of grades) if (g.itens <= 2) expect(g.colunas, `grade de ${g.itens} item(ns) em ${g.colunas} coluna(s)`).toBeLessThanOrEqual(g.itens);
  }
});
