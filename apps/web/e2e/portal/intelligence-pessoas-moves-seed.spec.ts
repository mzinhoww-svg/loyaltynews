import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Rotas de pessoas e Moves contra a SEED REAL v3, com a flag `intelligencePessoas` desligada (FAKE_API_INTEL=seed).
 *
 * Lacuna coberta: o intelligence-seed-v3.spec.ts prova o bloco de pessoas dentro do perfil da empresa e o a11y-dados
 * prova /intelligence/empresas, o perfil e /moves; nenhum dos dois abria /intelligence, /intelligence/pessoas nem
 * /intelligence/pessoas/:id com a seed. Sem isso, uma página que inventasse pessoa/cargo com a flag desligada não
 * reprovava.
 *
 * A seed não tem pessoa nem Move: a API responde `disponivel: false` com `data: []`, e a tela precisa dizer isso sem
 * linha fantasma, sem "em breve" e sem cargo. Id desconhecido no formato UUID é 404 de verdade.
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const intel = process.env.PORTAL_API_INTEL ?? '';
const BASE = Number(process.env.PORTAL_PORT_BASE) || 0;
// O fake-api sobe na porta base+4 (e2e/portal.config.ts); o `request` fala com ele, não com o portal.
const API = `http://127.0.0.1:${BASE ? BASE + 4 : 3104}`;
const PESSOAS = '/api/publico/intelligence/pessoas';
const DESCONHECIDA = '10000000-0000-4000-8000-0000000000fe';

test.describe('seed v3: pessoas e Moves com a flag desligada', () => {
  test.skip(mode !== 'api' || intel !== 'seed', 'roda com PORTAL_MODE=api PORTAL_API_INTEL=seed');

  test('HTTP: pessoas responde 200 com disponivel=false e nenhum item', async ({ request }) => {
    const res = await request.get(`${API}${PESSOAS}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ data: [], total: 0, disponivel: false });
  });

  test('HTTP: pessoa desconhecida no formato UUID responde 404', async ({ request }) => {
    const res = await request.get(`${API}${PESSOAS}/${DESCONHECIDA}`);
    expect(res.status()).toBe(404);
  });

  test('lista de pessoas: estado honesto, sem linha fantasma, sem cargo e sem "em breve"', async ({ page }) => {
    const res = await page.goto('/intelligence/pessoas');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Pessoas' })).toBeVisible();
    await expect(page.getByText('Ainda não há perfis publicados')).toBeVisible();
    // Nenhum card, contagem ou link de pessoa: com a flag desligada não há o que publicar.
    await expect(page.getByTestId('people-list')).toHaveCount(0);
    await expect(page.getByTestId('person-card-link')).toHaveCount(0);
    await expect(page.getByTestId('people-count')).toHaveCount(0);
    // Nem promessa de futuro, nem cargo/card de pessoa sem a flag.
    await expect(page.getByText(/em breve/i)).toHaveCount(0);
    await expect(page.getByText(/validado em/i)).toHaveCount(0);
  });

  test('perfil de pessoa: id desconhecido dá 404 com a página da marca', async ({ page }) => {
    const res = await page.goto(`/intelligence/pessoas/${DESCONHECIDA}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
  });

  test('Moves: 200 com o vazio honesto, sem contagem inventada', async ({ page }) => {
    const res = await page.goto('/moves');
    expect(res?.status()).toBe(200);
    await expect(page.getByText('Ainda não há Moves publicados')).toBeVisible();
    await expect(page.getByTestId('moves-list')).toHaveCount(0);
    await expect(page.getByTestId('moves-empty-withheld')).toHaveCount(0);
    await expect(page.getByText(/Existe[s]? \d+ movimentaç/)).toHaveCount(0);
  });

  test('axe em 390 e 1280: 0 serious/critical em /intelligence, /intelligence/pessoas e no 404 de pessoa', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'a largura é fixada em 390 e 1280 aqui');
    test.setTimeout(120_000);
    const rotas = [
      { path: '/intelligence', status: 200 },
      { path: '/intelligence/pessoas', status: 200 },
      { path: `/intelligence/pessoas/${DESCONHECIDA}`, status: 404 },
    ];
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const rota of rotas) {
        const res = await page.goto(rota.path);
        expect(res?.status(), `${width}px ${rota.path}`).toBe(rota.status);
        await expect(page.locator('h1')).toBeVisible();
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        console.log(`axe seed ${width}px ${rota.path}: ${graves.length} serious/critical de ${r.violations.length} violação(ões)`);
        expect(graves.map((v) => `${v.id} (${v.nodes.length} nó(s))`), `${width}px ${rota.path}`).toEqual([]);
      }
    }
  });
});
