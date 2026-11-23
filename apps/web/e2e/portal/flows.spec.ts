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
  test('desktop: barra enxuta (poucas entradas) e as 10 editorias dentro do menu, não na barra', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.goto('/');
    const bar = page.getByRole('navigation', { name: 'Seções do portal' });
    // Barra: o botão do menu + 4 links fixos (a opção de navegação pode variar; o contrato é "poucas entradas")
    const fixos = await bar.getByRole('link').count();
    expect(fixos, 'barra deve ter poucas entradas fixas').toBeLessThanOrEqual(5);
    // As editorias NÃO aparecem na barra com o menu fechado
    await expect(bar.getByRole('link', { name: 'Bancos & Cartões' })).toHaveCount(0);
    const menu = bar.locator('.ln-header__menu-btn');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    const mega = page.locator('.ln-header__mega');
    for (const nome of ['Mercado & Negócios', 'Programas de Fidelidade', 'Pontos & Milhas', 'Bancos & Cartões', 'Varejo & Cashback',
      'Travel & Hospitality', 'LoyaltyTech & IA', 'CRM & CX', 'Global Loyalty', 'Regulação & Dados']) {
      await expect(mega.getByRole('link', { name: nome, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: path.join(SHOTS, 'desktop-menu.png') });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(mega).toBeHidden();
    // Cabeçalho enxuto: uma única barra
    const h = await page.locator('header').boundingBox();
    expect(h?.height ?? 0, 'altura do cabeçalho').toBeLessThanOrEqual(72);
    // Navega por uma editoria pelo menu
    await menu.click();
    await mega.getByRole('link', { name: 'Bancos & Cartões', exact: true }).click();
    await expect(page).toHaveURL(/\/editoria\/bancos$/);
    await menu.click();
    await expect(mega.getByRole('link', { name: 'Bancos & Cartões', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('desktop: clique fora fecha o menu e o CTA Anuncie leva ao mídia kit', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.goto('/');
    const menu = page.locator('.ln-header__menu-btn');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.mouse.click(8, 600); // margem da página, fora do menu (a home vazia é curta: não depende de `main`)
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await page.locator('header').getByRole('link', { name: 'Anuncie' }).click();
    await expect(page).toHaveURL(/\/midia-kit$/);
  });

  test('mobile: menu colapsável abre, navega e fecha com ESC', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile');
    await page.goto('/');
    const toggle = page.locator('.ln-header__toggle');
    const nav = page.getByRole('navigation', { name: 'Menu e editorias' });
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
    const feedBody = await feed.text();
    expect(feedBody).toContain('<rss');
    // Vitrine/mock nunca publica itens no feed (Security R6).
    if (mode === 'mock') expect(feedBody).not.toContain('<item>');
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
    // Selo compacto visível "MOCK" + texto completo para leitor de tela.
    const cell = page.getByRole('table').locator('td', { has: page.locator('[data-testid="mock-badge"]') }).first();
    await expect(cell).toContainText('MOCK');
    const txt = (await cell.evaluate((e) => e.textContent)) ?? '';
    expect(txt).toContain('MOCK · dados de exemplo');
    // O texto para leitor de tela vem só do DS: nunca duplicado.
    expect(txt.split('dados de exemplo').length - 1).toBe(1);
    await expect(cell.locator('.ln-sr-only')).toHaveCount(1);
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
