import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Intelligence por ambiente, contra as rotas REAIS e a resolução de flags de runtime (ADR-022), sem setFlag de teste:
 *  - production (intelligencePessoas com production: null): pessoas, cargos e Moves indisponíveis com estado honesto, perfis 404,
 *    nenhum nome de pessoa no HTML nem na API; empresas e vínculos continuam.
 *  - staging (LN_FLAGS_ON=intelligencePessoas, DP-38): pessoas e cargos declarados aparecem; o "a confirmar" nunca.
 * Seed real (lib/studio/e2e-backend.e2e.mock.ts → seedIntelligence): Alfa e Beta (parceria); Ana Souza e Bruno Lima (declarados);
 * Carla Dias (só fonte secundária). Nomes com prefixo MOCK (dados de teste).
 */
test.describe.configure({ mode: 'serial' });
const ambiente = process.env.PORTAL_REAL_ENV === 'staging' ? 'staging' : 'production';
const NOMES = ['MOCK Ana Souza', 'MOCK Bruno Lima', 'MOCK Carla Dias'];
let ids: { alfa: string; beta: string; pessoa: string; bruno: string; carla: string };

async function axe(page: Page) {
  await page.waitForLoadState('load');
  await expect.poll(() => page.title()).not.toBe('');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const s = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(s, s.join('\n')).toEqual([]);
}
async function semNomes(texto: string, onde: string) {
  for (const n of NOMES) expect(texto, `${onde} não pode conter "${n}"`).not.toContain(n);
}
const html = async (page: Page, rota: string) => {
  const r = await page.goto(rota);
  return { status: r?.status(), corpo: await page.content() };
};
async function semear(request: APIRequestContext) {
  const r = await request.get('/api/e2e/login?seed=intelligence');
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}

test.beforeAll(async ({ request }) => {
  ids = await semear(request);
});

test('flags de runtime: o /api/health mostra o estado do ambiente', async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  const flags: string[] = h.flags ?? [];
  if (ambiente === 'production') expect(flags).not.toContain('intelligencePessoas');
  else expect(flags).toContain('intelligencePessoas');
});

test('empresas continuam nos dois ambientes (lista, perfil e vínculo com fonte)', async ({ page }) => {
  await page.goto('/intelligence/empresas');
  await expect(page.getByTestId('company-list')).toContainText('MOCK Alfa Fidelidade S.A.');
  await page.goto(`/intelligence/empresas/${ids.alfa}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('MOCK Alfa Fidelidade S.A.');
  await expect(page.getByTestId('relations')).toContainText('MOCK Beta Cartões Ltda');
  await axe(page);
});

test.describe('production: pessoas indisponíveis, sem vazar nome', () => {
  test.skip(ambiente !== 'production', 'só com PORTAL_REAL_ENV=production');

  test('API: listas vazias com disponivel:false; perfil e Move 404; nenhum nome', async ({ request }) => {
    for (const rota of ['/api/publico/intelligence/pessoas', '/api/publico/intelligence/moves', `/api/publico/intelligence/pessoas?empresa=${ids.alfa}`]) {
      const r = await request.get(rota);
      expect(r.status(), rota).toBe(200);
      const txt = await r.text();
      expect(JSON.parse(txt), rota).toEqual({ data: [], total: 0, disponivel: false });
      await semNomes(txt, rota);
    }
    for (const rota of [`/api/publico/intelligence/pessoas/${ids.pessoa}`, `/api/publico/intelligence/pessoas/${ids.bruno}`]) {
      const r = await request.get(rota);
      expect(r.status(), rota).toBe(404);
      await semNomes(await r.text(), rota);
    }
    const emp = await request.get(`/api/publico/intelligence/empresas/${ids.alfa}`);
    const ej = await emp.json();
    expect(ej.data.pessoas).toEqual({ disponivel: false, itens: [] });
    await semNomes(JSON.stringify(ej), 'detalhe da empresa');
  });

  test('páginas: vazio honesto (não erro), perfis 404 e nenhum nome no HTML', async ({ page }) => {
    for (const [rota, texto] of [
      ['/intelligence/pessoas', 'Em breve: primeiros perfis verificados'],
      ['/moves', 'Em breve: primeiras movimentações confirmadas'],
    ] as const) {
      const r = await html(page, rota);
      expect(r.status, rota).toBe(200);
      await expect(page.getByText(texto), rota).toBeVisible();
      await expect(page.getByTestId('error-state'), rota).toHaveCount(0);
      await semNomes(r.corpo, rota);
      await axe(page);
    }
    for (const id of [ids.pessoa, ids.bruno, ids.carla]) {
      const r = await html(page, `/intelligence/pessoas/${id}`);
      expect(r.status, `perfil ${id}`).toBe(404);
      await semNomes(r.corpo, `perfil ${id}`);
    }
    const emp = await html(page, `/intelligence/empresas/${ids.alfa}`);
    await expect(page.getByText('Nenhum cargo declarado com fonte oficial foi publicado para esta empresa')).toBeVisible();
    await expect(page.getByTestId('company-people')).toHaveCount(0);
    await semNomes(emp.corpo, 'página da empresa');
    const hub = await html(page, '/intelligence');
    await expect(page.getByTestId('count-pessoas')).toHaveText('Cadastros verificados: em breve');
    await semNomes(hub.corpo, 'hub');
  });
});

test.describe('staging: pessoas aparecem (DP-38)', () => {
  test.skip(ambiente !== 'staging', 'só com PORTAL_REAL_ENV=staging');

  test('API e páginas: declarados aparecem; "a confirmar" nunca', async ({ page, request }) => {
    const pj = await (await request.get('/api/publico/intelligence/pessoas')).json();
    expect(pj.disponivel).toBe(true);
    const nomes = pj.data.map((p: { nome: string }) => p.nome);
    expect(nomes).toEqual(expect.arrayContaining(['MOCK Ana Souza', 'MOCK Bruno Lima']));
    expect(nomes).not.toContain('MOCK Carla Dias');
    await page.goto('/intelligence/pessoas');
    await expect(page.getByTestId('people-list')).toContainText('MOCK Ana Souza');
    await expect(page.getByTestId('people-list')).not.toContainText('Carla');
    await axe(page);
    await page.goto(`/intelligence/pessoas/${ids.pessoa}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('MOCK Ana Souza');
    await expect(page.getByTestId('current-roles')).toContainText('Diretora de CRM');
    expect((await page.goto(`/intelligence/pessoas/${ids.carla}`))?.status()).toBe(404);
    await page.goto(`/intelligence/empresas/${ids.alfa}`);
    await expect(page.getByTestId('company-people')).toContainText('MOCK Bruno Lima');
  });
});
