import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aguardarHidratacao } from './hidratacao';

/**
 * Mídia kit para o lançamento: pedido de proposta e "Salvar em PDF".
 *
 * 1) Com a flag portalFormularios DESLIGADA: nada é coletado, o botão principal leva a /contato. Depois do DP-57 (flag liberada em
 *    produção POR COMMIT, `PRODUCTION_FLAGS_ON`) esse estado só existe numa subida SEM a liberação — em staging, sem LN_FLAGS_ON.
 * 2) "Salvar em PDF" abre a impressão; no papel saem as tabelas de preço e não saem botões, atalhos nem formulário.
 * 3) Com a flag LIGADA o formulário aparece e envia. A flag é de EXECUÇÃO (ADR-022): o mesmo build sobe com ou sem ela; quem liga é a
 *    tabela de decisões do contrato. Na suíte de produção (APP_ENV=production) o DP-57 já a liga sem variável nenhuma; em staging (e no
 *    modo mock, que sobe como staging) é LN_FLAGS_ON=portalFormularios. O estado é o do servidor: e2e/ambiente-servidor.ts.
 *    A rota de envio é simulada com page.route (MOCK de teste) no formato do Backend (201, 400, 429).
 */
import { formulariosNoServidor } from '../ambiente-servidor';

const FORMS_ON = formulariosNoServidor(process.env);

async function axe(page: Page) {
  await page.waitForLoadState('load');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const resumo = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(resumo, resumo.join('\n')).toEqual([]);
}

test.describe('mídia kit com a flag portalFormularios desligada', () => {
  // DP-57: em produção a flag liga por commit; desligada só numa subida sem a liberação (staging sem LN_FLAGS_ON).
  test.skip(FORMS_ON, 'portalFormularios está ligada nesta subida (DP-57 em produção; LN_FLAGS_ON em staging)');

  test('sem formulário: nada é coletado, o botão principal leva a /contato e não há atalho para a proposta', async ({ page }) => {
    await page.goto('/midia-kit');
    await aguardarHidratacao(page);
    await expect(page.getByTestId('mk-cta-primary')).toHaveAttribute('href', '/contato');
    await expect(page.getByTestId('mk-proposta')).toHaveCount(0);
    await expect(page.getByTestId('proposta-form')).toHaveCount(0);
    await expect(page.locator('input[name="email"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Proposta', exact: true })).toHaveCount(0);
  });

  test('o e-mail comercial confirmado (DP-54) aparece como link na seção de preços e na página de contato', async ({ page }) => {
    await page.goto('/midia-kit');
    await expect(page.getByTestId('mk-email')).toHaveAttribute('href', 'mailto:contato@loyaltynews.com.br');
    await expect(page.getByTestId('mk-email')).toHaveText('contato@loyaltynews.com.br');
    await page.getByTestId('mk-cta-primary').click();
    await expect(page).toHaveURL(/\/contato$/);
    await expect(page.getByTestId('contato-email')).toHaveAttribute('href', 'mailto:contato@loyaltynews.com.br');
  });
});

test.describe('a flag é de execução, não do build', () => {
  test('o mídia kit não sai pré-renderizado do build e é servido sem cache compartilhado', async ({ page, request }) => {
    // Pré-renderizada no build, a página carregaria a flag daquele momento e o pacote pré-compilado a embutiria desligada.
    const manifest = JSON.parse(readFileSync(resolve(['.next-e2e', '.next-e2e-vitrine'].find((d) => existsSync(resolve(d, 'prerender-manifest.json'))) ?? '.next-e2e', 'prerender-manifest.json'), 'utf8')) as { routes: Record<string, unknown>; dynamicRoutes: Record<string, unknown> };
    expect(Object.keys(manifest.routes)).not.toContain('/midia-kit');
    const r = await request.get('/midia-kit');
    expect(r.status()).toBe(200);
    expect(r.headers()['cache-control'] ?? '').toMatch(/no-store|private|no-cache|max-age=0/);
    await page.goto('/midia-kit');
    await expect(page.getByTestId('mk-cta-primary')).toBeVisible();
  });
});

