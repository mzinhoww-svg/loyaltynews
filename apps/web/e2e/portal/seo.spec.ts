import { expect, test, type Page } from '@playwright/test';

/**
 * SEO técnico do portal para o lançamento com domínio próprio. Roda nos três modos e nos ambientes do env.spec:
 *   produção com PORTAL_INDEXAVEL=1 (padrão do e2e) = indexável; staging, mock e produção sem o interruptor = bloqueado.
 * O domínio do release é o NEXT_PUBLIC_SITE_URL do build (aqui https://portal.example.test; no lançamento, https://www.loyaltynews.com.br).
 */
const SITE = 'https://portal.example.test';
const appEnv = process.env.PORTAL_APP_ENV ?? 'production';
const mode = (process.env.PORTAL_MODE ?? 'empty') as 'empty' | 'mock' | 'api';
const semInterruptor = process.env.PORTAL_INDEXAVEL_E2E === '0';
const bloqueado = appEnv !== 'production' || mode === 'mock' || semInterruptor;

const meta = (page: Page, seletor: string, attr = 'content') => page.locator(seletor).first().getAttribute(attr);

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const textos = await page.locator('script[type="application/ld+json"]').allTextContents();
  return textos.map((t) => JSON.parse(t) as Record<string, unknown>);
}

