import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { api, entrar, enviar } from './helpers';

// Excluir contato (lead) no CRM: confirmação antes de apagar, só comercial/admin, erro claro quando a rota recusa por falta de
// configuração, nunca sucesso sem o 204. Leads fictícios (@example.invalid) no banco de e2e; o spec apaga os que criar.

async function sal(context: BrowserContext, ligado: boolean) {
  const r = await context.request.get(`/api/e2e/login?sal=lead&on=${ligado ? 1 : 0}`);
  expect(r.ok(), `sal da trilha: ${r.status()}`).toBe(true);
}
async function criar(context: BrowserContext, nome: string): Promise<string> {
  const r = await api(context, 'POST', '/api/commercial/studio/leads', {
    nome, empresa: 'Empresa Fictícia da Exclusão', email: `${nome.toLowerCase().replace(/[^a-z]+/g, '-')}@example.invalid`,
    formatosInteresse: [], objetivo: 'teste de exclusão', optInNewsletter: false,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return (r.body as { id: string }).id;
}
const noBanco = async (context: BrowserContext, id: string) =>
  ((await api(context, 'GET', '/api/commercial/studio/leads')).body as { id: string }[]).some((l) => l.id === id);
const apagarPelaApi = async (context: BrowserContext, id: string) =>
  expect((await api(context, 'DELETE', `/api/commercial/studio/leads/${id}`)).status).toBe(204);
async function axe(page: Page, onde: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const graves = r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(graves, `${onde}\n${graves.join('\n')}`).toEqual([]);
}
const linha = (page: Page, nome: string) => page.getByRole('row', { name: new RegExp(nome) });
const painel = (page: Page) => page.locator('[data-confirmar-exclusao]');
const confirmar = (page: Page) => page.getByRole('button', { name: 'Excluir definitivamente' });

test.describe('Studio CRM: excluir contato', () => {
  test.describe.configure({ mode: 'serial' });
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    await sal(context, false); // volta ao padrão do e2e
    await context.close();
  });

  test('confirmação antes de apagar e Cancelar não apaga nada', async ({ page, context }) => {
    await entrar(context, 'excl-com', 'comercial');
    await sal(context, true);
    const id = await criar(context, 'Cancela Souza');
    const envios: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') envios.push(`${r.method()} ${r.url()}`);
    });

    await page.goto('/studio/crm');
    await expect(painel(page)).toHaveCount(0);
    await page.getByRole('link', { name: 'Excluir Cancela Souza' }).click();
    await expect(painel(page)).toBeVisible();
    await expect(painel(page)).toBeFocused();
    await expect(painel(page).getByRole('heading', { name: 'Excluir o contato Cancela Souza?' })).toBeVisible();
    await expect(painel(page)).toContainText('cancela-souza@example.invalid');
    await expect(painel(page)).toContainText('definitiva e não pode ser desfeita');
    await expect(painel(page)).toContainText('cadastrado direto no anunciante não é apagado por aqui');
    expect(page.url(), 'só o id vai na URL').not.toMatch(/Cancela|example\.invalid/);
    expect(await noBanco(context, id), 'abrir a confirmação não apaga').toBe(true);
    await axe(page, 'confirmação aberta');

    await painel(page).getByRole('link', { name: 'Cancelar' }).click();
    await expect(page).toHaveURL(/\/studio\/crm$/);
    await expect(painel(page)).toHaveCount(0);
    await expect(linha(page, 'Cancela Souza')).toBeVisible();
    expect(await noBanco(context, id)).toBe(true);
    expect(envios, 'cancelar não envia nada').toEqual([]);
    await apagarPelaApi(context, id);
  });

  test('500 LEAD_AUDIT_NOT_CONFIGURED: erro claro, sem sucesso, e o contato continua', async ({ page, context }) => {
    await entrar(context, 'excl-com', 'comercial');
    await sal(context, false);
    const id = await criar(context, 'Semsal Pereira');
    await page.goto('/studio/crm');
    await page.getByRole('link', { name: 'Excluir Semsal Pereira' }).click();
    await enviar(page, confirmar(page));
    const erro = page.locator('main .st-alert.err').filter({ hasText: 'NÃO foi excluído' });
    await expect(erro).toBeVisible();
    await expect(erro).toHaveAttribute('role', 'alert');
    await expect(erro).toBeFocused();
    await expect(erro).toContainText('Código: LEAD_AUDIT_NOT_CONFIGURED');
    await expect(page.locator('main .st-alert.ok')).toHaveCount(0);
    await expect(page.getByText('Contato excluído')).toHaveCount(0);
    expect(page.url()).not.toMatch(/Semsal|example\.invalid/);
    await expect(linha(page, 'Semsal Pereira')).toBeVisible();
    expect(await noBanco(context, id)).toBe(true);
    await axe(page, 'erro de configuração');
    await sal(context, true);
    await apagarPelaApi(context, id);
  });

  for (const [user, papel, nome] of [['excl-com', 'comercial', 'Apaga Comercial'], ['excl-adm', 'admin', 'Apaga Admin']] as const) {
    test(`${papel} confirma e o contato sai do CRM`, async ({ page, context }) => {
      await entrar(context, user, papel);
      await sal(context, true);
      const id = await criar(context, nome);
      await page.goto('/studio/crm?status=novo');
      await page.getByRole('link', { name: `Excluir ${nome}` }).click();
      await enviar(page, confirmar(page));
      await expect(page.locator('main .st-alert.ok')).toContainText('Contato excluído do CRM.');
      await expect(page.locator('main .st-alert.err')).toHaveCount(0);
      await expect(linha(page, nome)).toHaveCount(0);
      expect(page.url()).not.toMatch(/Apaga%20|example\.invalid/);
      expect(await noBanco(context, id)).toBe(false);
      await axe(page, 'depois de excluir');
      await page.goto('/studio/crm');
      await expect(linha(page, nome)).toHaveCount(0);
    });
  }

  test('quem não é comercial nem admin não vê a tela, e o envio da confirmação é recusado', async ({ page, context }) => {
    await entrar(context, 'excl-com', 'comercial');
    await sal(context, true);
    const id = await criar(context, 'Protegido Lima');
    for (const papel of ['editor_chefe', 'editor', 'revisor', 'leitor']) {
      await entrar(context, `excl-${papel.replace('_', '-')}`, papel);
      await page.goto(`/studio/crm?excluir=${id}`);
      await expect(page, papel).toHaveURL(/motivo=FORBIDDEN/);
      await expect(confirmar(page)).toHaveCount(0);
      expect((await api(context, 'DELETE', `/api/commercial/studio/leads/${id}`)).status, papel).toBe(403);
    }
    // confirmação aberta pelo comercial e enviada depois que a sessão do navegador passou a ser de um editor: a ação recusa
    await entrar(context, 'excl-com', 'comercial');
    await page.goto(`/studio/crm?excluir=${id}`);
    await expect(painel(page)).toBeVisible();
    await entrar(context, 'excl-editor', 'editor');
    await confirmar(page).click();
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    await entrar(context, 'excl-com', 'comercial');
    expect(await noBanco(context, id)).toBe(true);
    await apagarPelaApi(context, id);
  });

  test('confirmação antiga: o id passou a ser de outro contato, ou já não existe, e nada mais é apagado', async ({ page, context }) => {
    await entrar(context, 'excl-com', 'comercial');
    await sal(context, true);
    const antigo = await criar(context, 'Antigo Ramos');
    await page.goto(`/studio/crm?excluir=${antigo}`);
    await expect(painel(page)).toBeVisible();
    // outra pessoa exclui e um contato novo herda o mesmo id (o domínio reaproveita o maior número)
    await apagarPelaApi(context, antigo);
    const novo = await criar(context, 'Novo Ramos');
    expect(novo).toBe(antigo);
    await enviar(page, confirmar(page));
    await expect(page.locator('main .st-alert.err')).toContainText('Nada foi apagado');
    await expect(page.locator('main .st-alert.ok')).toHaveCount(0);
    expect(await noBanco(context, novo)).toBe(true);

    await apagarPelaApi(context, novo);
    await page.goto(`/studio/crm?excluir=${novo}`);
    await expect(painel(page)).toHaveCount(0);
    await expect(page.locator('[data-exclusao-indisponivel]')).toContainText('Nada foi apagado agora');
    await axe(page, 'contato indisponível');
  });
});
