import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrar, enviar, semearFabrica } from './helpers';

// Creative studio (Studio 3): prévia de card por template, salvar, revisão (quem criou não aprova), rejeição com motivo, download do PNG e RBAC. Nada publica.
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const resumo = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(resumo, resumo.join('\n')).toEqual([]);
}

test.describe('Creative studio', () => {
  test.describe.configure({ mode: 'serial' });
  let articleId = '';

  test('vazio, prévia, recusa do template, salvar (idempotente) e download do PNG; axe', async ({ page, context }) => {
    await entrar(context, 'cre', 'editor');
    articleId = await semearFabrica(context);
    await page.goto('/studio/creative');
    await expect(page.getByRole('heading', { level: 1, name: 'Creative studio' })).toBeVisible();
    await expect(page.getByTestId('distribuicao')).toContainText('desligada');
    await expect(page.locator('[data-vazio="cards"]')).toBeVisible();

    // análise em matéria que não é autoral: o Backend recusa e a tela mostra como veio
    await page.getByLabel('Matéria').selectOption(articleId);
    await page.getByLabel('Template').selectOption('analise');
    await enviar(page, page.getByRole('button', { name: 'Ver prévia' }));
    await expect(page.getByTestId('previa-recusa')).toContainText(/autoral/i);
    await expect(page.getByRole('button', { name: 'Salvar card em rascunho' })).toHaveCount(0);

    await page.getByLabel('Template').selectOption('materia');
    await enviar(page, page.getByRole('button', { name: 'Ver prévia' }));
    const previa = page.getByTestId('previa');
    await expect(previa.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml;base64,/);
    expect(((await previa.locator('img').getAttribute('alt')) ?? '').length).toBeGreaterThan(0);
    await expect(previa).toContainText('1200×627');
    await semViolacoes(page);

    // prévia não grava nada
    await page.goto('/studio/creative');
    await expect(page.locator('[data-vazio="cards"]')).toBeVisible();

    await page.goto(`/studio/creative?artigo=${encodeURIComponent(articleId)}&kind=materia&formato=linkedin_landscape`);
    await enviar(page, page.getByRole('button', { name: 'Salvar card em rascunho' }));
    await sucesso(page, 'Card salvo em rascunho.');
    await expect(page.locator('tr[data-card]')).toHaveCount(1);
    await expect(page.locator('tr[data-card]')).toHaveAttribute('data-estado', 'rascunho');

    // salvar de novo a mesma prévia não duplica
    await page.goto(`/studio/creative?artigo=${encodeURIComponent(articleId)}&kind=materia&formato=linkedin_landscape`);
    await enviar(page, page.getByRole('button', { name: 'Salvar card em rascunho' }));
    await sucesso(page, 'já existia');
    await expect(page.locator('tr[data-card]')).toHaveCount(1);

    // download do PNG: arquivo real, como anexo
    const href = (await page.getByRole('link', { name: /^Baixar PNG/ }).getAttribute('href'))!;
    const png = await page.request.get(href);
    expect(png.status()).toBe(200);
    expect(png.headers()['content-type']).toBe('image/png');
    expect(png.headers()['content-disposition']).toMatch(/^attachment; filename="[a-z0-9-]+\.png"$/);
    const bytes = await png.body();
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    await semViolacoes(page);
  });

  test('revisão: editor envia e não aprova; editor-chefe aprova; rejeitar exige motivo', async ({ page, context }) => {
    await entrar(context, 'cre', 'editor');
    await page.goto('/studio/creative');
    const id = (await page.locator('tr[data-card]').first().getAttribute('data-card'))!;
    await enviar(page, page.getByRole('button', { name: `Enviar para revisão ${id}` }));
    await sucesso(page, 'em revisao');
    await expect(page.locator(`tr[data-card="${id}"]`)).toHaveAttribute('data-estado', 'em_revisao');
    await expect(page.getByRole('button', { name: `Aprovar ${id}` })).toHaveCount(0); // editor não aprova

    // segundo card (quadrado) para a rejeição
    await page.goto(`/studio/creative?artigo=${encodeURIComponent(articleId)}&kind=materia&formato=square`);
    await expect(page.getByTestId('previa')).toContainText('1080×1080');
    await enviar(page, page.getByRole('button', { name: 'Salvar card em rascunho' }));
    await sucesso(page, 'Card salvo em rascunho.');
    const id2 = (await page.locator('tr[data-card][data-estado="rascunho"]').first().getAttribute('data-card'))!;
    await enviar(page, page.getByRole('button', { name: `Enviar para revisão ${id2}` }));

    await entrar(context, 'chefe3', 'editor_chefe');
    await page.goto('/studio/creative');
    await enviar(page, page.getByRole('button', { name: `Aprovar ${id}` }));
    await sucesso(page, 'aprovado');
    await expect(page.locator(`tr[data-card="${id}"]`)).toHaveAttribute('data-estado', 'aprovado');
    await expect(page.locator(`tr[data-card="${id}"]`).getByRole('button')).toHaveCount(0); // aprovado é final

    await enviar(page, page.getByRole('button', { name: `Rejeitar ${id2}` }));
    await erro(page, /motivo/i);
    await page.getByLabel(`Motivo para rejeitar ${id2}`).fill('Manchete desatualizada');
    await enviar(page, page.getByRole('button', { name: `Rejeitar ${id2}` }));
    await sucesso(page, 'rejeitado');
    await expect(page.locator(`tr[data-card="${id2}"]`)).toContainText('motivo: Manchete desatualizada');

    // filtro por estado e filtro vazio
    await page.goto('/studio/creative?estado=aprovado');
    await expect(page.locator('tr[data-card]')).toHaveCount(1);
    await page.goto('/studio/creative?estado=em_revisao');
    await expect(page.locator('[data-vazio="filtro"]')).toBeVisible();
  });

  test('RBAC: revisor só lê; comercial e leitor não entram; PNG protegido', async ({ page, context, request }) => {
    await entrar(context, 'rev3', 'revisor');
    await page.goto(`/studio/creative?artigo=${encodeURIComponent(articleId)}&kind=materia&formato=linkedin_landscape`);
    await expect(page.getByTestId('previa')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar card em rascunho' })).toHaveCount(0);
    await expect(page.locator('tr[data-card] form')).toHaveCount(0);
    const href = (await page.getByRole('link', { name: /^Baixar PNG/ }).first().getAttribute('href'))!;

    for (const papel of ['comercial', 'leitor']) {
      await entrar(context, `x-${papel}`, papel);
      await page.goto('/studio/creative');
      await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    }
    const anonimo = await request.get(href, { maxRedirects: 0 });
    expect(anonimo.headers()['content-type'] ?? '').not.toContain('image/png');
  });
});
