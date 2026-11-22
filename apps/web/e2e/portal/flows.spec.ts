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
  test('desktop: dropdown de Notícias lista as 10 editorias e fecha com ESC', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Navegação principal' });
    await expand(nav.getByRole('button', { name: /Notícias/ }));
    const dd = nav.locator('.ln-dropdown');
    await expect(dd.getByRole('link')).toHaveCount(13); // 3 formatos + 10 editorias
    await expect(dd.getByRole('link', { name: 'Bancos & Cartões' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'desktop-menu-dropdown.png') });
    await page.keyboard.press('Escape');
    await expect(dd).toHaveCount(0);
  });

  test('mobile: menu colapsável abre, navega e fecha com ESC', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile');
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Menu' });
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeHidden();
    await expand(toggle);
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'mobile-menu-aberto.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeHidden();
    await expand(toggle);
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Agenda' }).click();
    await expect(page).toHaveURL(/\/agenda$/);
  });

  test('itens de módulos desligados (The Loyal, Podcast, Market Data) não aparecem no menu', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('header');
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
      expect(smBody).not.toContain('/noticia/');
    } else {
      expect(rbBody).toContain('Sitemap:');
      expect(smBody).toContain('/editoria/bancos-e-cartoes');
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
    const values = await aud.locator('.ln-metric strong').allTextContents();
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
    await expect(page.getByText(/MOCK — conteúdo sintético/)).toBeVisible();
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
    await expect(page.getByText('Página 1 de 2')).toBeVisible();
    await page.getByRole('link', { name: /Próxima/ }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.getByText('Página 2 de 2')).toBeVisible();
  });

  test('página de matéria: assinatura institucional, fontes, correções, crédito e noindex', async ({ page }, info) => {
    await page.goto('/noticia/mock-bancos-e-cartoes-1');
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
    await expect(page.locator('.ln-mocktag').first()).toBeVisible();
    await page.goto('/intelligence/empresas');
    await expect(page.getByText('Empresa de Teste (MOCK)')).toBeVisible();
  });

  test('editoria mostra somente matérias da editoria', async ({ page }) => {
    await page.goto('/editoria/bancos-e-cartoes');
    const cards = page.locator('article.ln-card');
    await expect(cards).toHaveCount(2);
    for (const k of await page.locator('article.ln-card .ln-kicker').allTextContents()) expect(k).toContain('Bancos & Cartões');
  });
});
