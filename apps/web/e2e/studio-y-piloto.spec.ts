import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { api, entrar } from './helpers';

// Leitura do piloto (Studio 2; PM-2026-11-23-C). Hoje as rotas /api/studio/editorial/piloto (Editorial + Backend 1) não existem e o piloto não rodou:
// a tela tem de dizer isso, sem inventar matéria, e sem botão de publicar. O caminho com dados entra quando as rotas existirem.
test('estado honesto: piloto ainda não executado, critério visível, sem publicar; axe', async ({ page, context }) => {
  await entrar(context, 'pil-chefe', 'editor_chefe');
  expect((await api(context, 'GET', '/api/studio/editorial/piloto')).status).toBe(404); // a rota ainda não existe
  await page.goto('/studio/piloto');
  await expect(page.getByRole('heading', { level: 1, name: 'Leitura do piloto' })).toBeVisible();
  await expect(page.locator('[data-estado="piloto-nao-executado"]')).toContainText('Piloto ainda não executado');
  await expect(page.locator('[data-aviso="criterio"]')).toContainText('0 fato de gravidade alta');
  await expect(page.getByRole('button', { name: /publicar/i })).toHaveCount(0);
  await expect(page.locator('[data-materia]')).toHaveCount(0); // nenhuma matéria inventada
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  await page.goto('/studio/piloto/a4');
  await expect(page.locator('[data-estado="piloto-nao-executado"]')).toContainText('não há rascunho ligado a a4');
  expect((await page.goto('/studio/piloto/a11'))?.status()).toBe(404);
});

test('RBAC: só o leitor 1 (admin ou editor-chefe); editor e revisor não entram', async ({ page, context }) => {
  for (const [u, papel] of [['pil-ed', 'editor'], ['pil-rev', 'revisor']] as const) {
    await entrar(context, u, papel);
    await page.goto('/studio/piloto');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  }
  await entrar(context, 'pil-adm', 'admin');
  await page.goto('/studio/piloto');
  await expect(page.getByRole('heading', { level: 1, name: 'Leitura do piloto' })).toBeVisible();
});
