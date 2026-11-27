import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { totp, totpErrado } from './totp';

// Tela de login do Studio (/studio/entrar): e-mail e senha, depois o código do aplicativo autenticador, pelo /api/auth real (Better Auth
// com 2º fator) sobre o backend de e2e. As contas de teste nascem na hora, com senha e segredo TOTP conhecidos (rota só do build de e2e).
test.describe.configure({ mode: 'serial' });

interface Conta {
  email: string;
  senha: string;
  segredo: string | null;
}

async function novaConta(context: BrowserContext, chave: string, totpAtivo = true): Promise<Conta> {
  const r = await context.request.get(`/api/e2e/login?conta=${chave}&role=editor&totp=${totpAtivo ? 1 : 0}`);
  expect(r.ok(), `conta de teste ${chave}: ${r.status()}`).toBe(true);
  return (await r.json()) as Conta;
}

const DESTINO = '/studio/cms?status=aprovado';

async function primeiroPasso(page: Page, email: string, senha: string) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Continuar' }).click();
}

async function abrirEntrada(page: Page, destino = DESTINO) {
  await page.goto(destino);
  await expect(page).toHaveURL(/\/studio\/entrar\?motivo=NO_SESSION/);
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled(); // só vale depois da hidratação
}

// O limite por IP embutido do Better Auth foi DESLIGADO de propósito (advanced.ipAddress.disableIpTracking, README do /api:123); quem limita
// por conta E por IP é o gate do próprio app (packages/auth/src/attempts.ts, 5 tentativas / 15 min, 429 + Retry-After). Como os testes saem
// todos do mesmo IP, cada requisição de auth leva um IP distinto no x-forwarded-for para o caso do limite por CONTA ser o que se testa; o caso
// do gate por IP fixa um IP de propósito.
let ipSeq = 0;
async function ipPorRequisicao(page: Page) {
  await page.route('**/api/auth/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': `10.${Math.floor(++ipSeq / 250) + 1}.${ipSeq % 250}.9` } }));
}
test.beforeEach(async ({ page }) => {
  await ipPorRequisicao(page);
});

