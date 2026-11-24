import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { segundosRestantes, totp } from './totp';

// Smoke de login REAL do LN Studio num ambiente no ar (staging): e-mail + senha → código TOTP → /studio aberto → sair; e o caso negativo
// (senha errada → mensagem genérica, sem dizer se a conta existe). Credenciais SÓ do ambiente (nunca em arquivo, URL ou log):
//   STUDIO_SMOKE_URL, STUDIO_SMOKE_EMAIL, STUDIO_SMOKE_SENHA, STUDIO_SMOKE_TOTP (segredo base32 do 2º fator).
// Campos achados pelo `autocomplete` exigido pelo plano do Security (19_plano-primeiro-admin-studio-staging.md, item 1c):
// username, current-password e one-time-code. O formulário é enviado com Enter, sem depender do texto do botão.

const URL_ALVO = process.env.STUDIO_SMOKE_URL ?? '';
const EMAIL = process.env.STUDIO_SMOKE_EMAIL ?? '';
const SENHA = process.env.STUDIO_SMOKE_SENHA ?? '';
const SEGREDO = process.env.STUDIO_SMOKE_TOTP ?? '';
const faltando = ['STUDIO_SMOKE_URL', 'STUDIO_SMOKE_EMAIL', 'STUDIO_SMOKE_SENHA', 'STUDIO_SMOKE_TOTP'].filter((k) => !process.env[k]);

// Trava de alvo (QA 7, fd63672): só origens desta lista, comparadas por inteiro (esquema + host + porta). Fora da máquina local, só https.
// Para outro staging, edite a lista num commit revisado (não há liberação por variável).
const ORIGENS_STAGING = ['https://loyaltynews-stg.vertraweb.app'] as const;
const ehLocal = (u: URL) => (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && (u.protocol === 'http:' || u.protocol === 'https:');
function origemPermitida(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return ehLocal(u) || (u.protocol === 'https:' && (ORIGENS_STAGING as readonly string[]).includes(u.origin));
}
const alvoPermitido = origemPermitida(URL_ALVO);
const ORIGEM = alvoPermitido ? new URL(URL_ALVO).origin : '';

/** Antes de digitar qualquer credencial: a página ainda está na origem permitida (sem redirecionamento para outro lugar). */
async function conferirOrigemFinal(p: Page) {
  expect(new URL(p.url()).origin, 'a página saiu da origem permitida antes do preenchimento').toBe(ORIGEM);
}

const usuario = (p: Page) => p.locator('input[autocomplete="username"]');
const senha = (p: Page) => p.locator('input[autocomplete="current-password"]');
const codigo = (p: Page) => p.locator('input[autocomplete="one-time-code"]');

/** Código TOTP com folga: se a janela atual termina em menos de 5 s, espera a próxima. */
async function codigoAtual(): Promise<string> {
  const resta = segundosRestantes();
  if (resta < 5) await new Promise((r) => setTimeout(r, (resta + 1) * 1000));
  return totp(SEGREDO);
}

test.describe('Studio: smoke de login real', () => {
  test.describe.configure({ mode: 'serial' });

  test('gerador TOTP confere com o vetor da RFC 6238 (sem rede)', () => {
    // RFC 6238, apêndice B: segredo ASCII "12345678901234567890", T = 59 s, SHA-1 → 94287082 (8 dígitos) / 287082 (6)
    expect(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000, 30, 8)).toBe('94287082');
    expect(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
    expect(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1_111_111_109_000, 30, 8)).toBe('07081804');
  });

  test('entra com senha e TOTP, /studio abre e sai', async ({ page }) => {
    test.skip(faltando.length > 0, `variáveis ausentes: ${faltando.join(', ')}`);
    expect(alvoPermitido, `alvo recusado: só ${ORIGENS_STAGING.join(', ')} ou máquina local (https fora dela)`).toBe(true);

    await page.goto('/studio/entrar');
    await expect(usuario(page)).toBeVisible();
    await conferirOrigemFinal(page);
    await usuario(page).fill(EMAIL);
    await senha(page).fill(SENHA);
    const respSenha = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/sign-in/email' && r.request().method() === 'POST');
    await senha(page).press('Enter');
    expect((await respSenha).status(), 'sign-in/email deveria responder 200').toBe(200);

    // 2º fator obrigatório para o Studio
    await expect(codigo(page)).toBeVisible({ timeout: 15_000 });
    await conferirOrigemFinal(page);
    await codigo(page).fill(await codigoAtual());
    const respCodigo = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/two-factor/verify-totp' && r.request().method() === 'POST');
    await codigo(page).press('Enter');
    expect((await respCodigo).status(), 'verify-totp deveria responder 200').toBe(200);

    await page.waitForURL((u) => u.pathname.startsWith('/studio') && !u.pathname.startsWith('/studio/entrar'), { timeout: 20_000 });
    await expect(page.locator('main h1').first()).toBeVisible();
    // a sessão é do Better Auth, por cookie (nada de credencial na URL)
    expect(page.url()).not.toMatch(/senha|password|code=|codigo=/i);
    const sessao = await page.request.get('/api/auth/get-session');
    expect(sessao.status()).toBe(200);
    expect(((await sessao.json()) as { user?: { email?: string } } | null)?.user?.email?.toLowerCase()).toBe(EMAIL.toLowerCase());

    // sair: pelo botão da tela, se existir; senão pela rota oficial (mesma origem)
    const sair = page.getByRole('button', { name: /^sair$/i });
    if (await sair.count()) await sair.first().click();
    else expect((await page.request.post('/api/auth/sign-out', { headers: { origin: ORIGEM }, data: {} })).ok()).toBe(true);
    await page.goto('/studio');
    await expect(page).toHaveURL(/\/studio\/entrar/);
  });

  test('senha errada: mensagem genérica, sem pedir código e sem revelar se a conta existe', async ({ page }) => {
    test.skip(faltando.length > 0, `variáveis ausentes: ${faltando.join(', ')}`);
    expect(alvoPermitido).toBe(true);
    // conta 1 tentativa no limitador (5 por conta); roda depois do login certo, que zera o contador da conta
    await page.goto('/studio/entrar');
    await expect(usuario(page)).toBeVisible();
    await conferirOrigemFinal(page);
    await usuario(page).fill(EMAIL);
    await senha(page).fill(`errada-${randomUUID()}`); // independente da senha real
    const resp = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/sign-in/email' && r.request().method() === 'POST');
    await senha(page).press('Enter');
    // só a recusa de credencial vale: 429 (limite), 503 (login desligado) e 5xx reprovam o smoke
    expect((await resp).status(), 'sign-in/email com senha errada deveria responder 401').toBe(401);
    await expect(page.locator('[data-login-erro]')).toHaveText('E-mail ou senha incorretos.', { timeout: 15_000 });
    await expect(codigo(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/studio\/entrar/);
    const s = await page.request.get('/api/auth/get-session');
    expect(s.status(), 'get-session deveria responder 200').toBe(200);
    expect(await s.json()).toBeNull();
  });
});
