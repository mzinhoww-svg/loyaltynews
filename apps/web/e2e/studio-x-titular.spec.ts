import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { api, entrar, enviar } from './helpers';

// Fila de pedidos do titular (DP-38, Studio 2) sobre as rotas reais: entrada pública POST /api/publico/correcoes (Backend 2)
// e fila /api/studio/correcoes. Pedidos com marcador próprio (MARCA) e IP próprio por envio (limite de 5 por IP em 15 min).
test.describe.configure({ mode: 'serial' });

const MARCA = `e2e-studio2-${Date.now()}`;
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const ids: Record<'pessoa' | 'cargo' | 'move' | 'solto', string> = { pessoa: '', cargo: '', move: '', solto: '' };

let ipSeq = 10;
async function pedir(req: APIRequestContext, chave: keyof typeof ids, url: string, tipo: 'correcao' | 'remocao') {
  const r = await req.post('/api/publico/correcoes', {
    headers: { 'x-forwarded-for': `203.0.113.${ipSeq++}` },
    data: { nome: `MOCK Titular ${chave}`, contato: `${chave}.${MARCA}@example.org`, url, tipo, texto: `${MARCA} ${chave}: o cargo exibido está desatualizado.` },
  });
  expect(r.status(), `entrada pública ${chave}`).toBe(202);
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  await entrar(ctx, 'tit-chefe', 'editor_chefe'); // o login monta o backend de e2e (sem ele a entrada pública responde 503)
  await pedir(ctx.request, 'pessoa', 'https://loyalty.example/intelligence/pessoas/p-e2e-1', 'remocao');
  await pedir(ctx.request, 'cargo', 'https://loyalty.example/intelligence/pessoas/p-e2e-1?cargo=c-e2e-9', 'correcao');
  await pedir(ctx.request, 'move', 'https://loyalty.example/intelligence/moves/m-e2e-2', 'correcao');
  await pedir(ctx.request, 'solto', 'https://loyalty.example/noticia/qualquer', 'correcao');
  await entrar(ctx, 'tit-chefe', 'editor_chefe');
  const lista = await api(ctx as never, 'GET', '/api/studio/correcoes');
  expect(lista.status).toBe(200);
  for (const it of (lista.body as { items: { id: string; resumo: string }[] }).items) {
    for (const k of Object.keys(ids) as (keyof typeof ids)[]) if (it.resumo.includes(`${MARCA} ${k}:`)) ids[k] = it.id;
  }
  expect(Object.values(ids).every(Boolean), JSON.stringify(ids)).toBe(true);
  await ctx.close();
});

test('RBAC: editor e revisor não entram (tela FORBIDDEN e rota 403)', async ({ page, context }) => {
  for (const [u, papel] of [['tit-ed', 'editor'], ['tit-rev', 'revisor']] as const) {
    await entrar(context, u, papel);
    await page.goto('/studio/correcoes-titular');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    expect((await api(context, 'GET', '/api/studio/correcoes')).status).toBe(403);
    expect((await api(context, 'GET', `/api/studio/correcoes/${ids.pessoa}`)).status).toBe(403);
  }
});

