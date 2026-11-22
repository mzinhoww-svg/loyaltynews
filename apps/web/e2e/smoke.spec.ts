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

test('api/health responde ok com version e env, sem expor flags', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.ok()).toBe(true);
  const body = await r.json();
  expect(body).toMatchObject({ status: 'ok', service: 'loyaltynews-web' });
  expect(typeof body.version).toBe('string');
  expect(typeof body.env).toBe('string');
  expect(body).not.toHaveProperty('flagsLigadas');
});
