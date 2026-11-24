import { devices, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { totp } from './totp';

// Bug do staging (int/024): logado em /studio/fontes/fabrica, ao ir para /studio a pessoa foi mandada para a entrada. Cenário relatado: a senha foi
// trocada pela /studio/conta minutos antes, a MESMA conta estava aberta em outro navegador (automação) e o acesso era pelo celular.
// Estes testes reproduzem o cenário com o Better Auth real (backend de e2e) e exigem que a sessão continue em toda a navegação.
test.describe.configure({ mode: 'serial' });

interface Conta {
  email: string;
  senha: string;
  segredo: string | null;
}

async function novaConta(context: BrowserContext, chave: string): Promise<Conta> {
  const r = await context.request.get(`/api/e2e/login?conta=${chave}&role=admin&totp=1`);
  expect(r.ok(), `conta de teste ${chave}: ${r.status()}`).toBe(true);
  return (await r.json()) as Conta;
}

let ipSeq = 0;
async function ipPorRequisicao(page: Page) {
  // o limitador do Better Auth conta por IP; cada requisição de auth leva um IP distinto (como em studio-login)
  await page.route('**/api/auth/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': `10.${Math.floor(++ipSeq / 250) + 150}.${ipSeq % 250}.9` } }));
}

async function entrarPelaTela(page: Page, conta: Conta, senha: string, destino: string) {
  await page.goto(destino);
  await expect(page).toHaveURL(/\/studio\/entrar\?motivo=NO_SESSION/);
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  await page.getByLabel('E-mail').fill(conta.email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Código do aplicativo autenticador').fill(totp(conta.segredo!));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => u.pathname === destino);
}

async function novoNavegador(browser: Browser, baseURL: string, celular = false) {
  const ctx = await browser.newContext({ baseURL, ...(celular ? devices['Pixel 7'] : {}) });
  const page = await ctx.newPage();
  await ipPorRequisicao(page);
  return { ctx, page };
}

/** Navega fontes/fábrica → /studio pelo link "Visão geral" (navegação suave), por recarga e por endereço digitado; a sessão não pode cair. */
async function navegaSemCair(page: Page, celular: boolean) {
  await page.goto('/studio/fontes/fabrica');
  await expect(page).toHaveURL(/\/studio\/fontes\/fabrica/);
  if (celular) {
    // no celular o menu fica recolhido; vai pelo endereço
    await page.goto('/studio');
  } else {
    await page.getByRole('link', { name: 'Visão geral' }).click();
  }
  await page.waitForURL((u) => u.pathname === '/studio' || u.pathname === '/studio/entrar');
  expect(new URL(page.url()).pathname, 'fontes/fábrica → /studio mandou para a entrada').toBe('/studio');
  await expect(page.getByRole('heading', { level: 1, name: 'LN Studio' })).toBeVisible();
  await page.reload();
  expect(new URL(page.url()).pathname).toBe('/studio');
  const r = await page.request.get('/studio');
  expect(r.headers()['cache-control']).toContain('no-store');
}

for (const celular of [false, true]) {
  test(`${celular ? 'celular' : 'desktop'}: troca de senha, depois a mesma conta entra em OUTRO navegador; fontes/fábrica → /studio não desloga ninguém`, async ({ browser, baseURL }) => {
    const dono = await novoNavegador(browser, baseURL!, celular);
    const conta = await novaConta(dono.ctx, `sessao-nav-${celular ? 'cel' : 'desk'}`);
    const nova = 'senha-trocada-no-e2e-123';

    // 1) o dono entra e troca a senha pela /studio/conta (revoga as outras sessões; a dele continua com o cookie novo)
    await entrarPelaTela(dono.page, conta, conta.senha, '/studio/conta');
    await dono.page.getByLabel('Senha atual').fill(conta.senha);
    await dono.page.getByLabel('Nova senha', { exact: true }).fill(nova);
    await dono.page.getByLabel('Confirme a nova senha').fill(nova);
    await dono.page.getByRole('button', { name: 'Trocar senha' }).click();
    await expect(dono.page.locator('[data-senha-aviso="ok"]')).toBeVisible();

    // 2) a automação entra com a MESMA conta em outro navegador (2ª sessão) e navega
    const automacao = await novoNavegador(browser, baseURL!);
    await entrarPelaTela(automacao.page, conta, nova, '/studio/fontes/fabrica');
    await automacao.page.goto('/studio');
    await expect(automacao.page).toHaveURL(/\/studio$/);

    // 3) o dono navega fontes/fábrica → /studio: continua dentro (e a automação também)
    await navegaSemCair(dono.page, celular);
    await navegaSemCair(automacao.page, false);

    await automacao.ctx.close();
    await dono.ctx.close();
  });
}
