import { expect, test } from '@playwright/test';
import path from 'node:path';

const mode = (process.env.PORTAL_MODE ?? 'empty') as 'empty' | 'mock';
const SHOTS = path.resolve(import.meta.dirname, '..', 'screenshots', mode);

/** Clica até o estado aria-expanded=true (tolera clique antes da hidratação do React). */
async function expand(button: import('@playwright/test').Locator) {
  await expect(async () => {
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

test.describe('navegação e menu', () => {
  test('desktop: menu de editorias em uma linha (6 + Mais) e atalhos do portal na barra superior', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Editorias', exact: true });
    // ≥1280px: 6 editorias fixas + botão "Mais" (as outras 4 ficam no painel)
    await expect(nav.getByRole('link')).toHaveCount(6);
    const mais = nav.getByRole('button', { name: /Mais/ });
    await expect(mais).toHaveAttribute('aria-expanded', 'false');
    await mais.click();
    await expect(mais).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.getByRole('link')).toHaveCount(10);
    await expect(nav.getByRole('link', { name: 'Regulação & Dados' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(mais).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('link')).toHaveCount(6);
    // menu numa única linha: todas as editorias visíveis têm o mesmo topo
    const tops = await nav.getByRole('link').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
    expect(tops.length, 'menu deve ficar em uma linha').toBe(1);
    const util = page.getByRole('navigation', { name: 'Seções do portal' });
    for (const l of ['Últimas', 'Em alta', 'Agenda', 'Anuncie']) {
      await expect(util.getByRole('link', { name: l, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: path.join(SHOTS, 'desktop-menu.png') });
    await nav.getByRole('link', { name: 'Bancos & Cartões' }).click();
    await expect(page).toHaveURL(/\/editoria\/bancos$/);
    await expect(page.getByRole('link', { name: 'Bancos & Cartões' }).first()).toHaveAttribute('aria-current', 'page');
  });

  test('mobile: menu colapsável abre, navega e fecha com ESC', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile');
    await page.goto('/');
    const toggle = page.locator('.ln-header__toggle');
    const nav = page.getByRole('navigation', { name: 'Editorias', exact: true });
    await expect(nav).toBeHidden();
    await expand(toggle);
    await expect(nav).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'mobile-menu-aberto.png') });
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expand(toggle);
    await nav.getByRole('link', { name: 'Pontos & Milhas' }).click();
    await expect(page).toHaveURL(/\/editoria\/pontos$/);
  });

  test('itens de módulos desligados (The Loyal, Podcast, Market Data) não aparecem no menu', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('header, .pt-subnav');
    await expect(header.getByRole('link', { name: 'The Loyal' })).toHaveCount(0);
    await expect(header.getByRole('link', { name: 'Podcast' })).toHaveCount(0);
    await expect(header.getByRole('link', { name: 'Market Data' })).toHaveCount(0);
  });

  test('/anuncie redireciona para /midia-kit', async ({ page }) => {
    await page.goto('/anuncie');
    await expect(page).toHaveURL(/\/midia-kit$/);
  });

  test('rota inexistente e editoria inválida devolvem 404 com página do portal', async ({ page }) => {
    const r1 = await page.goto('/editoria/nao-existe');
    expect(r1?.status()).toBe(404);
    await expect(page.getByText('Não encontramos o que você procurava')).toBeVisible();
    const r2 = await page.goto('/pagina-que-nao-existe');
    expect(r2?.status()).toBe(404);
  });
});

test.describe('SEO básico', () => {
  test('home tem metadata, canonical e JSON-LD WebSite', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="description"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ld ?? '{}')['@type']).toBe('WebSite');
  });

  test('sitemap.xml, robots.txt e feed.xml respondem', async ({ request }) => {
    const sm = await request.get('/sitemap.xml');
    expect(sm.status()).toBe(200);
    const smBody = await sm.text();
    expect(smBody).toContain('<urlset');
    const rb = await request.get('/robots.txt');
    expect(rb.status()).toBe(200);
    const rbBody = await rb.text();
    if (mode === 'mock') {
      expect(rbBody).toContain('Disallow: /');
      expect(smBody).not.toContain('<loc>');
      await expect(await (await request.get('/')).text()).toMatch(/<meta name="robots" content="noindex/);
    } else {
      expect(rbBody).toContain('Sitemap:');
      expect(smBody).toContain('/editoria/bancos');
    }
    const feed = await request.get('/feed.xml');
    expect(feed.status()).toBe(200);
    expect(await feed.text()).toContain('<rss');
  });

  test('busca não é indexável', async ({ page }) => {
    await page.goto('/busca?q=teste');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});

test.describe('honestidade de dados', () => {
  test('mídia kit nunca exibe métrica numérica de audiência sem coleta', async ({ page }) => {
    await page.goto('/midia-kit');
    const aud = page.locator('#audiencia');
    await expect(aud.getByText('Indisponível').first()).toBeVisible();
    await expect(page.getByTestId('audience-stamp')).toContainText('Aguardando integração');
    const values = await aud.locator('.pt-metric strong').allTextContents();
    expect(values.every((v) => v.trim() === '—')).toBe(true);
  });

  test('textos jurídicos são marcados como minuta', async ({ page }) => {
    for (const p of ['/privacidade', '/termos', '/publicidade']) {
      await page.goto(p);
      await expect(page.getByTestId('draft-notice')).toContainText('validação jurídica');
    }
  });

  test('contato não inventa e-mail nem redes', async ({ page }) => {
    await page.goto('/contato');
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
    await expect(page.getByText(/ainda não foram confirmados/)).toBeVisible();
  });
});

test.describe('busca', () => {
  test('sem termo mostra orientação; termo sem resultado mostra estado vazio', async ({ page }) => {
    await page.goto('/busca');
    await expect(page.getByText('Digite um termo para buscar')).toBeVisible();
    await page.getByRole('searchbox').fill('termo-inexistente-xyz');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page).toHaveURL(/q=termo-inexistente-xyz/);
    await expect(page.getByText(/Nenhum resultado para/)).toBeVisible();
  });
});

