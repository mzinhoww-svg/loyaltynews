import { expect, test, type Locator } from '@playwright/test';

/**
 * P2-4 e P2-5 da revisão visual int/012 (UI/UX). Mobile: alvos de toque de pelo menos 44 px na página 404 e no link de fonte do evento;
 * breadcrumb com o separador "/" no fim do item anterior (nunca sozinho no começo da linha seguinte).
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const MIN = 44;

async function menoresQue44(alvos: Locator): Promise<string[]> {
  const ruins: string[] = [];
  for (const el of await alvos.all()) {
    const box = await el.boundingBox();
    const nome = ((await el.innerText()).trim() || '?').slice(0, 40);
    if (!box || box.height < MIN - 0.5 || box.width < MIN - 0.5) ruins.push(`${nome}: ${Math.round(box?.width ?? 0)}×${Math.round(box?.height ?? 0)}`);
  }
  return ruins;
}

test.describe('alvos de toque no mobile (P2-4)', () => {
  test('página 404: "Voltar à página inicial" e "buscar no portal" têm pelo menos 44 px de altura', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile');
    const res = await page.goto('/nao-existe-xyz-404');
    expect(res?.status()).toBe(404);
    const alvos = page.locator('main').getByRole('link', { name: /Voltar à página inicial|buscar no portal/ });
    expect(await alvos.count()).toBe(2);
    expect(await menoresQue44(alvos), 'alvos < 44 px na 404').toEqual([]);
  });

  test('evento: "Fonte da informação" e "← Voltar à agenda" têm pelo menos 44 px de altura', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile' || mode !== 'mock', 'somente no mobile e no modo mock (o evento vem da fixture)');
    await page.goto('/agenda/mock-evento-1');
    const alvos = page.locator('main').getByRole('link', { name: /Fonte da informação|Voltar à agenda/ });
    expect(await alvos.count()).toBe(2);
    expect(await menoresQue44(alvos), 'alvos < 44 px no evento').toEqual([]);
  });
});

test.describe('breadcrumb sem "/" solto (P2-5)', () => {
  test('o separador é ::after do item anterior; o ::before do DS fica desligado e o último item não tem separador', async ({ page }) => {
    test.skip(mode !== 'mock', 'somente no modo mock (matéria da fixture)');
    await page.goto('/noticia/mock-mercado-1');
    const itens = page.locator('.ln-breadcrumb__item');
    const n = await itens.count();
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) {
      const css = await itens.nth(i).evaluate((e) => ({ antes: getComputedStyle(e, '::before').content, depois: getComputedStyle(e, '::after').content }));
      expect(css.antes, `item ${i}: ::before`).toBe('none');
      if (i < n - 1) expect(css.depois, `item ${i}: ::after`).toBe('"/"');
      else expect(css.depois, 'último item sem separador').toBe('none');
    }
  });

  test('no mobile estreito nenhuma linha do breadcrumb começa com o separador (item que quebra leva o "/" para o fim da linha anterior)', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile' || mode !== 'mock', 'somente no mobile e no modo mock');
    await page.goto('/noticia/mock-mercado-1');
    const itens = page.locator('.ln-breadcrumb__item');
    const n = await itens.count();
    // o último item (título longo) quebra em duas linhas; os anteriores ficam juntos na primeira, cada "/" logo depois do seu texto
    const posicoes = await itens.evaluateAll((els) => els.map((e) => ({ y: Math.round(e.getBoundingClientRect().y), x: Math.round(e.getBoundingClientRect().x) })));
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < n; i++) {
      // um item que começa uma linha nova (y maior que o anterior) começa na margem esquerda do contêiner, sem "/" antes dele
      if (posicoes[i]!.y > posicoes[i - 1]!.y) expect(posicoes[i]!.x, `item ${i} começa linha nova na margem esquerda`).toBeLessThanOrEqual(posicoes[0]!.x + 1);
    }
  });
});
