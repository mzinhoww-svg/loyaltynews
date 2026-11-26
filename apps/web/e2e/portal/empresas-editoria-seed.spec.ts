import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Empresa e editoria contra a SEED REAL v3 e o catálogo real de editorias (FAKE_API_INTEL=seed).
 *
 * Lacunas cobertas:
 * - /intelligence/empresas com filtro sem resultado: 200, estado honesto, nenhum card ou contagem inventada;
 * - /intelligence/empresas/:id com UUID inexistente: 404 de verdade, sem bloco de empresa vazio pendurado;
 * - /editoria/:slug que existe no catálogo e não tem matéria publicada: 200, sem lista fantasma e sem "em breve";
 * - /editoria/:slug fora do catálogo: 404.
 *
 * A premissa é conferida na API antes da tela (a seed não tem empresa com esse filtro; a editoria existe no catálogo e
 * tem 0 matérias), e o controle positivo em outra editoria prova que o vazio não é o servidor inteiro falhando.
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const intel = process.env.PORTAL_API_INTEL ?? '';
const BASE = Number(process.env.PORTAL_PORT_BASE) || 0;
// O fake-api sobe na porta base+4 (e2e/portal.config.ts); o `request` fala com ele, não com o portal.
const API = `http://127.0.0.1:${BASE ? BASE + 4 : 3104}`;
const EMPRESAS = '/api/publico/intelligence/empresas';
const SEM_EMPRESA = 'zzz-sem-empresa';
const EMPRESA_DESCONHECIDA = '10000000-0000-4000-8000-0000000000fd';
const EDITORIA_VAZIA = 'mercado';
const EDITORIA_COM_MATERIA = 'bancos';
const EDITORIA_DESCONHECIDA = 'nao-existe';

test.describe('seed v3: empresa e editoria sem conteúdo inventado', () => {
  test.skip(mode !== 'api' || intel !== 'seed', 'roda com PORTAL_MODE=api PORTAL_API_INTEL=seed');

  test('HTTP: filtro sem empresa devolve total 0 e pessoa/empresa desconhecida devolve 404', async ({ request }) => {
    const busca = await request.get(`${API}${EMPRESAS}?q=${SEM_EMPRESA}`);
    expect(busca.status()).toBe(200);
    expect(await busca.json()).toMatchObject({ data: [], total: 0 });

    const perfil = await request.get(`${API}${EMPRESAS}/${EMPRESA_DESCONHECIDA}`);
    expect(perfil.status()).toBe(404);
  });

  test('HTTP: a editoria vazia existe no catálogo com 0 matérias (e outra editoria tem matéria)', async ({ request }) => {
    const vazia = await request.get(`${API}/api/publico/materias?editoria=${EDITORIA_VAZIA}&limit=100`);
    expect(vazia.status()).toBe(200);
    expect((await vazia.json()) as { total: number }).toMatchObject({ data: [], total: 0 });

    // Controle positivo: o mesmo servidor entrega matéria em outra editoria, então o vazio é do dado, não do servidor.
    const comMateria = await request.get(`${API}/api/publico/materias?editoria=${EDITORIA_COM_MATERIA}&limit=100`);
    expect(comMateria.status()).toBe(200);
    expect(((await comMateria.json()) as { total: number }).total).toBeGreaterThan(0);
  });

  test('diretório: filtro sem resultado mostra estado honesto, sem card nem contagem inventada', async ({ page }) => {
    const res = await page.goto(`/intelligence/empresas?q=${SEM_EMPRESA}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Empresas' })).toBeVisible();
    // Não fixo a cópia do vazio: o Frontend Engineer está corrigindo o título do diretório na spec dele
    // (intelligence.spec.ts). Aqui a prova é estrutural: existe a saída do filtro, e nada é inventado.
    await expect(page.getByRole('link', { name: 'Ver todas as empresas' })).toBeVisible();
    await expect(page.getByTestId('company-list')).toHaveCount(0);
    await expect(page.getByTestId('company-card-link')).toHaveCount(0);
    await expect(page.getByTestId('directory-count')).toHaveCount(0);
    await expect(page.getByText(/Em breve/i)).toHaveCount(0);
  });

  test('perfil de empresa: UUID inexistente dá 404, sem bloco de empresa vazio pendurado', async ({ page }) => {
    const res = await page.goto(`/intelligence/empresas/${EMPRESA_DESCONHECIDA}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
    // O 404 não herda o estado de uma empresa sem relações: nada de vínculo, fonte ou data de coleta inventados.
    await expect(page.getByTestId('relations')).toHaveCount(0);
    await expect(page.getByText('Nenhum vínculo publicado')).toHaveCount(0);
    await expect(page.getByText(/Coletado em/)).toHaveCount(0);
  });

  test('editoria existente sem matéria: 200, texto honesto, sem lista fantasma e sem "em breve"', async ({ page }) => {
    const res = await page.goto(`/editoria/${EDITORIA_VAZIA}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText('Ainda não há matérias nesta editoria')).toBeVisible();
    // Nenhuma grade de matéria: o vazio é do dado, não uma lista quebrada.
    await expect(page.locator('div.pt-grid')).toHaveCount(0);
    await expect(page.getByText(/Em breve/i)).toHaveCount(0);
  });

  test('editoria fora do catálogo: 404 com a página da marca', async ({ page }) => {
    const res = await page.goto(`/editoria/${EDITORIA_DESCONHECIDA}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
  });

  test('axe em 390 e 1280: 0 serious/critical no diretório filtrado, no 404 de empresa e na editoria vazia', async ({ page }) => {
    test.skip(test.info().project.name === 'mobile', 'a largura é fixada em 390 e 1280 aqui');
    test.setTimeout(120_000);
    const rotas = [
      { path: `/intelligence/empresas?q=${SEM_EMPRESA}`, status: 200 },
      { path: `/intelligence/empresas/${EMPRESA_DESCONHECIDA}`, status: 404 },
      { path: `/editoria/${EDITORIA_VAZIA}`, status: 200 },
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