test.describe('conteúdo MOCK', () => {
  test.skip(mode !== 'mock', 'somente no modo mock');

  test('home mostra destaques, em alta, últimas, agenda e editorias, com faixa MOCK', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Conteúdo de demonstração — não publicado/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Destaques' })).toBeVisible();
    await expect(page.locator('#destaques article')).not.toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Em alta' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Últimas notícias' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Loyalty Flash' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible();
  });

  test('busca encontra matérias MOCK e paginação de /noticias funciona', async ({ page }) => {
    await page.goto('/busca?q=bancos');
    await expect(page.getByTestId('result-count')).toContainText('resultado');
    await expect(page.locator('article.ln-card').first()).toBeVisible();
    await page.goto('/noticias');
    await expect(page.getByRole('link', { name: 'Página 1' })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Próxima página' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByRole('link', { name: 'Página 2' })).toHaveAttribute('aria-current', 'page');
  });

  test('página de matéria: assinatura institucional, fontes, correções, crédito e noindex', async ({ page }, info) => {
    await page.goto('/noticia/mock-bancos-1');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('[MOCK]');
    await expect(page.getByText('Redação Loyalty News').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fontes e referências' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Histórico de correções' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '{}');
    expect(ld['@type']).toBe('NewsArticle');
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-materia.png`), fullPage: true });
  });

  test('agenda lista eventos, filtra online e abre o evento com .ics', async ({ page, request }, info) => {
    await page.goto('/agenda');
    await expect(page.getByRole('link', { name: /Evento de teste presencial/ })).toBeVisible();
    await page.getByRole('link', { name: 'Online', exact: true }).click();
    await expect(page.getByRole('link', { name: /Webinar de teste/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Evento de teste presencial/ })).toHaveCount(0);
    await page.goto('/agenda/mock-evento-1');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Evento de teste');
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-evento.png`), fullPage: true });
    const ics = await request.get('/agenda/mock-evento-1/ics');
    expect(ics.status()).toBe(200);
    expect(await ics.text()).toContain('BEGIN:VEVENT');
  });

  test('Moves e Intelligence mostram itens marcados MOCK', async ({ page }) => {
    await page.goto('/moves');
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.locator('[data-testid="mock-badge"]').first()).toBeVisible();
    await page.goto('/intelligence/empresas');
    await expect(page.getByText('Empresa de Teste (MOCK)')).toBeVisible();
  });

  test('matéria com ilustração conceitual: rótulo visível, crédito institucional e aviso de correção', async ({ page }, info) => {
    await page.goto('/noticia/mock-mercado-1');
    await expect(page.getByTestId('image-label')).toHaveText('Ilustração conceitual');
    await expect(page.getByTestId('article-image').locator('figcaption')).toContainText('Crédito: Loyalty News');
    await expect(page.getByTestId('correction-notice')).toContainText('Correção de teste (MOCK).');
    const w = await page.getByTestId('article-image').locator('img').evaluate((i: HTMLImageElement) => i.getBoundingClientRect().width);
    const col = await page.locator('.pt-article').evaluate((e) => e.getBoundingClientRect().width);
    expect(w).toBeLessThanOrEqual(col + 1);
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-materia-ilustracao.png`), fullPage: true });
  });

  test('foto com crédito não leva rótulo de ilustração; matéria sem imagem não quebra', async ({ page }) => {
    await page.goto('/noticia/mock-programas-1');
    await expect(page.getByTestId('article-image').locator('figcaption')).toContainText('Crédito: Template de teste (MOCK)');
    await expect(page.getByTestId('image-label')).toHaveCount(0);
    await page.goto('/noticia/mock-mercado-2');
    await expect(page.getByTestId('article-image')).toHaveCount(0);
    await expect(page.getByTestId('correction-notice')).toHaveCount(0);
  });

  test('cards com ilustração mostram o rótulo visível sobre a imagem (editoria, mobile incluso)', async ({ page }, info) => {
    await page.goto('/editoria/mercado');
    const label = page.locator('.ln-card__imglabel').first();
    await expect(label).toBeVisible();
    await expect(label).toHaveText('Ilustração conceitual');
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-card-rotulo.png`) });
  });

  test('editoria mostra somente matérias da editoria', async ({ page }) => {
    await page.goto('/editoria/bancos');
    const cards = page.locator('#conteudo .pt-grid article.ln-card');
    await expect(cards).toHaveCount(2);
    for (const k of await page.locator('#conteudo .pt-grid article.ln-card .ln-badge').allTextContents()) expect(k).toContain('Bancos & Cartões');
  });
});
