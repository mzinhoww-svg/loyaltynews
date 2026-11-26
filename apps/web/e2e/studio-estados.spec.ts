import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrar } from './helpers';

// Refino do lançamento, pacote C, item 5: estados vazio, indisponível e erro com o EmptyState do design system (role certo, título honesto, sem caixa improvisada).

const caixa = (page: Page) => page.locator('main .ln-empty');

test('estado vazio: EmptyState com título, texto e status (role=status), sem a caixa improvisada antiga', async ({ page, context }) => {
  await entrar(context, 'est1', 'admin');
  // buscas que nunca acham nada: o estado vazio aparece mesmo com dados no banco (os specs partilham o mesmo banco)
  const nada = 'zzz-nao-existe-estado-vazio';
  const telas: [string, RegExp][] = [
    [`/studio/cms?q=${nada}`, /Nenhuma matéria com esses filtros/],
    [`/studio/fontes/fabrica?q=${nada}`, /Nenhuma fonte encontrada/],
    [`/studio/midia?vencendo=1`, /Nenhum ativo com esses filtros/],
    [`/studio/entidades?q=${nada}`, /Nenhum resultado/],
  ];
  for (const [rota, titulo] of telas) {
    await page.goto(rota);
    const vazio = caixa(page).filter({ hasText: titulo }).first();
    await expect(vazio, rota).toBeVisible();
    await expect(vazio, rota).toHaveAttribute('role', 'status');
    await expect(vazio.getByRole('heading', { name: titulo }), rota).toBeVisible();
    await expect(page.locator('main .st-empty'), `${rota}: caixa antiga`).toHaveCount(0);
  }
});

test('o vazio da lista do CMS tem a ação "Criar a primeira matéria" só para quem edita, e o de filtro não', async ({ page, context }) => {
  await entrar(context, 'est1', 'admin');
  await page.goto('/studio/cms?status=bloqueado');
  const filtro = caixa(page).filter({ hasText: 'Nenhuma matéria com esses filtros' });
  await expect(filtro).toBeVisible();
  await expect(filtro.getByRole('link', { name: 'Criar a primeira matéria' })).toHaveCount(0);
});

test('módulo sem backend: EmptyState "indisponível" e o escopo previsto logo abaixo', async ({ page, context }) => {
  await entrar(context, 'est1', 'admin');
  await page.goto('/studio/analytics');
  const vazio = caixa(page).filter({ hasText: 'Nenhum dado disponível' });
  await expect(vazio).toBeVisible();
  await expect(vazio.getByRole('heading', { name: 'Nenhum dado disponível' })).toBeVisible();
  await expect(vazio).toHaveClass(/ln-empty--unavailable/);
  await expect(page.getByRole('heading', { name: 'Escopo previsto (Blueprint §5)' })).toBeVisible();
  await expect(page.locator('main li').first()).toBeVisible();
});

test('erro e vazio passam no axe a 390 e 1280 px, sem rolagem horizontal', async ({ page, context }) => {
  await entrar(context, 'est1', 'admin');
  for (const largura of [390, 1280]) {
    await page.setViewportSize({ width: largura, height: 800 });
    for (const rota of ['/studio/cms?q=zzz-nao-existe', '/studio/fontes/fabrica?q=zzz-nao-existe', '/studio/midia?vencendo=1', '/studio/analytics']) {
      await page.goto(rota);
      await expect(caixa(page).first(), `${rota} @${largura}`).toBeVisible();
      const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(ax.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 2).join(' | ')}`), `${rota} @${largura}`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${rota} @${largura} rola na horizontal`).toBe(true);
    }
  }
});

test('o erro de carga usa EmptyState de erro (role=alert) com o motivo do Backend', async ({ page, context }) => {
  await entrar(context, 'est1', 'admin');
  // filtro inválido na URL faz o Backend recusar a lista de matérias; a tela mostra a recusa como alerta, com o motivo
  await page.goto('/studio/cms?status=estado-que-nao-existe');
  const alerta = page.locator('main [role="alert"]').first();
  await expect(alerta).toBeVisible();
  await expect(alerta).toContainText(/inválid/i);
});
