import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { aguardarHidratacao, focarELer } from './hidratacao';

/**
 * PORTAL_MODE=api: o portal lê as rotas públicas de um servidor MOCK (e2e/fake-api.mjs) no formato real do Backend.
 * Cobre imagem pela URL pública com rótulo/crédito, imagem: null e o aviso de correção em /noticia/{slug}.
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const SHOTS = path.resolve(import.meta.dirname, '..', 'screenshots', 'api');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#34877a"/></svg>';

test.describe('matéria via API pública', () => {
  test.skip(mode !== 'api', 'somente no modo api');

  test.beforeEach(async ({ page }) => {
    // A rota pública de mídia é do Backend (com banco); aqui devolve um SVG só para a imagem carregar.
    await page.route('**/api/publico/midia/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
  });

  test('ilustração conceitual: URL pública, rótulo, crédito institucional, texto alternativo e aviso de correção', async ({ page }, info) => {
    await page.goto('/noticia/api-ilustracao-corrigida');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ilustração conceitual e errata');
    const fig = page.getByTestId('article-image');
    await expect(fig.locator('img')).toHaveAttribute('src', '/api/publico/midia/ilustracao-1');
    await expect(fig.locator('img')).toHaveAttribute('alt', /^Ilustração conceitual/);
    await expect(page.getByTestId('image-label')).toHaveText('Ilustração conceitual');
    await expect(fig.locator('figcaption')).toContainText('Crédito: Loyalty News');
    // D09: nada sobre IA, modelo ou ferramenta na página.
    expect(await page.locator('main').innerText()).not.toMatch(/gerad[ao] por IA|modelo|provider|prompt/i);
    // Imagem realmente carregada pela URL pública.
    await expect.poll(() => fig.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);

    const notice = page.getByTestId('correction-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Matéria corrigida');
    await expect(notice).toContainText('Corrigimos o valor citado (MOCK).');
    await expect(notice).toContainText('Segunda linha do aviso.');
    // Blocos Avisos/Fontes do corpo não aparecem duplicados no texto corrido.
    await expect(page.locator('.pt-body')).not.toContainText('Avisos:');
    await expect(page.locator('.pt-body')).not.toContainText('Fontes:');
    await expect(page.getByRole('heading', { name: 'Subtítulo de teste' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'fonte.example' })).toHaveAttribute('href', 'https://www.fonte.example/mock');
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-materia-ilustracao.png`), fullPage: true });
  });

  test('imagem: null não quebra a página: sem figura, sem aviso de correção', async ({ page }) => {
    await page.goto('/noticia/api-sem-imagem');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('imagem venceu');
    await expect(page.getByTestId('article-image')).toHaveCount(0);
    await expect(page.locator('main img')).toHaveCount(0);
    await expect(page.getByTestId('correction-notice')).toHaveCount(0);
    await expect(page.getByText('Nenhuma correção registrada')).toBeVisible();
  });

  test('foto de terceiro: crédito e link da fonte, sem rótulo de ilustração', async ({ page }) => {
    await page.goto('/noticia/api-foto-terceiro');
    const fig = page.getByTestId('article-image');
    await expect(fig.locator('figcaption')).toContainText('Crédito: Agência de teste (MOCK)');
    await expect(fig.getByRole('link', { name: 'fonte da imagem' })).toHaveAttribute('href', 'https://agencia.example/mock');
    await expect(page.getByTestId('image-label')).toHaveCount(0);
  });

  test('axe (WCAG A/AA, contraste) na matéria com errata, ilustração e card', async ({ page }) => {
    test.setTimeout(90_000);
    for (const p of ['/noticia/api-ilustracao-corrigida', '/noticia/api-sem-imagem', '/noticias']) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
      expect(summary, `${p}: ${summary.join(' ; ')}`).toEqual([]);
    }
  });

  test('matéria inexistente dá 404 do portal', async ({ page }) => {
    expect((await page.goto('/noticia/nao-existe'))?.status()).toBe(404);
    await expect(page.getByText('Não encontramos o que você procurava')).toBeVisible();
  });

  test('V-07: na listagem a grade usa uma única variante: ou todos os cards têm imagem ou nenhum tem (e rótulo só onde há imagem)', async ({ page }) => {
    await page.goto('/noticias');
    const grid = page.locator('#conteudo .pt-grid');
    await expect(grid.locator('article.ln-card').first()).toBeVisible();
    const cards = await grid.locator('article.ln-card').count();
    expect(cards).toBeGreaterThanOrEqual(3);
    const midias = await grid.locator('.ln-card__media').count();
    // A listagem mistura tipos (entrevista e opinião nunca recebem a ilustração padrão): com 1 inelegível sem imagem, a grade inteira fica só texto.
    expect([0, cards]).toContain(midias);
    const rotulos = await grid.locator('.ln-card__imglabel').count();
    if (midias === 0) expect(rotulos).toBe(0);
    else await expect(grid.locator('article', { hasText: 'foto de terceiro' }).locator('.ln-card__imglabel')).toHaveCount(0);
  });

  test('F-04: notícia sem imagem numa grade só de elegíveis mostra a ilustração conceitual da editoria, com rótulo; a matéria segue sem figura', async ({ page }) => {
    await page.goto('/editoria/pontos');
    const card = page.locator('article.ln-card', { hasText: 'imagem venceu' });
    const img = card.locator('img');
    await expect(img).toHaveAttribute('src', '/ilustracoes/viagem.svg');
    await expect(img).toHaveAttribute('alt', 'Ilustração conceitual de Pontos & Milhas');
    await expect(card.locator('.ln-card__imglabel')).toHaveText('Ilustração conceitual');
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    // alt e texto do card não citam IA, modelo ou ferramenta (D09).
    expect(await card.innerText()).not.toMatch(/\bIA\b|modelo|prompt|gerad/i);
    // Só de exibição: a página da matéria sem imagem continua sem figura.
    await page.goto('/noticia/api-sem-imagem');
    await expect(page.getByTestId('article-image')).toHaveCount(0);
  });

  test('imagem pública e rótulo da ilustração aparecem na matéria (a imagem de card exige grade só com imagens)', async ({ page }) => {
    await page.goto('/noticia/api-ilustracao-corrigida');
    const fig = page.getByTestId('article-image');
    await expect(fig.locator('img')).toHaveAttribute('src', '/api/publico/midia/ilustracao-1');
    await expect(page.getByTestId('image-label')).toHaveText('Ilustração conceitual');
  });

  test('listagens e home usam a API; "em alta" fica vazio e honesto', async ({ page }) => {
    await page.goto('/noticias');
    await expect(page.getByRole('link', { name: /Matéria com ilustração conceitual e errata/ })).toBeVisible();
    await page.goto('/editoria/pontos');
    await expect(page.getByRole('link', { name: /imagem venceu/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /ilustração conceitual e errata/ })).toHaveCount(0);
    await page.goto('/flash');
    await expect(page.getByRole('link', { name: /foto de terceiro/ })).toBeVisible();
    await page.goto('/em-alta');
    await expect(page.getByText('Ranking em formação')).toBeVisible();
    await page.goto('/busca?q=venceu');
    await expect(page.getByTestId('result-count')).toContainText('1 resultado');
  });

  test('o noindex do ambiente continua valendo na página da notícia', async ({ request }) => {
    const appEnv = process.env.PORTAL_APP_ENV ?? 'production';
    const r = await request.get('/noticia/api-ilustracao-corrigida');
    expect(r.status()).toBe(200);
    // DP-24: produção só é indexável com PORTAL_INDEXAVEL=1 (PORTAL_INDEXAVEL_E2E=0 sobe a produção sem o interruptor).
    if (appEnv === 'production' && process.env.PORTAL_INDEXAVEL_E2E !== '0') expect(r.headers()['x-robots-tag']).toBeUndefined();
    else expect(r.headers()['x-robots-tag']).toBe('noindex, nofollow');
  });
});

test.describe('mídia kit via API comercial', () => {
  test.skip(mode !== 'api', 'somente no modo api');

  test('audiência com origem, janela e data de coleta; indisponível sem coleta; catálogo com preço de referência e disponibilidade', async ({ page }) => {
    await page.goto('/midia-kit');
    const sessoes = page.locator('#audiencia .pt-metric').filter({ hasText: 'Sessões (30 dias)' });
    await expect(sessoes.locator('strong')).toHaveText('1.234');
    await expect(sessoes).toContainText('GA4');
    await expect(sessoes).toContainText('05/11/2026 a 04/12/2026');
    await expect(sessoes).toContainText('coletado em');
    const semColeta = page.locator('#audiencia .pt-metric').filter({ hasText: 'Usuários ativos (30 dias)' });
    await expect(semColeta.locator('strong')).toHaveText('—');
    await expect(semColeta).toContainText('Indisponível');
    const precos = page.getByTestId('mk-precos');
    await expect(precos.getByRole('row', { name: /Banner topo.*R\$ 3\.000\/mês.*Sob consulta/ })).toBeVisible();
    await expect(precos.getByRole('row', { name: /Banner meio.*Indisponível/ })).toBeVisible();
    // nenhum motivo interno (flag, P-01/P-02) na página pública
    expect(await page.locator('main').innerText()).not.toMatch(/\bflag\b|P-0[12]|adServerVendas/i);
  });

  test('V-13: mapa de posições vem da API (3 desenhadas, a sem dimensão só na lista como "em definição")', async ({ page }) => {
    await page.goto('/midia-kit');
    const mapa = page.getByTestId('mk-mapa');
    await expect(mapa.locator('[data-position]')).toHaveCount(3);
    for (const id of ['TOP', 'SIDEBAR_1', 'FOOTER']) await expect(mapa.locator(`[data-position="${id}"]`)).toHaveCount(1);
    await expect(mapa.locator('[data-position="SIDEBAR_2"]')).toHaveCount(0);
    const lista = page.getByTestId('mk-mapa-lista');
    await expect(lista.locator('li')).toHaveCount(4);
    await expect(lista.locator('[data-position-item="AGENDA"]')).toContainText('dimensões em definição');
  });

  test('P2-1: tabelas de preço por seção (vindas da API) também são regiões focáveis com nome único', async ({ page }) => {
    await page.goto('/midia-kit');
    const precos = page.getByTestId('mk-precos').locator('.pt-scroll');
    expect(await precos.count()).toBe(2); // Banners e The Loyal no mock
    const nomes: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = precos.nth(i);
      await expect(r).toHaveAttribute('tabindex', '0');
      await expect(r).toHaveAttribute('role', 'region');
      nomes.push((await r.getAttribute('aria-label')) ?? '');
    }
    expect(nomes[0]).toContain('Preços de referência: Banners');
    expect(nomes[1]).toContain('Preços de referência: The Loyal');
    await aguardarHidratacao(page);
    const foco = await focarELer(precos.nth(1));
    expect(foco.focado).toBe(true);
    expect(foco.estiloAnel).not.toBe('none'); // o anel de foco aparece
  });

  test('cobertura: só a coleta da API (origem, janela e data); métrica de demonstração (seed) vira "—" e "sem dado real"', async ({ page }) => {
    await page.goto('/midia-kit');
    const real = page.getByTestId('coverage-articles');
    await expect(real.locator(':scope > strong')).toHaveText('12');
    await expect(real).toContainText('CMS');
    await expect(real).toContainText('05/11/2026 a 04/12/2026');
    await expect(real).toContainText('coletado em');
    await expect(real).toHaveAttribute('data-mock', 'false');
    const demo = page.getByTestId('coverage-articles90');
    await expect(demo.locator(':scope > strong')).toHaveText('—');
    await expect(demo).toContainText('sem dado real');
    await expect(demo).not.toContainText('coletado em');
    const semColeta = page.getByTestId('coverage-events');
    await expect(semColeta.locator(':scope > strong')).toHaveText('—');
    // nenhum rótulo de demonstração vaza para a página, e o número do seed (20) não aparece em nenhum cartão
    const texto = await page.locator('#cobertura').innerText();
    expect(texto).not.toMatch(/DEMO|seed-stg/i);
    expect(await page.locator('#cobertura .pt-metric strong').allTextContents()).not.toContain('20');
  });
});