test('fila: prazo interno, alvo da URL, estado e responsável; sem dado pessoal na lista; axe', async ({ page, context }) => {
  await entrar(context, 'tit-chefe', 'editor_chefe');
  await page.goto('/studio/correcoes-titular');
  await expect(page.getByRole('heading', { level: 1, name: 'Pedidos do titular' })).toBeVisible();
  await expect(page.locator('[data-aviso="prazo-interno"]')).toContainText('não um prazo legal');
  const linha = page.locator(`[data-pedido="${ids.cargo}"]`);
  await expect(linha).toContainText('Cargo c-e2e-9');
  await expect(linha).toContainText('Recebido');
  await expect(linha).toContainText('sem responsável');
  await expect(linha).toHaveAttribute('data-prazo', 'no_prazo');
  await expect(page.locator(`[data-pedido="${ids.solto}"]`)).toContainText('não identificado na URL');
  await expect(page.getByText(`cargo.${MARCA}@example.org`)).toHaveCount(0); // contato só no detalhe
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test('detalhe: nome, contato e texto; a consulta entra na trilha; atribuir a mim', async ({ page, context }) => {
  await entrar(context, 'tit-chefe', 'editor_chefe');
  await page.goto(`/studio/correcoes-titular/${ids.pessoa}`);
  await expect(page.locator('[data-titular-nome]')).toHaveText('MOCK Titular pessoa');
  await expect(page.getByText(`pessoa.${MARCA}@example.org`)).toBeVisible();
  await expect(page.locator('[data-texto]')).toContainText(MARCA);
  await expect(page.getByRole('link', { name: 'conferir no Entity Intelligence' })).toHaveAttribute('href', '/studio/entidades/pessoa/p-e2e-1');
  await expect(page.locator('[data-auditoria]')).toContainText('pedido consultado');
  await enviar(page, page.getByRole('button', { name: 'Atribuir a mim' }));
  await sucesso(page, 'atribuído a você');
  await expect(page.locator('[data-responsavel]')).toHaveText('você');
  await expect(page.getByRole('heading', { level: 2, name: 'Em análise' })).toBeVisible();
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
});

test('remover a pessoa: pede confirmação; registra a decisão e diz que o efeito público está pendente', async ({ page, context }) => {
  await entrar(context, 'tit-chefe', 'editor_chefe');
  await page.goto(`/studio/correcoes-titular/${ids.pessoa}`);
  const form = page.getByRole('form', { name: 'Remover a pessoa da exibição' });
  await enviar(page, form.getByRole('button', { name: 'Registrar remoção' }));
  await erro(page, 'Marque a confirmação');
  await page.getByRole('form', { name: 'Remover a pessoa da exibição' }).getByRole('checkbox').check();
  await page.getByRole('form', { name: 'Remover a pessoa da exibição' }).getByLabel('Motivo (opcional)').fill('Titular comprovou que deixou a empresa.');
  await enviar(page, page.getByRole('form', { name: 'Remover a pessoa da exibição' }).getByRole('button', { name: 'Registrar remoção' }));
  await sucesso(page, 'Decisão registrada e auditada');
  await expect(page.locator('[data-efeito="pendente"]')).toContainText('Efeito na exibição pública: pendente.');
  await expect(page.getByText(/removido do portal/i)).toHaveCount(0);
  await expect(page.getByRole('form', { name: 'Negar' })).toHaveCount(0); // decidido: sem novas ações
  // segunda decisão pela rota: 409
  const again = await api(context, 'POST', `/api/studio/correcoes/${ids.pessoa}/decidir`, { acao: 'negar', motivo: 'tarde demais' });
  expect(again.status).toBe(409);
});

test('corrigir com campos e negar com motivo (admin)', async ({ page, context }) => {
  await entrar(context, 'tit-adm', 'admin');
  await page.goto(`/studio/correcoes-titular/${ids.cargo}`);
  const corrigir = page.getByRole('form', { name: 'Corrigir' });
  await enviar(page, corrigir.getByRole('button', { name: 'Registrar correção' }));
  await erro(page, 'pelo menos um campo');
  await page.getByLabel('Campo 1', { exact: true }).fill('cargo');
  await page.getByLabel('Valor corrigido 1', { exact: true }).fill('Diretora de CRM');
  await enviar(page, page.getByRole('form', { name: 'Corrigir' }).getByRole('button', { name: 'Registrar correção' }));
  await sucesso(page, 'Decisão registrada');
  await expect(page.getByRole('heading', { level: 2, name: 'Corrigido (decisão registrada)' })).toBeVisible();
  await expect(page.locator('[data-efeito="pendente"]')).toBeVisible();

  await page.goto(`/studio/correcoes-titular/${ids.move}`);
  await page.getByLabel('Motivo (obrigatório)').fill('O Move tem fonte oficial e está correto.');
  await enviar(page, page.getByRole('button', { name: 'Negar pedido' }));
  await sucesso(page, 'Decisão registrada');
  await expect(page.locator('[data-decisao="negado"]')).toContainText('nada muda na exibição pública');
  await expect(page.locator('[data-efeito="pendente"]')).toHaveCount(0);
  await expect(page.locator('[data-auditoria]')).toContainText('O Move tem fonte oficial');
});

test('filtro por estado e pedido inexistente 404', async ({ page, context }) => {
  await entrar(context, 'tit-chefe', 'editor_chefe');
  await page.goto('/studio/correcoes-titular?estado=negado');
  await expect(page.locator(`[data-pedido="${ids.move}"]`)).toBeVisible();
  await expect(page.locator(`[data-pedido="${ids.solto}"]`)).toHaveCount(0);
  await expect(page.locator('[data-pedido]:not([data-estado="negado"])')).toHaveCount(0);
  expect((await page.goto('/studio/correcoes-titular/nao-existe-123'))?.status()).toBe(404);
});
