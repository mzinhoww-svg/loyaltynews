import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * Configuração do site publicada no Studio (GET /api/publico/site) lida pelo portal no modo api:
 * home por blocos, menus principal/rodapé, SEO (título, descrição, OG, JSON-LD, noindex) e links internos.
 * O servidor MOCK (e2e/fake-api.mjs) responde conforme PORTAL_API_SITE: (vazio) full | vazio | noindex | invalido | malicioso.
 */
const siteMode = process.env.PORTAL_API_SITE || 'full';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><rect width="1200" height="675" fill="#34877a"/></svg>';

test.skip(process.env.PORTAL_MODE !== 'api' || Boolean(process.env.PORTAL_API_DOWN), 'somente no modo api com a API no ar');

/** Barra de atalhos do cabeçalho; no mobile os links ficam no painel (recolhido até o botão ser acionado). */
async function headerLinks(page: Page, project: string) {
  if (project !== 'mobile') return page.getByRole('navigation', { name: 'Seções do portal' });
  const toggle = page.locator('.ln-header__toggle');
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  return page.getByRole('navigation', { name: 'Menu e editorias' });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/publico/midia/**', (r) => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }));
});

test.describe('site publicado (full)', () => {
  test.skip(siteMode !== 'full', 'somente com a configuração completa');

  test('home renderiza os blocos do editor: títulos, ordem, agenda do Studio, deduplicação e sem MOCK de demonstração', async ({ page }, info) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Em foco do dia (MOCK)' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pontos publicados (MOCK)' })).toBeVisible();
    // O bloco "ultimas" só tinha matérias já exibidas: some (nenhuma matéria repetida na home, nenhuma caixa vazia).
    await expect(page.getByRole('heading', { name: 'Últimas notícias' })).toHaveCount(0);
    const slugs = await page.locator('main article a[href^="/noticia/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(new Set(slugs).size, `matérias repetidas na home: ${slugs.join(', ')}`).toBe(slugs.length);
    // Agenda do bloco (evento aprovado pelo Studio): leva à página interna do evento (/agenda/{id}).
    const ag = page.getByRole('heading', { name: 'Agenda do Studio (MOCK)' });
    await expect(ag).toBeVisible();
    await expect(page.getByRole('link', { name: '[MOCK] Congresso publicado' })).toHaveAttribute('href', '/agenda/ev-1');
    // Destaque com a ilustração rotulada
    await expect(page.locator('.ln-card__imglabel').first()).toHaveText('Ilustração conceitual');
    // Bloco de publicidade sem criativo real: nada é renderizado
    await expect(page.getByText('Espaço reservado')).toHaveCount(0);
    // Sem faixa de demonstração: é conteúdo publicado, não vitrine
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);
    await page.screenshot({ path: path.join(import.meta.dirname, '..', 'screenshots', 'api', `${info.project.name}-home-publicada.png`), fullPage: true });
  });

  test('menu principal e rodapé publicados substituem os padrões; destinos externos funcionam', async ({ page }, info) => {
    await page.goto('/');
    const bar = await headerLinks(page, info.project.name);
    await expect(bar.getByRole('link', { name: 'Parceiro MOCK' })).toHaveAttribute('href', 'https://parceiro.example/mock');
    // Entradas padrão que o editor não publicou saem da barra
    await expect(bar.getByRole('link', { name: 'Moves' })).toHaveCount(0);
    await expect(bar.getByRole('link', { name: 'Intelligence' })).toHaveCount(0);
    const footer = page.locator('footer');
    await expect(footer.getByRole('link', { name: 'Nossa metodologia' })).toHaveAttribute('href', '/metodologia');
    await expect(footer.getByRole('heading', { name: 'Institucional MOCK' })).toBeVisible();
    await expect(footer.getByRole('link', { name: 'Fale com a redação' })).toHaveAttribute('href', '/contato');
    // Grupos padrão não aparecem quando o rodapé foi publicado
    await expect(footer.getByRole('heading', { name: 'Conteúdo' })).toHaveCount(0);
  });

  test('SEO publicado: título, descrição, Open Graph e JSON-LD Organization', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Loyalty News — SEO publicado (MOCK)');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Descrição publicada no Studio (MOCK).');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://cdn.example/og-mock.png');
    const lds = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>);
    const org = lds.find((l) => l['@type'] === 'Organization');
    expect(org).toMatchObject({ name: 'Loyalty News MOCK', url: 'https://loyaltynews.example/', sameAs: ['https://linkedin.example/mock'] });
    expect(lds.some((l) => l['@type'] === 'WebSite')).toBe(true);
    // Em produção indexável o noindex NÃO aparece (indexacao: indexar)
    if ((process.env.PORTAL_APP_ENV ?? 'production') === 'production' && process.env.PORTAL_INDEXAVEL_E2E !== '0') {
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow'); // indexável: nunca noindex (e googlebot com prévia grande)
    }
  });

  test('destaque com 1 item ao lado: o item fica vertical e a coluna acompanha a altura do card principal (revisão 56e4cdc, A-3)', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'só em tela larga');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const hero = page.locator('.pt-hero:not(.pt-hero--text)').first();
    await expect(hero).toBeVisible();
    const m = await hero.evaluate((h) => {
      const side = h.querySelector('.pt-hero-side') as HTMLElement;
      const main = h.querySelector('.pt-hero-main') as HTMLElement;
      const card = side.querySelector('.ln-card--sm') as HTMLElement;
      return { itens: side.children.length, colunas: getComputedStyle(card).gridTemplateColumns.split(' ').length, sideH: side.getBoundingClientRect().height, mainH: main.getBoundingClientRect().height, cardH: card.getBoundingClientRect().height };
    });
    expect(m.itens).toBeLessThanOrEqual(2);
    expect(m.colunas, 'com até 2 itens laterais, o card é vertical (1 coluna)').toBe(1);
    // o vazio sob o item lateral não passa de 40% da altura da coluna
    expect(m.cardH / m.sideH).toBeGreaterThanOrEqual(0.6);
  });

  test('links internos publicados: 1ª ocorrência do termo vira link na matéria', async ({ page }) => {
    await page.goto('/noticia/api-ilustracao-corrigida');
    const link = page.getByTestId('internal-link');
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText('matéria corrigida');
    await expect(link).toHaveAttribute('href', '/correcoes');
  });

  test('axe na home publicada e na matéria com link interno', async ({ page }) => {
    test.setTimeout(90_000);
    for (const p of ['/', '/noticia/api-ilustracao-corrigida']) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
      expect(summary, `${p}: ${summary.join(' ; ')}`).toEqual([]);
    }
  });
});

test.describe('nada publicado (vazio) ou resposta inválida: padrão do portal, sem inventar conteúdo', () => {
  test.skip(siteMode !== 'vazio' && siteMode !== 'invalido', 'somente com site vazio/inválido');

  test('home usa o fluxo padrão com as matérias da API; menu, rodapé e SEO padrão', async ({ page }, info) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Loyalty News — Portal de inteligência sobre fidelização/);
    await expect(page.getByRole('heading', { name: 'Em foco do dia (MOCK)' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Destaques' })).toBeVisible();
    const bar = await headerLinks(page, info.project.name);
    await expect(bar.getByRole('link', { name: 'Moves' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Parceiro MOCK' })).toHaveCount(0);
    await expect(page.locator('footer').getByRole('heading', { name: 'Conteúdo' })).toBeVisible();
    await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1); // só WebSite: sem Organization publicada
  });

  test('og:image: sem imagem publicada no Studio vale o padrão do portal (public/og-padrao.png)', async ({ page, request }) => {
    await page.goto('/');
    const og = page.locator('meta[property="og:image"]').first();
    await expect(og).toHaveAttribute('content', /\/og-padrao\.png$/);
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
    const src = new URL((await og.getAttribute('content')) as string);
    expect((await request.get(src.pathname)).status()).toBe(200);
  });

  test('matéria sem links internos publicados', async ({ page }) => {
    await page.goto('/noticia/api-ilustracao-corrigida');
    await expect(page.getByTestId('internal-link')).toHaveCount(0);
  });
});

test.describe('noindex publicado no Studio soma-se ao bloqueio', () => {
  test.skip(siteMode !== 'noindex', 'somente com seo.indexacao = noindex');

  test('meta, robots.txt, sitemap e feed bloqueiam mesmo em produção indexável', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /nofollow/);
    expect(await (await request.get('/robots.txt')).text()).toBe('User-agent: *\nDisallow: /\n');
    expect(await (await request.get('/sitemap.xml')).text()).not.toContain('<loc>');
    expect(await (await request.get('/feed.xml')).text()).not.toContain('<item>');
    // O título publicado continua valendo
    await expect(page).toHaveTitle('Loyalty News — SEO publicado (MOCK)');
  });
});

test.describe('conteúdo hostil do Studio (XSS): nada executa, destinos reservados são recusados', () => {
  test.skip(siteMode !== 'malicioso', 'somente com PORTAL_API_SITE=malicioso');

  const flags = ['name', 'url', 'hash', 'logo', 'sameas', 'menu', 'titulo', 'resumo', 'credito', 'alt', 'evento', 'local', 'evurl', 'evfonte'];
  const executou = (page: Page) =>
    page.evaluate((fs) => fs.filter((f) => (window as unknown as Record<string, unknown>)[`__xss_${f}`] !== undefined), flags);

  test('home: o </script> do JSON-LD Organization/menu/SEO não injeta script; o JSON-LD continua válido e com o texto original', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(await executou(page)).toEqual([]);
    expect(dialogs).toEqual([]);
    const lds = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>);
    const org = lds.find((l) => l['@type'] === 'Organization') as { name: string; url: string; sameAs: string[] } | undefined;
    expect(org?.name).toBe('</script><script>window.__xss_name=1</script>'); // dado, não código
    expect(org?.url).not.toMatch(/[<>]/); // URL normalizada: < e > vão como %3C e %3E
    expect(org?.url).toContain('%3C/script%3E');
    for (const l of org?.sameAs ?? []) expect(l).not.toMatch(/[<>]/);
    // O HTML nunca contém um <script> aberto logo depois de um fechamento com o marcador do ataque
    expect(await page.content()).not.toContain('</script><script>window.__xss');
  });

  test('menu e rodapé: destinos com dot-segments para /studio, /api e /_next são descartados; destino bom permanece', async ({ page }, info) => {
    await page.goto('/');
    const hrefs = await page.locator('header a, footer a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    for (const h of hrefs) {
      expect(h, h).not.toMatch(/^\/(api|studio|_next)(\/|$)/i);
      expect(h, h).not.toMatch(/(^|\/)(\.|%2e){1,2}(\/|$)/i);
      expect(h, h).not.toMatch(/[<>]/);
    }
    const bar = await headerLinks(page, info.project.name);
    await expect(bar.getByRole('link', { name: 'Bom MOCK' })).toHaveAttribute('href', '/agenda');
    for (const n of ['Dots studio', 'Dots api', 'Dots next', 'Filho dots']) await expect(page.getByRole('link', { name: n })).toHaveCount(0);
    await expect(page.locator('footer').getByRole('link', { name: 'Sobre MOCK' })).toHaveAttribute('href', '/sobre');
    for (const n of ['Filho studio', 'Rodapé api']) await expect(page.locator('footer').getByRole('link', { name: n })).toHaveCount(0);
  });

  test('matéria com título, resumo, crédito e texto alternativo hostis: nada executa e o JSON-LD NewsArticle é seguro', async ({ page }) => {
    await page.goto('/noticia/api-xss');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Matéria hostil');
    await page.waitForLoadState('networkidle');
    expect(await executou(page)).toEqual([]);
    expect(await page.content()).not.toContain('</script><script>window.__xss');
    const lds = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as { headline?: string });
    expect(lds.some((l) => l.headline?.includes('</script>'))).toBe(true); // o texto chega íntegro como dado
  });

  test('evento da agenda com título, local e links hostis: nada executa, links normalizados e JSON-LD Event seguro', async ({ page, request }) => {
    await page.goto('/agenda/ev-xss');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Evento hostil');
    await page.waitForLoadState('networkidle');
    expect(await executou(page)).toEqual([]);
    expect(await page.content()).not.toContain('</script><script>window.__xss');
    const hrefs = await page.locator('main a').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    for (const h of hrefs) expect(h, h).not.toMatch(/[<>]/);
    const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as { '@type'?: string; name?: string }).find((l) => l['@type'] === 'Event');
    expect(ld?.name).toContain('</script>'); // texto como dado
    // O .ics não carrega quebras de linha injetadas nem script
    const ics = await (await request.get('/agenda/ev-xss/ics')).text();
    expect(ics.split('\r\n').every((l) => /^[A-Z-]+(;[A-Z=-]+)?:/.test(l) || l === '')).toBe(true);
  });
});
