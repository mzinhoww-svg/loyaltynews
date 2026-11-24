import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Formulário público do titular (DP-38) em /correcoes. O envio vai do navegador para POST /api/publico/correcoes (Backend 2).
 * A rota é simulada aqui com page.route (MOCK de teste) no formato do Backend: 202 {status:'recebido'}, 400 VALIDATION_ERROR, 429.
 * Roda nos três modos (empty, mock, api): a página é institucional e não depende da fonte de dados.
 */
const ROTA = '**/api/publico/correcoes';
/** Espera depois do envio: com o build de produção (sem compilação sob demanda) o padrão de 5 s basta. */
const ENVIO_MS = 5_000;

async function axe(page: Page) {
  // 'load', não 'networkidle': no build de produção o prefetch de links do Next mantém a rede ocupada (mesma regra do intelligence.spec).
  await page.waitForLoadState('load');
  await expect.poll(() => page.title()).not.toBe('');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(summary, summary.join('\n')).toEqual([]);
}

/** Espera a hidratação do formulário (data-pronto): clicar antes faria o envio nativo, sem o estado da tela. */
async function pronto(page: Page) {
  await expect(page.getByTestId('pedido-form')).toHaveAttribute('data-pronto', '1');
}

async function preencher(page: Page, over: { url?: string; texto?: string } = {}) {
  await pronto(page);
  const form = page.getByTestId('pedido-form');
  await form.getByLabel('Seu nome').fill('Maria Titular (MOCK)');
  await form.getByLabel('E-mail para resposta').fill('maria@example.test');
  if (over.url !== undefined) await form.getByLabel('Endereço da página').fill(over.url);
  await form.getByLabel('Remoção de um dado').check();
  await form.getByLabel('Descreva o pedido').fill(over.texto ?? 'Peço a remoção do cargo exibido no meu perfil (MOCK).');
}

test.describe('formulário do titular em /correcoes', () => {
  test('envio válido: corpo no contrato, honeypot vazio, estado "recebido" sem eco de dados; axe antes e depois', async ({ page }) => {
    let corpo: Record<string, unknown> | null = null;
    await page.route(ROTA, async (r: Route) => {
      corpo = r.request().postDataJSON();
      await r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'recebido' }) });
    });
    await page.goto('/correcoes');
    await expect(page.getByRole('heading', { name: 'Pedir correção ou remoção de um dado' })).toBeVisible();
    await axe(page);
    await preencher(page, { url: 'https://portal.example.test/intelligence/pessoas/abc' });
    await page.getByRole('button', { name: 'Enviar pedido' }).click();
    const ok = page.getByTestId('pedido-recebido');
    await expect(ok).toBeVisible({ timeout: ENVIO_MS });
    await expect(ok).toHaveAttribute('role', 'status');
    await expect(ok).not.toContainText('maria@example.test');
    expect(corpo).toEqual({
      nome: 'Maria Titular (MOCK)', contato: 'maria@example.test', url: 'https://portal.example.test/intelligence/pessoas/abc', tipo: 'remocao',
      texto: 'Peço a remoção do cargo exibido no meu perfil (MOCK).', site: '',
    });
    await axe(page);
  });

  test('validação no navegador: nada é enviado, erros ligados aos campos e foco no primeiro', async ({ page }) => {
    let chamadas = 0;
    await page.route(ROTA, (r) => {
      chamadas++;
      return r.fulfill({ status: 202, body: '{"status":"recebido"}' });
    });
    await page.goto('/correcoes');
    await pronto(page);
    await page.getByRole('button', { name: 'Enviar pedido' }).click();
    const nome = page.getByTestId('pedido-form').getByLabel('Seu nome');
    await expect(nome).toHaveAttribute('aria-invalid', 'true', { timeout: ENVIO_MS });
    await expect(nome).toBeFocused();
    await expect(page.getByText('Informe um e-mail válido para respondermos.')).toBeVisible();
    await expect(page.getByText(/Cole o endereço completo da página/)).toBeVisible();
    expect(chamadas).toBe(0);
    await axe(page);
  });

  for (const [status, texto] of [
    [400, 'Revise os campos'],
    [429, 'Tente novamente mais tarde'],
    [503, 'Nada foi registrado'],
  ] as const) {
    test(`resposta ${status}: erro honesto (role=alert) e o formulário continua preenchido`, async ({ page }) => {
      await page.route(ROTA, (r) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: { code: 'X', message: 'detalhe interno' } }) }));
      await page.goto('/correcoes');
      await preencher(page, { url: 'https://portal.example.test/moves/abc' });
      await page.getByRole('button', { name: 'Enviar pedido' }).click();
      const erro = page.getByTestId('pedido-erro');
      await expect(erro).toHaveAttribute('role', 'alert', { timeout: ENVIO_MS });
      await expect(erro).toContainText(texto);
      await expect(page.locator('main')).not.toContainText('detalhe interno');
      await expect(page.getByTestId('pedido-form').getByLabel('Seu nome')).toHaveValue('Maria Titular (MOCK)');
      await axe(page);
    });
  }

  test('rede fora: erro honesto, sem 500', async ({ page }) => {
    await page.route(ROTA, (r) => r.abort('connectionrefused'));
    await page.goto('/correcoes');
    await preencher(page, { url: 'https://portal.example.test/moves/abc' });
    await page.getByRole('button', { name: 'Enviar pedido' }).click();
    await expect(page.getByTestId('pedido-erro')).toContainText('Não conseguimos enviar o pedido agora', { timeout: ENVIO_MS });
  });

  test('alvo pelo link do perfil: URL pré-preenchida só com caminho do próprio site', async ({ page, baseURL }) => {
    await page.goto('/correcoes?alvo=%2Fintelligence%2Fpessoas%2Fabc#pedido');
    await pronto(page);
    await expect(page.getByTestId('pedido-form').getByLabel('Endereço da página')).toHaveValue(`${new URL(baseURL!).origin}/intelligence/pessoas/abc`);
    await page.goto('/correcoes?alvo=https%3A%2F%2Fevil.example%2Fx');
    await pronto(page);
    await expect(page.getByTestId('pedido-form').getByLabel('Endereço da página')).toHaveValue('');
  });

  test.describe('sem JavaScript', () => {
    test.use({ javaScriptEnabled: false });
    test('aviso visível ANTES do formulário e botão de envio desabilitado (nunca um envio nativo sem estado)', async ({ page }) => {
      await page.goto('/correcoes');
      const aviso = page.getByTestId('pedido-noscript');
      await expect(aviso).toBeVisible();
      await expect(aviso).toContainText('precisa de JavaScript');
      const yAviso = (await aviso.boundingBox())!.y;
      const yForm = (await page.getByTestId('pedido-form').boundingBox())!.y;
      expect(yAviso).toBeLessThan(yForm);
      await expect(page.getByRole('button', { name: 'Enviar pedido' })).toBeDisabled();
    });
  });

  test('honeypot fica fora da leitura e da tabulação', async ({ page }) => {
    await page.goto('/correcoes');
    const hp = page.locator('input[name="site"]');
    await expect(hp).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('textbox', { name: /Site/ })).toHaveCount(0);
  });
});
