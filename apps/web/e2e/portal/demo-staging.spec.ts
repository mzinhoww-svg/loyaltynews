import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Estado honesto do portal (G1/G2): em staging com fonte api + seed a faixa de demonstração
 * aparece em toda página e /noticias declara que é demonstração; em produção, nada disso.
 * Também mede o CLS da faixa e roda axe (serious/critical = 0) em 390 e 1280.
 */
const appEnv = process.env.PORTAL_APP_ENV ?? 'production';
const mode = process.env.PORTAL_MODE ?? 'empty';
const staging = appEnv === 'staging';
const ROTAS = ['/', '/noticias'];
const LARGURAS = [390, 1280];

test.describe(`estado honesto (${appEnv}, ${mode})`, () => {
  test.skip(staging && mode !== 'api', 'staging do aceite roda com fonte api + seed');

  for (const rota of ROTAS) {
    for (const largura of LARGURAS) {
      test(`${rota} @${largura}: ${staging ? '1 faixa e aviso' : 'sem faixa'} e CLS <= 0,1`, async ({ page }) => {
        await page.setViewportSize({ width: largura, height: 900 });
        await page.addInitScript(() => {
          (window as unknown as { __clsDemo: number }).__clsDemo = 0;
          new PerformanceObserver((lista) => {
            for (const e of lista.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
              if (!e.hadRecentInput) (window as unknown as { __clsDemo: number }).__clsDemo += e.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
        });
        await page.goto(rota);
        await page.waitForLoadState('networkidle');

        const faixa = page.getByTestId('demo-banner');
        await expect(faixa, rota).toHaveCount(staging ? 1 : 0);
        if (staging) await expect(faixa).toContainText('Conteúdo de demonstração');

        if (rota === '/noticias') {
          const principal = page.locator('main');
          if (staging) await expect(principal).toContainText('não é o arquivo publicado');
          else {
            await expect(principal).toContainText('Tudo o que foi publicado');
            await expect(principal).not.toContainText('não é o arquivo publicado');
          }
        }

        await page.waitForTimeout(2500);
        const cls = await page.evaluate(() => (window as unknown as { __clsDemo: number }).__clsDemo);
        console.log(`CLS ${rota} @${largura} (${appEnv}) = ${cls.toFixed(4)}`);
        if (staging) {
          // A faixa é server-rendered: ela não pode se mover nem empurrar o layout depois do primeiro desenho.
          const topo = await faixa.evaluate((el) => el.getBoundingClientRect().top);
          await page.waitForTimeout(500);
          const topoDepois = await faixa.evaluate((el) => el.getBoundingClientRect().top);
          expect(Math.abs(topoDepois - topo), `${rota} @${largura}: posição da faixa`).toBeLessThanOrEqual(0.1);
          expect(cls, `${rota} @${largura}: CLS da página com a faixa`).toBeLessThanOrEqual(0.1);
        }
      });
    }
  }

  test('axe sem serious/critical em 390 e 1280', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'varredura única; as larguras são trocadas no teste');
    test.slow();
    for (const largura of LARGURAS) {
      await page.setViewportSize({ width: largura, height: 900 });
      for (const rota of ROTAS) {
        await page.goto(rota);
        await page.waitForLoadState('networkidle');
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`), `${rota} @${largura}`).toEqual([]);
      }
    }
  });
});
