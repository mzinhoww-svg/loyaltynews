import { expect, test, type Page } from '@playwright/test';
import { entrar, enviar } from './helpers';

// P2-05: fonte rápida e evidência rápida dentro da Nova matéria e da edição. As rotas do Backend 3 ainda não estão neste ramo: o e2e roda
// contra o despachante MOCK do contrato (lib/studio/fonte-rapida.e2e.mock.ts); quando o SHA real entrar, o mesmo e2e roda nas rotas reais.
test.describe.configure({ mode: 'serial' });

const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();

const URL_FONTE = 'https://www.banco-teste.example/imprensa';
let fonteId = '';
let materiaUrl = '';

test('Nova matéria: o painel diz que a fonte fica a confirmar e inativa; erros em português, sem sair da tela', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto('/studio/cms/nova');
  const painel = page.locator('[data-painel="fonte-rapida"]');
  await expect(painel).toBeVisible();
  await expect(painel.locator('[data-aviso="a-confirmar"]')).toContainText('a confirmar');
  await expect(painel.locator('[data-aviso="a-confirmar"]')).toContainText('inativa');
  await expect(painel.locator('[data-aviso="a-confirmar"]')).toContainText('não conta para os gates');
  await expect(painel.locator('[data-evidencia="salve-primeiro"]')).toBeVisible(); // sem rascunho salvo não há evidência

  const form = painel.getByRole('form', { name: 'Nova fonte rápida' });
  await enviar(page, form.getByRole('button', { name: 'Criar fonte (a confirmar)' }));
  await erro(page, 'URL da fonte');
  await form.getByLabel(/URL da fonte/).fill('http://sem-https.example/x');
  await form.getByLabel(/Nome da fonte/).fill('Fonte de teste');
  await form.getByLabel('Editoria da fonte').selectOption('bancos');
  await enviar(page, form.getByRole('button', { name: 'Criar fonte (a confirmar)' }));
  await erro(page, 'https://');
});

test('cria a fonte rápida: nasce a confirmar e inativa; a mesma URL de novo é recusada apontando a fonte existente', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto('/studio/cms/nova');
  const criar = async () => {
    const form = page.locator('[data-painel="fonte-rapida"]').getByRole('form', { name: 'Nova fonte rápida' });
    await form.getByLabel(/URL da fonte/).fill(URL_FONTE);
    await form.getByLabel(/Nome da fonte/).fill('Sala de imprensa do Banco Teste');
    await form.getByLabel('Tipo').selectOption('comunicado');
    await form.getByLabel('Editoria da fonte').selectOption('bancos');
    await enviar(page, form.getByRole('button', { name: 'Criar fonte (a confirmar)' }));
  };
  await criar();
  await sucesso(page, 'a confirmar e inativa: não coleta nada');
  fonteId = new URL(page.url()).searchParams.get('fonte') ?? '';
  expect(fonteId).toMatch(/^rapida-[0-9a-f]{8}$/);

  await page.goto('/studio/cms/nova');
  await criar();
  await erro(page, /já está cadastrada/);
  await erro(page, fonteId);
});

