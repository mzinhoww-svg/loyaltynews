import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { api, entrar, enviar } from './helpers';

// Leitura do piloto (Studio 2; PM-2026-11-23-C) sobre as rotas da Editorial (/api/studio/editorial/piloto, ft/editorial ccfb23c).
// Dados: dois artigos MOCK (sampleArticle) semeados; o mapa a1/a2 é fixado pela tela. Mapa e leitura são imutáveis: o spec roda em série e uma vez.
test.describe.configure({ mode: 'serial' });

const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const axe = async (page: Page) => {
  const r = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
};

test('antes do mapa: piloto ainda não executado, 10 matérias não geradas, critério visível, sem publicar; axe', async ({ page, context }) => {
  await entrar(context, 'pil-chefe', 'editor_chefe');
  await page.goto('/studio/piloto');
  await expect(page.getByRole('heading', { level: 1, name: 'Leitura do piloto' })).toBeVisible();
  await expect(page.locator('[data-estado="piloto-nao-executado"]')).toContainText('Piloto ainda não executado');
  await expect(page.locator('[data-aviso="criterio"]')).toContainText('0 fato de gravidade alta');
  await expect(page.locator('tr[data-materia][data-estado="nao_gerada"]')).toHaveCount(10);
  await expect(page.getByRole('button', { name: /publicar/i })).toHaveCount(0);
  await axe(page);
  await page.goto('/studio/piloto/a4');
  await expect(page.locator('[data-estado="piloto-nao-executado"]')).toContainText('a4');
  expect((await page.goto('/studio/piloto/a11'))?.status()).toBe(404);
});

test('RBAC: só o leitor 1 (admin ou editor-chefe) usa a tela; editor e revisor não entram', async ({ page, context }) => {
  for (const [u, papel] of [['pil-ed', 'editor'], ['pil-rev', 'revisor']] as const) {
    await entrar(context, u, papel);
    await page.goto('/studio/piloto');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  }
});

test('mapa: pede confirmação, liga a1 e a2 aos artigos MOCK e é imutável (409)', async ({ page, context }) => {
  const s = await context.request.get('/api/e2e/login?seed=piloto');
  expect(s.ok()).toBe(true);
  await entrar(context, 'pil-chefe', 'editor_chefe');
  await page.goto('/studio/piloto');
  await page.getByLabel('Artigo de a1', { exact: true }).fill('piloto-e2e-a1');
  await page.getByLabel('Artigo de a2', { exact: true }).fill('piloto-e2e-a2');
  await enviar(page, page.getByRole('button', { name: 'Fixar mapa' }));
  await erro(page, 'Marque a confirmação');
  await page.getByLabel('Artigo de a1', { exact: true }).fill('piloto-e2e-a1');
  await page.getByLabel('Artigo de a2', { exact: true }).fill('piloto-e2e-a2');
  await page.getByRole('form', { name: 'Fixar mapa do piloto' }).getByRole('checkbox').check();
  await enviar(page, page.getByRole('button', { name: 'Fixar mapa' }));
  await sucesso(page, 'Mapa fixado para a1, a2');
  await expect(page.locator('tr[data-materia="a1"]')).toHaveAttribute('data-estado', 'aguardando_leitura');
  await expect(page.locator('tr[data-materia="a1"]')).toContainText('ainda não registrou'); // a1 tem leitor 2
  await expect(page.locator('[data-estado="piloto-nao-executado"]')).toHaveCount(0);
  expect((await api(context, 'POST', '/api/studio/editorial/piloto/mapa', { a1: 'piloto-e2e-a2' })).status).toBe(409);
});

test('leitura de a1: texto ao lado das fontes; "aprovada" com fato alto é recusada; registrada fica definitiva; fechamento reprovado; axe', async ({ page, context }) => {
  await entrar(context, 'pil-chefe', 'editor_chefe');
  await page.goto('/studio/piloto/a1');
  await expect(page.locator('[data-coluna="texto"]')).toContainText('MOCK');
  await expect(page.locator('[data-coluna="fontes"] a').first()).toHaveAttribute('href', 'https://ri.mock.example/a');
  await expect(page.locator('[data-claim="c1"]')).toHaveAttribute('data-veredito', 'pass');
  await expect(page.getByRole('button', { name: /publicar/i })).toHaveCount(0);
  await axe(page);

  await page.getByLabel('Trecho').first().fill('afirmação MOCK');
  await page.locator('#tipo0').selectOption('valor');
  await page.locator('#evidencia0').selectOption('ev_1');
  for (const n of ['fatosNasEvidencias', 'tom', 'nadaInventado']) await page.locator(`input[name="${n}"]`).check();
  await page.locator('input[name="veredito"][value="aprovado"]').check();
  await enviar(page, page.getByRole('button', { name: 'Registrar leitura' }));
  await erro(page, 'não pode ser aprovada');

  await page.getByLabel('Trecho').first().fill('afirmação MOCK');
  await page.locator('#tipo0').selectOption('valor');
  await page.locator('#evidencia0').selectOption('ev_1');
  await page.locator('input[name="veredito"][value="bloqueado"]').check();
  await enviar(page, page.getByRole('button', { name: 'Registrar leitura' }));
  await sucesso(page, 'Leitura registrada e auditada: 1 fato(s) não suportado(s) (1 alta');
  await expect(page.locator('[data-leitura="1"]')).toContainText('bloqueada');
  await expect(page.getByRole('form', { name: 'Registrar leitura' })).toHaveCount(0); // definitiva
  const again = await api(context, 'POST', '/api/studio/editorial/piloto/a1/leitura', { leitor: 1, achados: [], checklist: { fatosNasEvidencias: true, tom: true, nadaInventado: true }, veredito: 'aprovado' });
  expect(again.status).toBe(409);

  await page.goto('/studio/piloto');
  await expect(page.locator('[data-criterio]')).toHaveAttribute('data-criterio', 'reprovado');
  await expect(page.locator('[data-total]')).toContainText('1 de 10 lidas');
  await expect(page.locator('tr[data-materia="a1"]')).toHaveAttribute('data-estado', 'leitor1_registrou');
});