test.describe(`SEO técnico (${mode}, APP_ENV=${appEnv}${semInterruptor ? ', sem interruptor' : ''})`, () => {
  test('robots.txt e news-sitemap.xml: indexável lista os dois sitemaps no domínio do release; bloqueado não lista nenhum e o news-sitemap vem vazio', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    const news = await request.get('/news-sitemap.xml');
    expect(news.status()).toBe(200);
    expect(news.headers()['content-type']).toContain('application/xml');
    const xml = await news.text();
    expect(xml).toContain('<urlset');
    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    if (bloqueado) {
      expect(robots).toBe('User-agent: *\nDisallow: /\n');
      expect(xml).not.toContain('<url>');
      expect(news.headers()['cache-control']).toBe('no-store');
    } else {
      expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
      expect(robots).toContain(`Sitemap: ${SITE}/news-sitemap.xml`);
      expect(robots).toContain('Allow: /');
      expect(news.headers()['cache-control']).toBe('public, s-maxage=60, stale-while-revalidate=30');
      for (const loc of xml.matchAll(/<loc>([^<]*)<\/loc>/g)) expect(loc[1]!.startsWith(`${SITE}/noticia/`)).toBe(true); // só matérias, no domínio do release
    }
  });

  test('as páginas institucionais ESTÁTICAS seguem o interruptor em tempo de execução: indexáveis em produção com PORTAL_INDEXAVEL=1, noindex fora', async ({ page }) => {
    for (const rota of ['/sobre', '/privacidade', '/contato', '/metodologia']) {
      await page.goto(rota);
      const robots = (await meta(page, 'meta[name="robots"]')) ?? '';
      if (bloqueado) expect(robots, `${rota}: bloqueado`).toMatch(/noindex/);
      else {
        expect(robots, `${rota}: indexável não pode ter noindex (o build não pode embutir o bloqueio)`).not.toMatch(/noindex/);
        expect((await meta(page, 'meta[name="googlebot"]')) ?? '', `${rota}: googlebot`).toContain('max-image-preview:large');
      }
      expect(await meta(page, 'link[rel="canonical"]', 'href'), rota).toBe(`${SITE}${rota}`);
    }
  });

  test('títulos e descrições únicos nas páginas principais; canonical sempre no domínio do release', async ({ page }) => {
    test.slow(); // 24 páginas em sequência
    const rotas = ['/noticias', '/flash', '/analises', '/entrevistas', '/opiniao', '/em-alta', '/agenda', '/midia-kit', '/moves', '/intelligence', '/sobre', '/contato', '/privacidade', '/metodologia', ...['mercado', 'programas', 'pontos', 'bancos', 'varejo', 'travel', 'tech', 'crm', 'global', 'regulacao'].map((e) => `/editoria/${e}`)];
    const titulos = new Map<string, string>();
    const descricoes = new Map<string, string>();
    for (const rota of rotas) {
      await page.goto(rota);
      const t = await page.title();
      const d = (await meta(page, 'meta[name="description"]')) ?? '';
      expect(t.length, `${rota}: título`).toBeGreaterThan(5);
      expect(d.length, `${rota}: descrição`).toBeGreaterThan(20);
      expect(titulos.get(t), `título repetido: ${t} (${rota} e ${titulos.get(t)})`).toBeUndefined();
      expect(descricoes.get(d), `descrição repetida (${rota} e ${descricoes.get(d)})`).toBeUndefined();
      titulos.set(t, rota);
      descricoes.set(d, rota);
      expect(await meta(page, 'link[rel="canonical"]', 'href'), `${rota}: canonical`).toBe(`${SITE}${rota}`);
    }
  });

  test('toda editoria tem Open Graph e Twitter Card com og:image absoluta no domínio do release (placeholder até a UI/UX entregar os assets) e alt próprio', async ({ page }) => {
    test.slow(); // 10 páginas em sequência
    const alts = new Set<string>();
    for (const e of ['mercado', 'programas', 'pontos', 'bancos', 'varejo', 'travel', 'tech', 'crm', 'global', 'regulacao']) {
      await page.goto(`/editoria/${e}`);
      expect(await meta(page, 'meta[property="og:image"]'), e).toBe(`${SITE}/og-padrao.png`);
      expect(await meta(page, 'meta[property="og:image:width"]'), e).toBe('1200');
      expect(await meta(page, 'meta[property="og:image:height"]'), e).toBe('627');
      expect(await meta(page, 'meta[name="twitter:image"]'), e).toBe(`${SITE}/og-padrao.png`);
      expect(await meta(page, 'meta[name="twitter:card"]'), e).toBe('summary_large_image');
      expect(await meta(page, 'meta[property="og:url"]'), e).toBe(`${SITE}/editoria/${e}`);
      alts.add((await meta(page, 'meta[property="og:image:alt"]')) ?? '');
    }
    expect(alts.size, 'um alt de imagem por editoria').toBe(10);
  });

  test('editoria: JSON-LD CollectionPage e BreadcrumbList (Início > editoria), JSON-LD válido', async ({ page }) => {
    await page.goto('/editoria/bancos');
    const tipos = (await jsonLd(page)).map((o) => o['@type']);
    expect(tipos).toEqual(['CollectionPage', 'BreadcrumbList']);
    const crumbs = (await jsonLd(page))[1] as { itemListElement: { position: number; name: string; item?: string }[] };
    expect(crumbs.itemListElement.map((i) => i.name)).toEqual(['Início', 'Bancos & Cartões']);
    expect(crumbs.itemListElement[0]!.item).toBe(`${SITE}/`);
    expect(crumbs.itemListElement[1]!.item).toBeUndefined();
  });

  test('listagens paginadas: canonical próprio e título e descrição únicos nas páginas 2+ (nunca canonical da 1ª página)', async ({ page }) => {
    test.slow(); // 12 páginas em sequência
    for (const [rota, titulo] of [['/noticias', 'Últimas notícias'], ['/flash', 'Loyalty Flash'], ['/analises', 'Análises'], ['/entrevistas', 'Entrevistas'], ['/opiniao', 'Opinião'], ['/editoria/bancos', 'Bancos & Cartões']] as const) {
      await page.goto(rota);
      const t1 = await page.title();
      const d1 = await meta(page, 'meta[name="description"]');
      await page.goto(`${rota}?page=2`);
      expect(await page.title(), rota).toContain(`${titulo} — página 2`);
      expect(await page.title()).not.toBe(t1);
      expect(await meta(page, 'meta[name="description"]')).not.toBe(d1);
      expect(await meta(page, 'link[rel="canonical"]', 'href'), rota).toBe(`${SITE}${rota}?page=2`);
      expect(await meta(page, 'meta[property="og:url"]')).toBe(`${SITE}${rota}?page=2`);
    }
  });

  test('home: WebSite com SearchAction apontando para /busca e Organization sempre presente (padrão do portal quando o Studio não publica)', async ({ page }) => {
    await page.goto('/');
    const ld = await jsonLd(page);
    const web = ld.find((o) => o['@type'] === 'WebSite') as { url: string; potentialAction: { '@type': string; target: string; 'query-input': string } };
    expect(web.url).toBe(SITE);
    expect(web.potentialAction['@type']).toBe('SearchAction');
    expect(web.potentialAction.target).toBe(`${SITE}/busca?q={search_term_string}`);
    expect(web.potentialAction['query-input']).toBe('required name=search_term_string');
    const org = ld.find((o) => o['@type'] === 'Organization') as { name: string; url: string } | undefined;
    expect(org, 'Organization na home').toBeDefined();
    expect(org!.name.length).toBeGreaterThan(2);
  });

  test('home sem Organization publicada no Studio: usa a padrão do portal, com logo, no domínio do release', async ({ page }) => {
    test.skip(mode === 'api', 'no modo api o servidor MOCK publica a sua própria Organization');
    await page.goto('/');
    const org = (await jsonLd(page)).find((o) => o['@type'] === 'Organization') as { name: string; url: string; logo: { url: string; '@type': string } };
    expect(org.name).toBe('Loyalty News');
    expect(org.url).toBe(SITE);
    expect(org.logo['@type']).toBe('ImageObject');
    expect(org.logo.url).toBe(`${SITE}/og-padrao.png`);
  });

  test('matéria: NewsArticle completo (publisher com logo, idioma, imagem, mainEntityOfPage), BreadcrumbList e og:image sempre presente', async ({ page }) => {
    test.skip(mode === 'empty', 'precisa de matérias (mock ou api)');
    const slug = mode === 'api' ? 'api-sem-imagem' : 'mock-bancos-1';
    await page.goto(`/noticia/${slug}`);
    const ld = await jsonLd(page);
    const art = ld.find((o) => o['@type'] === 'NewsArticle') as Record<string, unknown> & { publisher: { logo: { url: string } }; image: string[]; mainEntityOfPage: { '@id': string } };
    expect(art.inLanguage).toBe('pt-BR');
    expect(art.publisher.logo.url).toBe(`${SITE}/og-padrao.png`);
    expect(art.mainEntityOfPage['@id']).toBe(`${SITE}/noticia/${slug}`);
    expect(art.url).toBe(`${SITE}/noticia/${slug}`);
    expect(art.image.length).toBeGreaterThan(0);
    expect(art.image[0]!.startsWith(`${SITE}/`)).toBe(true); // matéria sem imagem própria: usa a da editoria, nunca vazia
    expect(art.datePublished).toBeTruthy();
    expect(art.dateModified).toBeTruthy();
    const crumbs = ld.find((o) => o['@type'] === 'BreadcrumbList') as { itemListElement: { name: string }[] };
    expect(crumbs.itemListElement).toHaveLength(3);
    expect(crumbs.itemListElement[0]!.name).toBe('Início');
    expect(await meta(page, 'meta[property="og:image"]')).toBeTruthy();
    expect(await meta(page, 'meta[name="twitter:image"]')).toBeTruthy();
    expect(await meta(page, 'meta[property="og:type"]')).toBe('article');
    expect(await meta(page, 'meta[property="article:published_time"]')).toBeTruthy();
    expect(await meta(page, 'link[rel="canonical"]', 'href')).toBe(`${SITE}/noticia/${slug}`);
  });

  test('o JSON-LD nunca deixa um "</script>" escapar (XSS) mesmo com o novo breadcrumb e publisher', async ({ request }) => {
    test.skip(mode !== 'api', 'o conteúdo hostil vem do servidor MOCK do modo api');
    const html = await (await request.get('/')).text();
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) expect(m[1]).not.toContain('<');
  });
});