test('edição do rascunho: anexa evidência (URL + trecho), vê a lista com o selo a confirmar e o limite de 500', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto('/studio/cms/nova');
  await page.getByLabel('Título', { exact: true }).fill('Banco Teste muda tarifa de pacote');
  await page.getByLabel(/Resumo/).fill('Resumo curto da matéria de teste da fonte rápida.');
  await page.getByLabel('Editoria', { exact: true }).selectOption('bancos');
  await page.getByLabel('Corpo da matéria').fill('Texto completo da matéria de teste da fonte rápida.');
  await enviar(page, page.getByRole('button', { name: 'Criar rascunho' }));
  await expect(page.getByRole('heading', { level: 1, name: 'Banco Teste muda tarifa de pacote' })).toBeVisible();
  materiaUrl = new URL(page.url()).pathname;

  const painel = page.locator('[data-painel="fonte-rapida"]');
  await expect(painel.locator('[data-vazio="evidencias-rapidas"]')).toBeVisible();
  const form = painel.getByRole('form', { name: 'Anexar evidência' });
  await form.getByLabel(/URL da evidência/).fill(`${URL_FONTE}/nota-1`);
  await form.getByLabel(/Trecho que sustenta/).fill('x'.repeat(501));
  await enviar(page, form.getByRole('button', { name: 'Anexar evidência (a confirmar)' }));
  await erro(page, 'há 501');

  await form.getByLabel(/Trecho que sustenta/).fill('O banco informou que a tarifa do pacote básico passa a R$ 12,90 por mês.');
  await enviar(page, form.getByRole('button', { name: 'Anexar evidência (a confirmar)' }));
  await sucesso(page, 'Evidência anexada como a confirmar');
  const item = painel.locator('[data-evidencia-id]');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('a confirmar');
  await expect(item).toContainText('R$ 12,90');
  await expect(item).toContainText('não conta para os gates de publicação');
  await expect(item.getByRole('link')).toHaveAttribute('href', `${URL_FONTE}/nota-1`);
});

test('criar fonte na própria edição leva a fonte nova para o formulário de evidência', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto(materiaUrl);
  const painel = page.locator('[data-painel="fonte-rapida"]');
  await painel.getByText('Nova fonte rápida').click();
  const form = painel.getByRole('form', { name: 'Nova fonte rápida' });
  await form.getByLabel(/URL da fonte/).fill('https://www.agencia-teste.example/noticias');
  await form.getByLabel(/Nome da fonte/).fill('Agência de notícias de teste');
  await form.getByLabel('Editoria da fonte').selectOption('bancos');
  await enviar(page, form.getByRole('button', { name: 'Criar fonte (a confirmar)' }));
  await sucesso(page, 'Fonte “Agência de notícias de teste” criada');
  const novo = new URL(page.url()).searchParams.get('fonte')!;
  await expect(page.locator('#ev-fonte')).toHaveValue(novo);
  // a lista de evidências da matéria segue lá depois do redirecionamento
  await expect(painel.locator('[data-evidencia-id]')).toHaveCount(1);
});

test('só quem edita vê o painel; revisor e leitor não', async ({ page, context }) => {
  for (const role of ['revisor', 'leitor']) {
    await entrar(context, 'x', role);
    await page.goto(materiaUrl);
    await expect(page.getByRole('heading', { level: 1, name: 'Banco Teste muda tarifa de pacote' })).toBeVisible();
    await expect(page.locator('[data-painel="fonte-rapida"]')).toHaveCount(0);
  }
  await entrar(context, 'x', 'revisor');
  await page.goto('/studio/cms/nova');
  await expect(page).toHaveURL(/motivo=FORBIDDEN/);
});

test('depois de um erro o formulário devolve o que foi digitado (nada se perde)', async ({ page, context }) => {
  await entrar(context, 'ed', 'editor');
  await page.goto(materiaUrl);
  const form = page.locator('[data-painel="fonte-rapida"]').getByRole('form', { name: 'Anexar evidência' });
  await form.getByLabel(/URL da evidência/).fill(`${URL_FONTE}/nota-2`);
  await form.getByLabel(/Trecho que sustenta/).fill('y'.repeat(501));
  await enviar(page, form.getByRole('button', { name: 'Anexar evidência (a confirmar)' }));
  await erro(page, 'há 501');
  const volta = page.locator('[data-painel="fonte-rapida"]').getByRole('form', { name: 'Anexar evidência' });
  await expect(volta.getByLabel(/URL da evidência/)).toHaveValue(`${URL_FONTE}/nota-2`);
  await expect(volta.getByLabel(/Trecho que sustenta/)).toHaveValue('y'.repeat(501));
});
