import { expect, test } from '@playwright/test';

test('home responde e lista as 10 editorias', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Loyalty News' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Editorias' }).getByRole('listitem')).toHaveCount(10);
});

test('studio responde', async ({ page }) => {
  await page.goto('/studio');
  await expect(page.getByRole('heading', { level: 1, name: 'LN Studio' })).toBeVisible();
});

test('api/health responde ok sem flags ligadas', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.ok()).toBe(true);
  expect(await r.json()).toMatchObject({ status: 'ok', flagsLigadas: [] });
});
