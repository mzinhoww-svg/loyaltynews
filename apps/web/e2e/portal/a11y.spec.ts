import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Acessibilidade (axe, WCAG 2.0/2.1 A e AA, incluindo contraste) em desktop e mobile, nos dois modos de dados. */
const PAGES = [
  '/', '/contato', '/midia-kit', '/noticias', '/editoria/bancos', '/busca', '/busca?q=bancos', '/agenda', '/em-alta',
  '/moves', '/intelligence', '/intelligence/empresas', '/sobre', '/metodologia', '/privacidade', '/the-loyal',
  ...(process.env.PORTAL_MODE === 'mock' ? ['/noticia/mock-mercado-1', '/noticia/mock-mercado-2', '/editoria/mercado'] : []),
];

for (const path of PAGES) {
  test(`axe sem violações em ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`);
    expect(summary, summary.join('\n')).toEqual([]);
  });
}

// Larguras do critério de aceite do polimento: 1280, 768 e 375.
for (const w of [1280, 768, 375]) {
  test(`axe em ${w}px: home, notícias e editoria`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    test.slow(3); // três páginas com axe em sequência: 90 s (carga da máquina; a base ainda não tem o a11y determinístico da ft/portal-a11y-deterministic)
    await page.setViewportSize({ width: w, height: 900 });
    for (const p of ['/', '/noticias', '/editoria/bancos']) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
      expect(summary, `${p} @${w}: ${summary.join(' ; ')}`).toEqual([]);
    }
  });
}

test('home sem título de seção repetido (h2) e sem rolagem horizontal', async ({ page }) => {
  await page.goto('/');
  const heads = (await page.locator('main h2, aside h2').allTextContents()).map((t) => t.trim());
  expect(heads.filter((h, i) => heads.indexOf(h) !== i), `h2 repetidos: ${heads.join(' | ')}`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test('home compacta: altura dentro dos limites do critério de aceite', async ({ page }, info) => {
  await page.goto('/');
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const mock = process.env.PORTAL_MODE === 'mock';
  const limit = info.project.name === 'mobile' ? (mock ? 9000 : 3000) : mock ? 5500 : 1600;
  expect(h, `altura da home: ${h}px (limite ${limit})`).toBeLessThanOrEqual(limit);
});

// Menus abertos também precisam passar no axe (mega-menu no desktop; painel no mobile). Um teste por largura: cada um tem o seu orçamento
// de tempo (carregar + axe), em vez de três larguras em sequência dentro dos 30 s de um só teste.
for (const w of [1280, 768, 375]) {
  test(`axe com o menu aberto @${w} (${w >= 1024 ? 'mega-menu' : 'painel'})`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const btn = page.locator(w >= 1024 ? '.ln-header__menu-btn' : '.ln-header__toggle');
    await expect(async () => {
      if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
      await expect(btn).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
    }).toPass({ timeout: 10_000 });
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
    expect(summary, `menu aberto @${w}: ${summary.join(' ; ')}`).toEqual([]);
  });
}
