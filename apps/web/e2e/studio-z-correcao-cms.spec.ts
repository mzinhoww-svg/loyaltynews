import { expect, test, type Page } from '@playwright/test';
import { api, definirFlag, entrar, enviar } from './helpers';

// Publicação oficial de matéria só do CMS e correção de matéria publicada (ft/backend 71d735d), com sessão real.
// O nome do arquivo o põe POR ÚLTIMO: o banco de e2e é compartilhado e este spec publica uma matéria e abre um caso de
// correção (os specs de Correções e Social esperam o banco ainda sem eles). Depende da matéria aprovada que o
// studio-cms.spec.ts deixa pronta ("Banco Beta revisa tarifas de cartão").
test.describe.configure({ mode: 'serial' });

const TITULO = 'Banco Beta revisa tarifas de cartão';
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();

let materiaId = '';
let casoUrl = '';

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  await definirFlag(ctx, 'publicacaoPortal', true);
  await ctx.close();
});
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  await definirFlag(ctx, 'publicacaoPortal', false);
  await ctx.close();
});

test('publica a matéria só do CMS pela rota oficial, com a URL pública /noticia/{slug}', async ({ page, context }) => {
  await entrar(context, 'ana', 'editor_chefe');
  await page.goto('/studio/cms?status=aprovado');
  await page.getByRole('link', { name: TITULO }).click();
  await page.waitForURL(/\/studio\/cms\/[0-9a-f-]{36}/);
  materiaId = page.url().split('/studio/cms/')[1]!.split('?')[0]!;
  await expect(page.getByLabel('URL pública da matéria')).toHaveValue(/^https:\/\/portal\.example\.test\/noticia\/.+/);
  await enviar(page, page.getByRole('button', { name: 'Publicar', exact: true }));
  await sucesso(page, 'Publicação registrada.');
  await expect(page.locator('[data-publicado="sim"]')).toBeVisible();
  await expect(page.locator('.ln-pill', { hasText: 'Publicado' })).toBeVisible();
  // já publicada e sem caso: a seção Correção avisa e não oferece formulário utilizável sem caso aceito
  await expect(page.locator('[data-correcao="nenhuma"] [data-casos="0"]')).toBeVisible();
});

test('abre um caso (direito de resposta), preserva a evidência com a URL pública e deixa o caso aceito', async ({ page, context }) => {
  await entrar(context, 'adm', 'admin');
  await page.goto('/studio/cms/correcoes');
  await page.getByLabel(/ID da matéria/).fill(materiaId);
  await page.getByLabel('Trecho ou afirmação contestada').fill('A tarifa não mudou para clientes antigos.');
  await page.getByLabel('Solicitante', { exact: true }).fill('Carla Dias');
  await page.getByLabel('Canal', { exact: true }).selectOption('form');
  await page.getByLabel('Texto da resposta do solicitante (direito de resposta)').fill('Registro que a tarifa de cartão não mudou para clientes antigos do plano básico.');
  await enviar(page, page.getByRole('button', { name: 'Abrir caso' }));
  await sucesso(page, 'Caso aberto.');
  casoUrl = new URL(page.url()).pathname;
  await expect(page.getByRole('link', { name: 'Abrir a matéria' })).toBeVisible();

  await page.getByLabel(/Método de verificação/).fill('Contato de retorno por e-mail institucional');
  await enviar(page, page.getByRole('button', { name: 'Verificar solicitante' }));
  await sucesso(page, 'Passo registrado.');

  // a URL da evidência já vem como a página pública canônica: /noticia/{slug}
  await expect(page.getByLabel('URL da página contestada')).toHaveValue(/^https:\/\/portal\.example\.test\/noticia\/.+/);
  await page.getByLabel('Conteúdo capturado da página').fill('Texto da página capturado para preservar a evidência do caso.');
  await enviar(page, page.getByRole('button', { name: 'Preservar evidência' }));
  await sucesso(page, 'Passo registrado.');
  await expect(page.locator('[data-estado="evidence_preserved"]')).toBeVisible();

  await page.getByLabel('Motivo (mínimo 3 caracteres)').fill('Pedido procedente conforme texto do requerente');
  await enviar(page, page.getByRole('button', { name: 'Registrar triagem' }));
  await sucesso(page, 'Passo registrado.');
  await expect(page.locator('[data-estado="escalated_legal"]')).toBeVisible();
  await enviar(page, page.getByRole('button', { name: 'Dar ciência do caso jurídico' }));
  await sucesso(page, 'Passo registrado.');
  await expect(page.getByRole('link', { name: 'Abrir a matéria' })).toBeVisible();
});