test.describe('Salvar em PDF', () => {
  test('o botão aparece depois da hidratação e abre a impressão do navegador', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __impressoes: number }).__impressoes = 0;
      window.print = () => { (window as unknown as { __impressoes: number }).__impressoes += 1; };
    });
    await page.goto('/midia-kit');
    await aguardarHidratacao(page);
    const botao = page.getByTestId('mk-salvar-pdf');
    await expect(botao).toBeVisible();
    await expect(botao).toHaveAccessibleName('Salvar em PDF');
    expect((await botao.boundingBox())!.height).toBeGreaterThanOrEqual(43.5); // alvo de toque
    await botao.click();
    expect(await page.evaluate(() => (window as unknown as { __impressoes: number }).__impressoes)).toBe(1);
  });

  test('no papel não saem o botão, os atalhos nem a navegação do kit, e saem as tabelas de preço', async ({ page }) => {
    await page.goto('/midia-kit');
    await aguardarHidratacao(page);
    await expect(page.getByTestId('mk-salvar-pdf')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('mk-salvar-pdf')).toBeHidden();
    await expect(page.getByTestId('mk-cta-primary')).toBeHidden();
    await expect(page.getByTestId('mk-cta-secondary')).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Seções do mídia kit' })).toBeHidden();
    // o conteúdo do kit continua no papel
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /04 · Formatos e posições/ })).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByTestId('mk-salvar-pdf')).toBeVisible();
  });

  test('axe sem violações e sem rolagem horizontal a 390 e 320 px, com o botão', async ({ page }) => {
    await page.goto('/midia-kit');
    await aguardarHidratacao(page);
    await expect(page.getByTestId('mk-salvar-pdf')).toBeVisible();
    await axe(page);
    for (const largura of [390, 320]) {
      await page.setViewportSize({ width: largura, height: 800 });
      await page.goto('/midia-kit');
      await aguardarHidratacao(page);
      await expect(page.getByTestId('mk-salvar-pdf')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${largura}px`).toBe(true);
    }
  });
});

test.describe('pedido de proposta (flag portalFormularios ligada)', () => {
  test.skip(!FORMS_ON, 'o servidor precisa subir com portalFormularios ligada (DP-57 em produção ou LN_FLAGS_ON em staging)');
  const ROTA = '**/api/commercial/leads';

  async function pronto(page: Page) {
    await page.goto('/midia-kit');
    await aguardarHidratacao(page);
    await expect(page.getByTestId('proposta-form')).toHaveAttribute('data-pronto', '1');
  }
  async function preencher(page: Page, over: { email?: string } = {}) {
    const form = page.getByTestId('proposta-form');
    await form.getByLabel('Seu nome').fill('Ana Souza (MOCK)');
    await form.getByLabel('Empresa').fill('Programa Alfa (MOCK)');
    await form.getByLabel('E-mail comercial').fill(over.email ?? 'ana@alfa.example');
    await form.getByLabel('Objetivo').selectOption({ label: 'Divulgar a marca' });
  }

  test('com a flag ligada o botão principal leva ao formulário, que traz finalidade, opt-in desmarcado e passa no axe', async ({ page }) => {
    await pronto(page);
    await expect(page.getByTestId('mk-cta-primary')).toHaveAttribute('href', '#proposta');
    await expect(page.getByTestId('proposta-finalidade')).toContainText('só para responder a este pedido de proposta');
    await expect(page.getByLabel(/Também quero receber a newsletter/)).not.toBeChecked();
    await axe(page);
  });

  test('campos obrigatórios vazios: erros ao lado de cada campo, foco no primeiro e nada é enviado', async ({ page }) => {
    let enviados = 0;
    await page.route(ROTA, (r) => { enviados += 1; return r.fulfill({ status: 201, json: {} }); });
    await pronto(page);
    await page.getByRole('button', { name: 'Pedir proposta' }).click();
    await expect(page.getByText('Informe seu nome (2 a 200 caracteres).')).toBeVisible();
    await expect(page.getByText('Informe um e-mail válido para respondermos.')).toBeVisible();
    await expect(page.getByText('Escolha o objetivo.')).toBeVisible();
    await expect(page.getByLabel('Seu nome')).toBeFocused();
    expect(enviados).toBe(0);
    await axe(page);
  });

  test('envio válido: corpo no formato do contrato, sem o campo escondido, e mensagem de recebido sem repetir os dados', async ({ page }) => {
    let corpo: Record<string, unknown> | null = null;
    await page.route(ROTA, async (r) => { corpo = r.request().postDataJSON(); await r.fulfill({ status: 201, json: { id: 'lead-1', status: 'novo', consentimentoEm: '2026-11-24T20:00:00.000Z' } }); });
    await pronto(page);
    await preencher(page);
    await page.getByRole('button', { name: 'Pedir proposta' }).click();
    await expect(page.getByTestId('proposta-recebida')).toBeVisible();
    await expect(page.getByTestId('proposta-recebida')).not.toContainText('ana@alfa.example');
    expect(corpo).toEqual({ nome: 'Ana Souza (MOCK)', empresa: 'Programa Alfa (MOCK)', email: 'ana@alfa.example', formatosInteresse: [], objetivo: 'Divulgar a marca', optInNewsletter: false });
  });

  test('robô que preenche o campo escondido: a tela diz recebido e nada é enviado', async ({ page }) => {
    let enviados = 0;
    await page.route(ROTA, (r) => { enviados += 1; return r.fulfill({ status: 201, json: {} }); });
    await pronto(page);
    await preencher(page);
    await page.locator('input[name="site"]').evaluate((el) => { (el as HTMLInputElement).value = 'http://spam.example'; });
    await page.getByRole('button', { name: 'Pedir proposta' }).click();
    await expect(page.getByTestId('proposta-recebida')).toBeVisible();
    expect(enviados).toBe(0);
  });

  for (const [status, trecho] of [[429, 'muitos pedidos'], [400, 'Revise os campos'], [503, 'Nada foi registrado']] as const) {
    test(`resposta ${status} do servidor: aviso claro, foco no aviso e os campos continuam preenchidos`, async ({ page }) => {
      await page.route(ROTA, (r) => r.fulfill({ status, json: { error: { code: 'X', message: 'x' } } }));
      await pronto(page);
      await preencher(page);
      await page.getByRole('button', { name: 'Pedir proposta' }).click();
      const aviso = page.getByTestId('proposta-erro');
      await expect(aviso).toContainText(trecho);
      await expect(aviso).toBeFocused();
      await expect(page.getByLabel('E-mail comercial')).toHaveValue('ana@alfa.example');
      await expect(page.getByTestId('proposta-recebida')).toHaveCount(0);
    });
  }

  test('sem rolagem horizontal a 390 e 320 px e sem o formulário no papel', async ({ page }) => {
    for (const largura of [390, 320]) {
      await page.setViewportSize({ width: largura, height: 800 });
      await pronto(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${largura}px`).toBe(true);
    }
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByTestId('mk-proposta')).toBeHidden();
  });
});
