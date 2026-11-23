import { expect, test } from '@playwright/test';

test('home responde e lista as 10 editorias', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Loyalty News' })).toBeVisible();
  // A home real pode repetir o menu (cabeçalho e rodapé/mobile): confere as 10 editorias, não a contagem de itens.
  const nav = page.getByRole('navigation', { name: 'Editorias' }).first();
  for (const nome of ['Mercado & Negócios', 'Programas de Fidelidade', 'Pontos & Milhas', 'Bancos & Cartões', 'Varejo & Cashback',
    'Travel & Hospitality', 'LoyaltyTech & IA', 'CRM & CX', 'Global Loyalty', 'Regulação & Dados']) {
    await expect(nav.getByText(nome, { exact: true }).first()).toBeVisible();
  }
});

test('studio nega por padrão sem sessão', async ({ page }) => {
  await page.goto('/studio');
  await expect(page).toHaveURL(/\/studio\/entrar/);
  await expect(page.getByRole('heading', { level: 1, name: 'Acesso restrito' })).toBeVisible();
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
