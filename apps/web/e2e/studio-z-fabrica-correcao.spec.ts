import { expect, test, type Page } from '@playwright/test';
import { api, definirFlag, entrar, enviar, semearFabricaAprovada } from './helpers';

// Correção de matéria da FÁBRICA (ft/backend d618265): recibo da versão corrigida + publicação oficial com o mesmo `correcao`.
// Roda depois de studio-z-correcao-cms (ordem alfabética): o banco de e2e é compartilhado e este spec abre um caso e publica uma matéria.
test.describe.configure({ mode: 'serial' });

const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();

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

test('a tela leva ao fluxo recibo + publicação com correcao; publica como corrigida', async ({ page, context }) => {
  // matéria da Fábrica aprovada, publicada pelo fluxo oficial (recibo editorial → rota de publicação)
  const { articleId, draft } = await semearFabricaAprovada(context);
  await entrar(context, 'ana', 'editor_chefe');
  const recibo = await api(context, 'POST', `/api/materias/${articleId}/recibos`, { checagens: [{ tipo: 'fatos', resultado: 'aprovado' }] });
  expect(recibo.status, JSON.stringify(recibo.body)).toBe(201);
  const pub = await api(context, 'POST', `/api/studio/editorial/articles/${articleId}/publication`, { articleId, receiptId: recibo.body.data.id, url: 'https://portal.example.test/noticia/banco-gama-reduz-anuidade-fabrica' });
  expect(pub.status, JSON.stringify(pub.body)).toBe(201);

  // PATCH direto na matéria da Fábrica: o Backend aponta as rotas certas
  const patch = await api(context, 'PATCH', `/api/materias/${articleId}`, { versaoEsperada: 1, casoCorrecaoId: 'x', titulo: 'Outro' });
  expect(patch.status).toBe(409);
  expect(patch.body.error.code).toBe('FACTORY_CORRECTION_ROUTE');

  // caso de direito de resposta aceito (ciência do responsável)
  await entrar(context, 'adm', 'admin');
  await page.goto('/studio/cms/correcoes');
  await page.getByLabel(/ID da matéria/).fill(articleId);
  await page.getByLabel('Trecho ou afirmação contestada').fill('A anuidade não caiu para todos os clientes.');
  await page.getByLabel('Solicitante', { exact: true }).fill('Davi Souza');
  await page.getByLabel('Canal', { exact: true }).selectOption('form');
  await page.getByLabel('Texto da resposta do solicitante (direito de resposta)').fill('Registro que a redução da anuidade não vale para clientes do plano básico.');
  await enviar(page, page.getByRole('button', { name: 'Abrir caso' }));
  await sucesso(page, 'Caso aberto.');
  await page.getByLabel(/Método de verificação/).fill('Contato de retorno por e-mail institucional');
  await enviar(page, page.getByRole('button', { name: 'Verificar solicitante' }));
  await sucesso(page, 'Passo registrado.');
  await page.getByLabel('Conteúdo capturado da página').fill('Texto da página capturado para preservar a evidência do caso.');
  await enviar(page, page.getByRole('button', { name: 'Preservar evidência' }));
  await sucesso(page, 'Passo registrado.');
  await page.getByLabel('Motivo (mínimo 3 caracteres)').fill('Pedido procedente conforme texto do requerente');
  await enviar(page, page.getByRole('button', { name: 'Registrar triagem' }));
  await sucesso(page, 'Passo registrado.');
  await enviar(page, page.getByRole('button', { name: 'Dar ciência do caso jurídico' }));
  await sucesso(page, 'Passo registrado.');

  // a matéria (Fábrica) oferece o caminho certo, não a revisão do CMS
  await entrar(context, 'ana', 'editor_chefe');
  await page.goto(`/studio/cms/${articleId}`);
  await expect(page.locator('[data-origem="fabrica"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar revisão' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Corrigir pela Fábrica' }).click();
  await expect(page.getByRole('heading', { name: 'Correção de matéria da Fábrica' })).toBeVisible();
  // formulário estruturado sobre GET .../draft: o texto e a última checagem já vêm preenchidos; o resto do rascunho é só leitura
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue('Banco Gama reduz anuidade do cartão (Fábrica)');
  await expect(page.getByLabel('Provedor da checagem')).toHaveValue('anthropic');
  await expect(page.getByLabel('Veredito da afirmação 1')).toHaveValue('pass');
  await page.getByText('Campos do rascunho que seguem como estão').click();
  await expect(page.getByText('banco-gama-reduz-anuidade-fabrica')).toBeVisible();
  await expect(page.getByText('openai (prompt e2e)')).toBeVisible();

  // validações locais dizem o campo; o Backend recusa checagem do MESMO provedor do redator
  await page.getByLabel('fatos').check();
  await page.getByLabel('Provedor da checagem').fill('');
  await enviar(page, page.getByRole('button', { name: 'Emitir recibo da correção' }));
  await expect(page.locator('main .st-alert.err').filter({ hasText: 'provedor' }).first()).toBeVisible();
  await page.getByLabel('Provedor da checagem').fill('openai');
  await page.getByLabel('fatos').check();
  await enviar(page, page.getByRole('button', { name: 'Emitir recibo da correção' }));
  await expect(page.locator('main .st-alert.err').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publicar correção' })).toBeDisabled();

  // texto corrigido + checagem de outro provedor
  await page.getByLabel('Título', { exact: true }).fill('Banco Gama reduz anuidade do cartão de crédito (Fábrica)');
  await page.getByLabel('Corpo (sem o bloco').fill(String(draft.body).replace('O Banco Gama reduziu a anuidade do cartão.', 'O Banco Gama reduziu a anuidade do cartão de crédito.'));
  await page.getByLabel('Texto da afirmação 1').fill('O Banco Gama reduziu a anuidade do cartão de crédito.');
  await expect(page.locator('[data-afirmacao="c1"]')).toHaveAttribute('data-alterada', 'sim');
  await page.getByLabel('Provedor da checagem').fill('anthropic');
  await page.getByLabel('Veredito da afirmação 1').selectOption('pass');
  await page.getByLabel('fatos').check();
  await enviar(page, page.getByRole('button', { name: 'Emitir recibo da correção' }));
  await sucesso(page, 'Recibo da versão corrigida');
  await expect(page.getByRole('button', { name: 'Publicar correção' })).toBeEnabled();
  await expect(page.getByLabel('Título', { exact: true })).toHaveValue(/cartão de crédito/); // o que foi digitado fica entre os passos

  await enviar(page, page.getByRole('button', { name: 'Publicar correção' }));
  await sucesso(page, 'Correção publicada');
  await expect(page.locator('form[data-publicado="sim"]')).toBeVisible();

  const depois = (await api(context, 'GET', `/api/materias/${articleId}`)).body.data as { status: string; versao: number; corpo: string };
  expect(depois.status).toBe('corrigido');
  expect(depois.versao).toBeGreaterThan(1);
  expect(depois.corpo).toContain('cartão de crédito');
  expect(depois.corpo).toContain('Avisos:'); // o aviso do caso foi composto pelo sistema no corpo
});
