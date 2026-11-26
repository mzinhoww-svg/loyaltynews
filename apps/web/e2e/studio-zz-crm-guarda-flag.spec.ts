import { expect, test, type BrowserContext } from '@playwright/test';
import { api, entrar, enviar } from './helpers';

/**
 * Guarda do registro manual de lead (CRM do Studio) contra a flag do formulário público (`portalFormularios`).
 *
 * O CRM chegou a gravar pela rota PÚBLICA do mídia kit: com a flag desligada a tela respondia "Rota inexistente" e, com ela
 * ligada (modo padrão do e2e, APP_ENV=production), tudo parecia funcionar. Por isso este spec exige, em qualquer estado da flag:
 *   1. o registro pelo Studio funciona; 2. fica na trilha com a identidade de quem registrou (só a rota de Studio audita);
 *   3. a rota pública e o formulário do portal seguem a flag.
 * Rodar nos dois estados: `node scripts/e2e.mjs studio-zz-crm-guarda-flag` e o mesmo com APP_ENV=staging.
 * Nome "zz": roda depois dos specs que exigem o CRM vazio.
 */
const ACAO = 'comercial.studio.leads';

async function trilha(context: BrowserContext) {
  await entrar(context, 'guarda-admin', 'admin');
  const r = await api(context, 'GET', `/api/studio/auditoria?action=${ACAO}&limit=200`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as { total: number; data: { action: string; actorId: string | null; actorRole: string | null }[] };
}

test('registro manual de lead funciona e deixa autor na trilha, com o formulário público ligado ou desligado', async ({ page, context, request }) => {
  const antes = (await trilha(context)).total;
  const saude = await (await request.get('/api/health')).json() as { env?: string; flags: string[] };
  const ligada = saude.flags.includes('portalFormularios');
  test.info().annotations.push({ type: 'estado', description: `env=${saude.env} portalFormularios=${ligada ? 'ligada' : 'desligada'}` });
  console.log(`[guarda] env=${saude.env} portalFormularios=${ligada ? 'ligada' : 'desligada'}`);

  const email = `guarda-${Date.now()}@example.invalid`;
  await entrar(context, 'guarda-comercial', 'comercial');
  await page.goto('/studio/crm');
  await page.getByLabel('Nome', { exact: true }).fill('Lead de guarda (MOCK)');
  await page.getByLabel('Empresa').fill('Empresa de guarda (MOCK)');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Objetivo').fill('Teste de guarda');
  await enviar(page, page.getByRole('button', { name: 'Registrar lead' }));
  await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Lead registrado' }).first()).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(email) })).toBeVisible();

  const depois = await trilha(context);
  expect(depois.total, 'o registro manual precisa aparecer na trilha de auditoria').toBe(antes + 1);
  expect(depois.data[0]).toMatchObject({ action: ACAO, actorRole: 'comercial' });
  expect(depois.data[0]!.actorId).toBeTruthy();

  // A rota pública segue a flag. Corpo vazio de propósito: nada é gravado em nenhum dos estados.
  await context.clearCookies();
  expect((await context.request.post('/api/commercial/leads', { data: {} })).status()).toBe(ligada ? 400 : 404);
  await page.goto('/midia-kit');
  await expect(page.getByTestId('mk-cta-primary')).toBeVisible();
  await expect(page.getByTestId('proposta-form')).toHaveCount(ligada ? 1 : 0);
});
