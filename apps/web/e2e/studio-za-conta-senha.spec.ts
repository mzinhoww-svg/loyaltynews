import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { totp } from './totp';

// Minha conta (/studio/conta): o usuário logado troca a própria senha pelo Better Auth real (backend de e2e em PGlite). Contas de teste
// nascem na hora com senha e segredo TOTP conhecidos (rota só do build de e2e). Login sempre pela tela de entrada, como uma pessoa.
test.describe.configure({ mode: 'serial' });

interface Conta {
  email: string;
  senha: string;
  segredo: string | null;
}

const NOVA = 'nova-senha-do-e2e-12345';

async function novaConta(context: BrowserContext, chave: string): Promise<Conta> {
  const r = await context.request.get(`/api/e2e/login?conta=${chave}&role=editor&totp=1`);
  expect(r.ok(), `conta de teste ${chave}: ${r.status()}`).toBe(true);
  return (await r.json()) as Conta;
}

// O limitador próprio do Better Auth conta por IP e os testes saem do mesmo IP: cada requisição de auth leva um IP distinto (como em studio-login).
let ipSeq = 0;
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': `10.${Math.floor(++ipSeq / 250) + 101}.${ipSeq % 250}.9` } }));
});

/** Entrada pela tela: e-mail, senha e código do autenticador; espera chegar ao destino. */
async function entrarPelaTela(page: Page, email: string, senha: string, segredo: string, destino = '/studio/conta'): Promise<void> {
  await page.goto(destino);
  await expect(page).toHaveURL(/\/studio\/entrar\?motivo=NO_SESSION/);
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Código do aplicativo autenticador').fill(totp(segredo));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => u.pathname === destino);
}

async function trocar(page: Page, atual: string, nova: string, confirmacao = nova) {
  await page.getByLabel('Senha atual').fill(atual);
  await page.getByLabel('Nova senha', { exact: true }).fill(nova);
  await page.getByLabel('Confirme a nova senha').fill(confirmacao);
  await page.getByRole('button', { name: 'Trocar senha' }).click();
}

test('sem sessão: /studio/conta volta para a entrada, com o destino pedido', async ({ page }) => {
  await page.goto('/studio/conta');
  await expect(page).toHaveURL(/\/studio\/entrar\?motivo=NO_SESSION&retorno=%2Fstudio%2Fconta/);
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeVisible();
  // a rota da API também nega sem sessão
  const r = await page.request.post('/api/studio/conta/senha', { data: { senhaAtual: 'x', novaSenha: NOVA, confirmacao: NOVA }, headers: { origin: new URL(page.url()).origin } });
  expect(r.status()).toBe(401);
});

test('troca com sucesso: link no cabeçalho, senha nova grava, outra sessão cai, antiga recusada e login com a nova', async ({ page, context, browser }) => {
  const conta = await novaConta(context, 'troca-ok');
  await entrarPelaTela(page, conta.email, conta.senha, conta.segredo!, '/studio');
  // outro "aparelho" com sessão aberta
  const outro = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const outraPagina = await outro.newPage();
  await outraPagina.route('**/api/auth/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': `10.250.${++ipSeq % 250}.3` } }));
  await entrarPelaTela(outraPagina, conta.email, conta.senha, conta.segredo!);

  const consoles: string[] = [];
  page.on('console', (m) => consoles.push(m.text()));
  await page.locator('header.st-top').getByRole('link', { name: 'Minha conta' }).click();
  await page.waitForURL(/\/studio\/conta$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
  await expect(page.getByLabel('Senha atual')).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.getByLabel('Nova senha', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(ax.violations.map((v) => v.id), 'axe em /studio/conta').toEqual([]);

  await trocar(page, conta.senha, NOVA);
  await expect(page.locator('[data-senha-aviso="ok"]')).toHaveText('Senha trocada. As outras sessões foram encerradas.');
  for (const campo of ['Senha atual', 'Confirme a nova senha']) await expect(page.getByLabel(campo)).toHaveValue('');
  expect(consoles.join('\n') + page.url()).not.toContain(NOVA);
  // quem trocou continua dentro
  await page.goto('/studio');
  await expect(page).toHaveURL(/\/studio$/);
  // a outra sessão foi encerrada
  await outraPagina.goto('/studio');
  await expect(outraPagina).toHaveURL(/\/studio\/entrar\?motivo=NO_SESSION/);
  await outro.close();

  // sai e tenta entrar: a senha antiga é recusada, a nova entra
  await context.clearCookies();
  await page.goto('/studio/conta');
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  await page.getByLabel('E-mail').fill(conta.email);
  await page.getByLabel('Senha').fill(conta.senha);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.locator('[data-login-erro]')).toHaveText('E-mail ou senha incorretos.');
  await entrarPelaTela(page, conta.email, NOVA, conta.segredo!);
  await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
});

test('senha atual errada: recusada em pt-BR e a senha continua a mesma', async ({ page, context }) => {
  const conta = await novaConta(context, 'troca-errada');
  await entrarPelaTela(page, conta.email, conta.senha, conta.segredo!);
  await trocar(page, 'senha-atual-errada-999', NOVA);
  await expect(page.locator('[data-senha-aviso="err"]')).toHaveText('A senha atual está incorreta.');
  // política na tela: curta e igual à atual
  await trocar(page, conta.senha, 'curta');
  await expect(page.locator('[data-senha-aviso="err"]')).toContainText('pelo menos 12 caracteres');
  await trocar(page, conta.senha, conta.senha);
  await expect(page.locator('[data-senha-aviso="err"]')).toContainText('diferente da atual');
  // a senha não mudou: entra de novo com a original
  await context.clearCookies();
  await entrarPelaTela(page, conta.email, conta.senha, conta.segredo!);
});

test('Configurações (admin) tem o link para trocar a senha', async ({ page, context }) => {
  const r = await context.request.get('/api/e2e/login?user=conta-admin&role=admin&mfa=1');
  expect(r.ok()).toBe(true);
  await page.goto('/studio/configuracoes');
  await page.getByRole('link', { name: 'Trocar a minha senha' }).click();
  await page.waitForURL(/\/studio\/conta$/);
  await expect(page.getByRole('heading', { name: 'Trocar senha' })).toBeVisible();
});
