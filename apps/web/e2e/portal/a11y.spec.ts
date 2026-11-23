import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Acessibilidade (axe, WCAG 2.0/2.1 A e AA, incluindo contraste) em desktop e mobile, nos dois modos de dados. */
const PAGES = [
  '/', '/contato', '/midia-kit', '/noticias', '/editoria/bancos', '/busca', '/busca?q=bancos', '/agenda', '/em-alta',
  '/moves', '/intelligence', '/intelligence/empresas', '/sobre', '/metodologia', '/privacidade', '/the-loyal',
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