test('sem sessão: /studio vai para a entrada com o formulário, leva o destino pedido e passa no axe', async ({ page }) => {
  await abrirEntrada(page);
  await expect(page).toHaveURL(new RegExp(`retorno=${encodeURIComponent(DESTINO).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  await expect(page.getByRole('heading', { level: 1, name: 'Acesso restrito' })).toBeVisible();
  const email = page.getByLabel('E-mail');
  const senha = page.getByLabel('Senha');
  await expect(email).toHaveAttribute('autocomplete', 'username');
  await expect(senha).toHaveAttribute('autocomplete', 'current-password');
  await expect(senha).toHaveAttribute('type', 'password');
  // cadastro público não existe: a entrada não tem "criar conta"
  await expect(page.getByText(/criar conta|cadastre-se|esqueci/i)).toHaveCount(0);
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const resumo = ax.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(resumo, resumo.join('\n')).toEqual([]);
});

test('login completo: e-mail, senha e código; volta ao destino pedido, sem credencial em URL, storage ou console', async ({ page, context }) => {
  const conta = await novaConta(context, 'ok');
  const consoles: string[] = [];
  page.on('console', (m) => consoles.push(m.text()));
  await abrirEntrada(page);
  await primeiroPasso(page, conta.email, conta.senha);

  const codigo = page.getByLabel('Código do aplicativo autenticador');
  await expect(codigo).toBeVisible();
  await expect(codigo).toBeFocused();
  await expect(codigo).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(codigo).toHaveAttribute('inputmode', 'numeric');
  // a senha não fica na tela depois do 1º passo (o campo some) e nada vai para a URL
  expect(page.url()).not.toContain(encodeURIComponent(conta.senha));
  expect(page.url()).not.toContain(conta.senha);
  expect(page.url()).not.toContain(encodeURIComponent(conta.email));
  const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(ax.violations.map((v) => v.id), 'axe no passo do código').toEqual([]);

  await codigo.fill(totp(conta.segredo!));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/studio\/cms\?status=aprovado/);
  await expect(page.getByRole('heading', { level: 1, name: 'CMS editorial' })).toBeVisible();
  await expect(page.getByText(conta.email)).toBeVisible(); // "Sessão: e-mail" no topo do Studio

  const guardado = await page.evaluate(() => ({ local: Object.keys(localStorage), sessao: Object.keys(sessionStorage) }));
  expect(guardado).toEqual({ local: [], sessao: [] });
  const tudo = consoles.join('\n') + page.url();
  expect(tudo).not.toContain(conta.senha);
  expect(tudo).not.toContain(conta.segredo!);
  // com a sessão aberta, a entrada não é mais necessária: /studio abre direto
  await page.goto('/studio');
  await expect(page).toHaveURL(/\/studio$/);
});

test('2º passo começa VAZIO (sem herdar o e-mail) e o código é digitável com o teclado, caractere a caractere', async ({ page, context }) => {
  // Regressão do P2 do QA 9: o React reaproveitava o <input> do e-mail como campo de código, o e-mail digitado ficava
  // no campo novo e o maxLength=7 travava a digitação. O fill() do Playwright escrevia por cima e escondia o defeito,
  // por isso aqui o teclado é de verdade (type, não fill).
  const conta = await novaConta(context, 'codigo-vazio');
  await abrirEntrada(page);
  await primeiroPasso(page, conta.email, conta.senha);

  const codigo = page.getByLabel('Código do aplicativo autenticador');
  await expect(codigo).toBeVisible();
  await expect(codigo).toBeFocused();
  // 1) nada herdado do passo 1
  await expect(codigo).toHaveValue('');
  await expect(codigo).not.toHaveValue(conta.email);
  await expect(codigo).toHaveAttribute('maxlength', '7'); // 6 dígitos + o espaço de "123 456"
  await expect(codigo).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(codigo).toHaveAttribute('inputmode', 'numeric');

  // 2) seis dígitos digitados no teclado chegam inteiros ao campo
  const certo = totp(conta.segredo!);
  await page.keyboard.type(certo, { delay: 20 });
  await expect(codigo).toHaveValue(certo);

  // 3) a recuperação também começa vazia (nem o e-mail nem o código anterior) e aceita o texto todo pelo teclado
  await page.getByRole('button', { name: 'Usar código de recuperação' }).click();
  const rec = page.getByLabel('Código de recuperação');
  await expect(rec).toBeFocused();
  await expect(rec).toHaveValue('');
  await expect(rec).not.toHaveValue(conta.email);
  await page.keyboard.type('codigo-falso-0000', { delay: 10 });
  await expect(rec).toHaveValue('codigo-falso-0000');

  // 4) voltar ao aplicativo autenticador zera de novo e o login completa com o código digitado
  await page.getByRole('button', { name: 'Usar o aplicativo autenticador' }).click();
  const codigoFinal = page.getByLabel('Código do aplicativo autenticador');
  await expect(codigoFinal).toBeFocused();
  await expect(codigoFinal).toHaveValue('');
  await page.keyboard.type(certo, { delay: 20 });
  await expect(codigoFinal).toHaveValue(certo);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/studio\/cms\?status=aprovado/);
  await expect(page.getByRole('heading', { level: 1, name: 'CMS editorial' })).toBeVisible();
});

test('senha errada e e-mail inexistente dão a MESMA mensagem genérica; a senha digitada é apagada', async ({ page, context }) => {
  const conta = await novaConta(context, 'senha-errada');
  await abrirEntrada(page);
  await primeiroPasso(page, conta.email, 'senha-incorreta-123');
  const erro = page.locator('[data-login-erro]');
  await expect(erro).toHaveText('E-mail ou senha incorretos.');
  await expect(page.getByLabel('Senha')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();

  await primeiroPasso(page, 'ninguem-existe@ln.test', 'senha-incorreta-123');
  await expect(erro).toHaveText('E-mail ou senha incorretos.'); // igual: não revela se a conta existe
  await expect(erro).not.toContainText(/existe|cadastrad|não encontrad/i);
  await expect(page.getByLabel('Código do aplicativo autenticador')).toHaveCount(0);

  await primeiroPasso(page, '', '');
  await expect(erro).toHaveText('Informe o e-mail e a senha.');
});

test('código do autenticador errado: erro claro, continua no passo, e o código certo entra; recuperação e voltar disponíveis', async ({ page, context }) => {
  const conta = await novaConta(context, 'codigo-errado');
  await abrirEntrada(page);
  await primeiroPasso(page, conta.email, conta.senha);
  const codigo = page.getByLabel('Código do aplicativo autenticador');
  await codigo.fill(totpErrado(conta.segredo!));
  await page.getByRole('button', { name: 'Entrar' }).click();
  const erro = page.locator('[data-login-erro]');
  await expect(erro).toContainText('Código inválido ou expirado');
  await expect(codigo).toHaveValue('');
  await expect(page).toHaveURL(/\/studio\/entrar/);

  await codigo.fill('12');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(erro).toContainText('6 dígitos');

  // código de recuperação: o campo e o botão para voltar existem; um código falso é recusado sem sair do passo
  await page.getByRole('button', { name: 'Usar código de recuperação' }).click();
  const rec = page.getByLabel('Código de recuperação');
  await expect(rec).toBeFocused();
  await rec.fill('codigo-falso-0000');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(erro).toContainText('Código de recuperação inválido');
  await page.getByRole('button', { name: 'Usar o aplicativo autenticador' }).click();

  await page.getByLabel('Código do aplicativo autenticador').fill(totp(conta.segredo!));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/studio\/cms\?status=aprovado/);
});

test('429: depois de 5 tentativas erradas a conta é bloqueada, com o tempo de espera; a senha certa também espera', async ({ page, context }) => {
  const conta = await novaConta(context, 'bloqueio');
  await abrirEntrada(page);
  const erro = page.locator('[data-login-erro]');
  for (let i = 1; i <= 5; i++) {
    await primeiroPasso(page, conta.email, `senha-errada-${i}`);
    await expect(erro).toHaveText('E-mail ou senha incorretos.');
  }
  await primeiroPasso(page, conta.email, 'senha-errada-6');
  await expect(erro).toHaveText(/Muitas tentativas\. Tente de novo em 1[56] minutos\./);
  // durante o bloqueio nem a senha certa entra (e a tela não pede o código)
  await primeiroPasso(page, conta.email, conta.senha);
  await expect(erro).toContainText('Muitas tentativas');
  await expect(page.getByLabel('Código do aplicativo autenticador')).toHaveCount(0);
});

test('conta sem 2º fator: o acesso é negado, a sessão só de senha é encerrada e /studio continua pedindo entrada', async ({ page, context }) => {
  const conta = await novaConta(context, 'sem-2fa', false);
  await abrirEntrada(page, '/studio');
  await primeiroPasso(page, conta.email, conta.senha);
  await expect(page.locator('[data-login-erro]')).toContainText('não tem a verificação em duas etapas ativa');
  await expect(page.getByLabel('Código do aplicativo autenticador')).toHaveCount(0);
  await page.goto('/studio');
  await expect(page).toHaveURL(/\/studio\/entrar\?motivo=NO_SESSION/); // sem sessão (encerrada), não "NO_MFA" com sessão pendurada
});

test('retorno malicioso é ignorado: depois do login a pessoa cai em /studio, nunca em outro site', async ({ page, context }) => {
  const conta = await novaConta(context, 'retorno');
  for (const ruim of ['https://evil.example/', '//evil.example/x', '/studio/../admin', 'javascript:alert(1)']) {
    await page.goto(`/studio/entrar?motivo=NO_SESSION&retorno=${encodeURIComponent(ruim)}`);
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    await primeiroPasso(page, conta.email, conta.senha);
    await page.getByLabel('Código do aplicativo autenticador').fill(totp(conta.segredo!));
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL(/127\.0\.0\.1:\d+\/studio$/);
    expect(new URL(page.url()).hostname).toBe('127.0.0.1');
    await context.clearCookies();
  }
});

test('as mensagens de NO_MFA e FORBIDDEN seguem na tela, com o formulário para entrar com outra conta', async ({ page }) => {
  await page.goto('/studio/entrar?motivo=NO_MFA');
  await expect(page.getByRole('heading', { level: 1, name: 'Verificação em duas etapas necessária' })).toBeVisible();
  await expect(page.getByRole('alert').first()).toContainText('verificação em duas etapas');
  await expect(page.getByLabel('E-mail')).toBeVisible();
  await page.goto('/studio/entrar?motivo=FORBIDDEN');
  await expect(page.getByRole('heading', { level: 1, name: 'Sem permissão' })).toBeVisible();
  await expect(page.getByLabel('Senha')).toBeVisible();
});

// Caso do gate por IP do APP (o limitador por IP do Better Auth foi desligado de propósito — README do /api:123): várias tentativas rápidas
// do mesmo IP, na mesma conta, são barradas com 429 + Retry-After de 900 s; a tela mostra o tempo em minutos e não revela se a conta existe.
// Este caso testava o limitador embutido do Better Auth (10 s, segundos), removido de propósito; o teste estava desatualizado (QAs 9 e 12).
test('gate do app (várias tentativas rápidas no mesmo IP e conta): 429 com Retry-After de 900 s, mensagem em minutos, sem revelar a conta', async ({ page }) => {
  await page.unroute('**/api/auth/**');
  await page.route('**/api/auth/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': '10.250.250.250' } }));
  await page.goto('/studio/entrar?motivo=NO_SESSION');
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  const erro = page.locator('[data-login-erro]');
  let barrado = '';
  for (let i = 1; i <= 6 && !barrado; i++) {
    await primeiroPasso(page, 'ninguem-existe@ln.test', `senha-errada-${i}`);
    await expect(erro).toBeVisible();
    const texto = (await erro.textContent()) ?? '';
    if (/Muitas tentativas/.test(texto)) barrado = texto;
    else expect(texto).toBe('E-mail ou senha incorretos.');
  }

  expect(barrado, 'o gate do app deveria barrar dentro de 6 tentativas rápidas').toMatch(/^Muitas tentativas\. Tente de novo em 1[56] minutos\.$/);

  // A resposta por trás da mensagem: 429 e Retry-After numérico de ~900 s (bloqueio de 15 min). A tela continua em minutos.
  const [resposta] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/auth/sign-in/email')),
    primeiroPasso(page, 'ninguem-existe@ln.test', 'senha-errada-7'),
  ]);
  expect(resposta.status(), 'a 7ª tentativa, já bloqueada, responde 429').toBe(429);
  const retryAfter = Number(resposta.headers()['retry-after']);
  expect(Number.isFinite(retryAfter), `Retry-After ausente: ${resposta.headers()['retry-after']}`).toBe(true);
  expect(retryAfter, `Retry-After ${retryAfter}`).toBeGreaterThan(840);
  expect(retryAfter, `Retry-After ${retryAfter}`).toBeLessThanOrEqual(900);
  await expect(erro).toHaveText(/^Muitas tentativas\. Tente de novo em 1[56] minutos\.$/);
});