test('revisão de correção: a página publicada não muda até a publicação oficial; recibo; publica como corrigida', async ({ page, context }) => {
  await entrar(context, 'ana', 'editor_chefe');
  await page.goto(`/studio/cms/${materiaId}`);
  const secao = page.getByRole('region', { name: 'Correção' });
  await expect(secao).toBeVisible();
  const antes = (await api(context, 'GET', `/api/materias/${materiaId}`)).body.data as { corpo: string; versao: number; slug: string };

  // a revisão grava o texto novo e o aviso do caso; a página pública ainda não muda
  await secao.getByLabel('Corpo (sem o aviso: o Backend o acrescenta no fim)').fill('Texto completo da matéria de teste, com a tarifa explicada.');
  await enviar(page, secao.getByRole('button', { name: 'Salvar revisão' }));
  await sucesso(page, 'Revisão de correção salva.');
  await expect(page.locator('[data-revisao="rascunho"]')).toBeVisible();
  await expect(page.getByText(/Aviso que entra no fim do corpo/)).toContainText('tarifa de cartão não mudou');

  // a página publicada segue igual (mesma versão, mesmo corpo, ainda "publicado")
  const durante = (await api(context, 'GET', `/api/materias/${materiaId}`)).body.data as { corpo: string; versao: number; status: string };
  expect(durante.corpo).toBe(antes.corpo);
  expect(durante.versao).toBe(antes.versao);
  expect(durante.status).toBe('publicado');

  // o recibo guarda a identidade de publicação de quem o emite: só ela publica (ADR-008); quem emite o recibo da correção é quem a publica
  await page.getByRole('form', { name: 'Recibo da revisão' }).getByLabel('fatos').check();
  await enviar(page, page.getByRole('button', { name: 'Emitir recibo da revisão' }));
  await sucesso(page, 'Recibo da versão emitido.');
  await expect(page.locator('[data-revisao="aprovada"]')).toBeVisible();
  await expect(page.getByLabel('URL pública da matéria').last()).toHaveValue(/\/noticia\//);
  await enviar(page, page.getByRole('button', { name: 'Publicar correção' }));
  await sucesso(page, 'Correção publicada');
  await expect(page.locator('[data-publicado="corrigido"]')).toBeVisible();
  await expect(page.locator('.ln-pill', { hasText: 'Corrigido' })).toBeVisible();

  const depois = (await api(context, 'GET', `/api/materias/${materiaId}`)).body.data as { corpo: string; versao: number; status: string };
  expect(depois.status).toBe('corrigido');
  expect(depois.versao).toBeGreaterThan(antes.versao);
  expect(depois.corpo).toContain('com a tarifa explicada');
  expect(depois.corpo).toContain('tarifa de cartão não mudou para clientes antigos'); // o aviso foi para o fim do corpo
});

test('sem caso aceito o Backend recusa; revisão não ocorre fora de caso; leitura sem escrita', async ({ page, context }) => {
  await entrar(context, 'ana', 'editor_chefe');
  // pedido direto sem caso: a recusa vem do Backend (CORRECTION_CASE_REQUIRED), nada é gravado
  const sem = await api(context, 'PATCH', `/api/materias/${materiaId}`, { versaoEsperada: 1, titulo: 'Outro título' });
  expect([409, 422]).toContain(sem.status);
  await page.goto(casoUrl);
  await expect(page.getByRole('link', { name: 'Abrir a matéria' })).toBeVisible();

  await entrar(context, 'lia', 'leitor');
  await page.goto(`/studio/cms/${materiaId}`);
  await expect(page.getByRole('button', { name: 'Salvar revisão' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publicar correção' })).toHaveCount(0);
});
