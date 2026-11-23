import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import path from 'node:path';

/**
 * Flash, Análises, Entrevistas e Opinião lidos da API pelo tipo da matéria (`tipo` em /api/publico/materias) e busca real em /busca.
 * O servidor MOCK (e2e/fake-api.mjs) imita o contrato: `tipo` filtra por tipoConteudo, `q` procura no título ou no resumo (até 100 caracteres).
 */
const SHOTS = path.resolve(import.meta.dirname, '..', 'screenshots', 'api');
test.skip(process.env.PORTAL_MODE !== 'api' || Boolean(process.env.PORTAL_API_DOWN), 'somente no modo api com a API no ar');

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#34877a"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/publico/midia/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
});

const PAGES = [
  { path: '/flash', h1: 'Loyalty Flash', only: 'foto de terceiro', others: ['ilustração conceitual e errata', 'imagem venceu', 'Entrevista de teste', 'Opinião de teste'] },
  { path: '/analises', h1: 'Análises', only: 'ilustração conceitual e errata', others: ['foto de terceiro', 'imagem venceu', 'Entrevista de teste', 'Opinião de teste'] },
  { path: '/entrevistas', h1: 'Entrevistas', only: 'Entrevista de teste', others: ['foto de terceiro', 'ilustração conceitual e errata', 'imagem venceu', 'Opinião de teste'] },
  { path: '/opiniao', h1: 'Opinião', only: 'Opinião de teste', others: ['foto de terceiro', 'ilustração conceitual e errata', 'imagem venceu', 'Entrevista de teste'] },
] as const;

test.describe('páginas por tipo de matéria', () => {
  for (const p of PAGES) {
    test(`${p.path}: só matérias do tipo, vindas da API, sem placeholder`, async ({ page }, info) => {
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.h1);
      const cards = page.locator('main article.ln-card');
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText(p.only);
      for (const o of p.others) await expect(page.getByText(o)).toHaveCount(0);
      // Nada de estado vazio nem de erro quando há matéria
      await expect(page.getByTestId('error-state')).toHaveCount(0);
      expect(await page.locator('main').innerText()).not.toMatch(/em breve|Nenhum(a)? .* publicad/i);
      await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-tipo-${p.path.slice(1)}.png`), fullPage: true });
    });
  }

  test('o navegador do portal pede o tipo ao servidor: tipo inexistente na API não vaza para outro tipo', async ({ request }) => {
    // Contrato do servidor MOCK (igual ao pedido ao Backend): valor inválido = 400 VALIDATION_ERROR
    const base = `http://localhost:${Number(process.env.PORTAL_PORT_BASE) ? Number(process.env.PORTAL_PORT_BASE) + 4 : 3104}`;
    expect((await request.get(`${base}/api/publico/materias?tipo=invalido`)).status()).toBe(400);
    const ok = await (await request.get(`${base}/api/publico/materias?tipo=flash`)).json();
    expect(ok.data.map((a: { slug: string }) => a.slug)).toEqual(['api-foto-terceiro']);
    expect(ok.total).toBe(1);
  });

  test('fake-api segue o contrato real do Backend em /materias (tipo vazio, q aparado, teto de 100, 400)', async ({ request }) => {
    const base = `http://localhost:${Number(process.env.PORTAL_PORT_BASE) ? Number(process.env.PORTAL_PORT_BASE) + 4 : 3104}`;
    const get = (qs: string) => request.get(`${base}/api/publico/materias?${qs}`);
    // tipo= vazio não é ignorado: 400, igual a tipo inválido (ft/backend-3)
    const vazio = await get('tipo=');
    expect(vazio.status()).toBe(400);
    expect((await vazio.json()).error.code).toBe('VALIDATION_ERROR');
    // q só com espaços: 400
    expect((await get('q=%20%20%20')).status()).toBe(400);
    // q com 100 caracteres e espaços nas pontas: a API apara antes do teto e aceita
    expect((await get(`q=${encodeURIComponent('  ' + 'a'.repeat(100) + '  ')}`)).status()).toBe(200);
    // 101 caracteres úteis: 400
    expect((await get(`q=${'a'.repeat(101)}`)).status()).toBe(400);
    // espaços nas pontas não mudam o resultado
    const a = await (await get('q=entrevista')).json();
    const b = await (await get(`q=${encodeURIComponent('  entrevista  ')}`)).json();
    expect(b.total).toBe(a.total);
    expect(a.total).toBeGreaterThan(0);
    // nenhum erro de validação usa 422
    for (const qs of ['tipo=', 'tipo=invalido', 'q=%20', `q=${'a'.repeat(101)}`]) expect((await get(qs)).status()).not.toBe(422);
  });

  test('axe nas quatro páginas', async ({ page }) => {
    test.setTimeout(120_000);
    for (const p of PAGES) {
      await page.goto(p.path);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
      expect(summary, `${p.path}: ${summary.join(' ; ')}`).toEqual([]);
    }
  });

  test('página fora do alcance não quebra e não vira erro', async ({ page }) => {
    const res = await page.goto('/flash?page=9');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Loyalty Flash');
    await expect(page.getByTestId('error-state')).toHaveCount(0);
  });
});

test.describe('busca real', () => {
  test('acha pelo título, com acento e sem diferenciar maiúsculas, e mostra a contagem e os cards', async ({ page }, info) => {
    await page.goto('/busca?q=OPINIÃO');
    await expect(page.getByTestId('result-count')).toContainText('1 resultado');
    await expect(page.locator('main article.ln-card')).toHaveCount(1);
    await expect(page.locator('main article.ln-card').first()).toContainText('Opinião de teste');
    await expect(page.getByRole('searchbox', { name: 'Buscar no portal' })).toHaveValue('OPINIÃO');
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-busca-resultado.png`), fullPage: true });
  });

  test('o formulário busca de verdade (GET /busca?q=) e devolve resultados da API', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/busca');
    await expect(page.getByText('Digite um termo para buscar')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Buscar no portal' }).fill('entrevista');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/busca\?q=entrevista/);
    await expect(page.getByTestId('result-count')).toContainText('1 resultado');
    await expect(page.getByRole('link', { name: /Entrevista de teste/ }).first()).toBeVisible();
  });

  test('termo longo (acima de 100 caracteres) é cortado: a API não recusa e a página não vira erro', async ({ page }) => {
    await page.goto(`/busca?q=${'a'.repeat(150)}`);
    await expect(page.getByTestId('error-state')).toHaveCount(0);
    await expect(page.getByText(/Nenhum resultado para/)).toBeVisible();
  });

  test('caracteres especiais (%, _, aspas, <script>) não geram erro nem executam nada', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    for (const q of ['100%', 'a_b', '"aspas"', '<script>alert(1)</script>', '%%%']) {
      const res = await page.goto(`/busca?q=${encodeURIComponent(q)}`);
      expect(res?.status(), q).toBe(200);
      await expect(page.getByTestId('error-state'), q).toHaveCount(0);
      await expect(page.getByText(/Nenhum resultado para/), q).toBeVisible();
    }
    expect(dialogs).toEqual([]);
  });

  test('a busca é noindex e a página de resultado não indexa', async ({ page }) => {
    await page.goto('/busca?q=venceu');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});
