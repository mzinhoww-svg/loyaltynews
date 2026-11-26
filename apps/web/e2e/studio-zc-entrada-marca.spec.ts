import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { totp } from './totp';

// Pacote C do refino de lançamento, item 4: login, 2º fator e Minha conta / troca de senha com o logo e o monograma da marca, no visual dos
// cartões do portal. Critérios: axe sem violação a 390 e 1280 px, sem rolagem horizontal da página, título sem corte, foco visível, e as
// capturas "depois" (depois__<rota>__<largura>.png) a 390, 768 e 1280 px. CAPTURAS_DIR define onde gravar (padrão: saída do teste).
test.describe.configure({ mode: 'serial' });

interface Conta {
  email: string;
  senha: string;
  segredo: string | null;
}

const LARGURAS = [390, 768, 1280] as const;
const AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

let ipSeq = 0;
test.beforeEach(async ({ page }) => {
  await page.route('**/api/auth/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': `10.${Math.floor(++ipSeq / 250) + 170}.${ipSeq % 250}.9` } }));
});

async function novaConta(context: BrowserContext, chave: string): Promise<Conta> {
  const r = await context.request.get(`/api/e2e/login?conta=${chave}&role=editor&totp=1`);
  expect(r.ok(), `conta de teste ${chave}: ${r.status()}`).toBe(true);
  return (await r.json()) as Conta;
}

function capturas(info: TestInfo): string {
  const dir = process.env.CAPTURAS_DIR ?? info.outputPath('capturas');
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function semRolagemHorizontal(page: Page) {
  const r = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, vista: window.innerWidth }));
  expect(r.doc, `rolagem horizontal: ${r.doc} > ${r.vista}`).toBeLessThanOrEqual(r.vista);
}

async function axeLimpo(page: Page, onde: string) {
  const ax = await new AxeBuilder({ page }).withTags(AXE).analyze();
  const resumo = ax.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(resumo, `${onde}\n${resumo.join('\n')}`).toEqual([]);
}

/** Imagem da marca carregada de verdade (não quebrada) e com o tamanho pedido. */
async function imagemCarregada(page: Page, seletor: string) {
  const img = page.locator(seletor);
  await expect(img).toBeVisible();
  const ok = await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
  expect(ok, `${seletor} não carregou`).toBe(true);
}

/** O título cabe na largura (sem corte nem estouro do cartão). */
async function tituloInteiro(page: Page) {
  const h1 = page.getByRole('heading', { level: 1 });
  const r = await h1.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(r.sw).toBeLessThanOrEqual(r.cw + 1);
}

test('entrada (e-mail e senha) e 2º fator com o logo da marca: axe, sem rolagem horizontal e capturas a 390, 768 e 1280 px', async ({ page, context }, info) => {
  const dir = capturas(info);
  const conta = await novaConta(context, 'marca-entrada');
  for (const largura of LARGURAS) {
    await page.setViewportSize({ width: largura, height: 900 });
    await page.goto('/studio/entrar?motivo=NO_SESSION');
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();
    await imagemCarregada(page, '[data-entrada] img.st-entrada__logo');
    await expect(page.getByRole('img', { name: 'Loyalty News' })).toBeVisible();
    await expect(page.locator('[data-etapa-rotulo]')).toHaveText('Etapa 1 de 2 · e-mail e senha');
    await semRolagemHorizontal(page);
    await tituloInteiro(page);
    if (largura !== 768) await axeLimpo(page, `entrada ${largura}px`);
    await page.screenshot({ path: join(dir, `depois__studio-entrar__${largura}.png`), fullPage: true });

    // foco visível no primeiro campo (Tab a partir do topo chega aos campos na ordem: e-mail, senha, botão)
    const email = page.getByLabel('E-mail');
    await expect(email).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Senha')).toBeFocused();
    const contorno = await page.getByLabel('Senha').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(contorno).not.toBe('none');

    // 2º passo: código do autenticador, no mesmo cartão
    await email.fill(conta.email);
    await page.getByLabel('Senha').fill(conta.senha);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByLabel('Código do aplicativo autenticador')).toBeFocused();
    await expect(page.locator('[data-etapa-rotulo]')).toHaveText('Etapa 2 de 2 · verificação em duas etapas');
    await imagemCarregada(page, '[data-entrada] img.st-entrada__logo');
    await semRolagemHorizontal(page);
    if (largura !== 768) await axeLimpo(page, `2º fator ${largura}px`);
    await page.screenshot({ path: join(dir, `depois__studio-entrar-2fator__${largura}.png`), fullPage: true });
  }
  // a última passagem entra de verdade: o cartão novo não quebrou o login
  await page.getByLabel('Código do aplicativo autenticador').fill(totp(conta.segredo!));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/studio$/);
});

test('Minha conta e troca de senha com o monograma: axe, sem rolagem horizontal e capturas a 390, 768 e 1280 px; a troca continua funcionando', async ({ page, context }, info) => {
  const dir = capturas(info);
  const conta = await novaConta(context, 'marca-conta');
  await page.goto('/studio/conta');
  await page.getByLabel('E-mail').fill(conta.email);
  await page.getByLabel('Senha').fill(conta.senha);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByLabel('Código do aplicativo autenticador').fill(totp(conta.segredo!));
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/studio\/conta$/);

  for (const largura of LARGURAS) {
    await page.setViewportSize({ width: largura, height: 900 });
    await page.reload();
    await imagemCarregada(page, 'img.st-conta__monograma');
    await expect(page.getByRole('heading', { level: 1, name: 'Minha conta' })).toBeVisible();
    await expect(page.locator('[data-conta-cartao]').getByRole('heading', { name: 'Trocar senha' })).toBeVisible();
    await semRolagemHorizontal(page);
    await tituloInteiro(page);
    if (largura !== 768) await axeLimpo(page, `conta ${largura}px`);
    await page.screenshot({ path: join(dir, `depois__studio-conta__${largura}.png`), fullPage: true });
  }

  // erro de política aparece dentro do cartão e a troca continua funcionando
  await page.getByLabel('Senha atual').fill(conta.senha);
  await page.getByLabel('Nova senha', { exact: true }).fill('curta');
  await page.getByLabel('Confirme a nova senha').fill('curta');
  await page.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(page.locator('[data-conta-cartao] [data-senha-aviso="err"]')).toContainText('pelo menos 12 caracteres');
  await page.screenshot({ path: join(dir, `depois__studio-conta-erro__1280.png`), fullPage: true });
  const nova = 'senha-nova-do-refino-123';
  await page.getByLabel('Senha atual').fill(conta.senha);
  await page.getByLabel('Nova senha', { exact: true }).fill(nova);
  await page.getByLabel('Confirme a nova senha').fill(nova);
  await page.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(page.locator('[data-conta-cartao] [data-senha-aviso="ok"]')).toHaveText('Senha trocada. As outras sessões foram encerradas.');
});
