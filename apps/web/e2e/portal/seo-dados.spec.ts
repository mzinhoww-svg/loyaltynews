import { expect, test, type Page } from '@playwright/test';

/**
 * SEO das páginas de dados (Intelligence, Moves e agenda) para o lançamento no domínio próprio: título e descrição únicos, canonical e
 * og:url absolutos no domínio do release (NEXT_PUBLIC_SITE_URL), og:image e Twitter Card em toda página, JSON-LD apropriado
 * (Organization, Person, Event) e 404 com a marca, fora do índice. Modo api (fake-api MOCK, mesmos formatos da API real).
 */
const SITE = 'https://portal.example.test';
const PAGINAS = [
  '/intelligence',
  '/intelligence/empresas',
  '/intelligence/empresas/10000000-0000-4000-8000-000000000001',
  '/intelligence/pessoas',
  '/intelligence/pessoas/10000000-0000-4000-8000-000000000201',
  '/moves',
  '/moves/10000000-0000-4000-8000-000000000401',
  '/agenda',
  '/agenda/ev-1',
];

const meta = (page: Page, sel: string) => page.locator(sel).first().getAttribute('content');
async function jsonLd(page: Page) {
  const blocos = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocos.map((b) => JSON.parse(b) as Record<string, unknown>);
}

test.describe('SEO das páginas de dados', () => {
  test.beforeEach(async ({ page }, info) => {
    void page;
    test.skip(info.project.name !== 'desktop', 'metadados não dependem da largura');
    // Os ids vêm do fake-api (modo api); nos modos empty e mock essas páginas não existem.
    test.skip((process.env.PORTAL_MODE ?? 'empty') !== 'api', 'somente no modo api');
  });

  test('título, descrição, canonical, Open Graph e Twitter Card em todas as páginas; títulos e descrições únicos', async ({ page }) => {
    const titulos = new Set<string>();
    const descricoes = new Set<string>();
    for (const rota of PAGINAS) {
      const r = await page.goto(rota);
      expect(r?.status(), rota).toBe(200);
      // O Next transmite os metadados de páginas dinâmicas para navegadores (para robôs de busca são bloqueantes): espera o <title>.
      await expect.poll(() => page.title(), { message: rota }).toMatch(/\| Loyalty News$/);
      const titulo = await page.title();
      const desc = await meta(page, 'meta[name="description"]');
      expect(desc?.length ?? 0, `${rota}: description`).toBeGreaterThan(40);
      titulos.add(titulo);
      descricoes.add(desc!);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical, `${rota}: canonical no domínio do release`).toBe(`${SITE}${rota}`);
      expect(await meta(page, 'meta[property="og:url"]'), `${rota}: og:url`).toBe(`${SITE}${rota}`);
      expect(await meta(page, 'meta[property="og:title"]'), rota).toBeTruthy();
      expect(await meta(page, 'meta[property="og:description"]'), rota).toBe(desc);
      // P2-03 da auditoria do int/031: as páginas de dados usavam /og-padrao.png (arte antiga, 1200×627); a arte do
      // lançamento é /og/padrao.png (1200×630), a mesma do layout. Com seo.ogImage publicado, o publicado vale — o que não
      // pode voltar é o arquivo antigo.
      const ogImage = await meta(page, 'meta[property="og:image"]');
      expect(ogImage, `${rota}: og:image`).toMatch(/^https?:\/\//);
      expect(ogImage, `${rota}: arte antiga /og-padrao.png`).not.toContain('/og-padrao.png');
      expect(await meta(page, 'meta[name="twitter:card"]'), rota).toBe('summary_large_image');
      expect(await meta(page, 'meta[name="twitter:image"]'), `${rota}: twitter:image`).toMatch(/^https?:\/\//);
    }
    expect(titulos.size, 'títulos únicos').toBe(PAGINAS.length);
    expect(descricoes.size, 'descrições únicas').toBe(PAGINAS.length);
  });

  test('og:image das páginas de dados responde 200 e é a arte 1200×630 do lançamento', async ({ request }) => {
    // Caminho relativo: resolve no servidor sob teste (o domínio do build, portal.example.test, não existe no DNS).
    const r = await request.get('/og/padrao.png');
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('image/png');
    const png = await r.body();
    // IHDR: largura e altura são os dois inteiros big-endian nos bytes 16–23.
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
  });

  test('JSON-LD: Organization na empresa, Person (só nome, cargo e empresa) na pessoa, Event no evento', async ({ page }) => {
    await page.goto('/intelligence/empresas/10000000-0000-4000-8000-000000000001');
    const org = (await jsonLd(page)).find((j) => j['@type'] === 'Organization');
    expect(org).toMatchObject({ '@context': 'https://schema.org', name: '[MOCK API] Programa Alfa', url: `${SITE}/intelligence/empresas/10000000-0000-4000-8000-000000000001` });

    await page.goto('/intelligence/pessoas/10000000-0000-4000-8000-000000000201');
    const pessoa = (await jsonLd(page)).find((j) => j['@type'] === 'Person');
    expect(pessoa).toMatchObject({ name: '[MOCK API] Ana Teste', jobTitle: 'CEO (MOCK)', url: `${SITE}/intelligence/pessoas/10000000-0000-4000-8000-000000000201` });
    expect(pessoa?.worksFor).toEqual([{ '@type': 'Organization', name: '[MOCK API] Programa Alfa', url: `${SITE}/intelligence/empresas/10000000-0000-4000-8000-000000000001` }]);
    // Escopo de dado pessoal (DP-11 P4): nada além de nome, cargo e empresa.
    expect(Object.keys(pessoa ?? {}).sort()).toEqual(['@context', '@type', 'jobTitle', 'name', 'url', 'worksFor']);

    await page.goto('/agenda/ev-1');
    const ev = (await jsonLd(page)).find((j) => j['@type'] === 'Event');
    expect(ev).toMatchObject({ name: '[MOCK] Congresso publicado' });
  });

  test('robô de busca recebe os metadados no HTML da primeira resposta (sem depender de JavaScript)', async ({ request }) => {
    const ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
    for (const rota of ['/intelligence/empresas/10000000-0000-4000-8000-000000000001', '/intelligence/pessoas/10000000-0000-4000-8000-000000000201', '/agenda/ev-1']) {
      const html = await (await request.get(rota, { headers: { 'user-agent': ua } })).text();
      const head = html.split('</head>')[0] ?? '';
      expect(head, `${rota}: <title> no <head>`).toMatch(/<title>[^<]+\| Loyalty News<\/title>/);
      expect(head, `${rota}: description`).toMatch(/<meta name="description" content="[^"]{40,}"/);
      expect(head, `${rota}: canonical`).toContain(`<link rel="canonical" href="${SITE}${rota}"/>`);
      expect(html, `${rota}: JSON-LD`).toContain('application/ld+json');
    }
  });

  test('404 com a marca: status 404, título próprio, noindex, cabeçalho e rodapé do portal', async ({ page }) => {
    // Inclui endereços de vários níveis que não casam com rota nenhuma: antes caíam no 404 padrão do Next, em inglês e sem a marca.
    for (const rota of ['/intelligence/empresas/10000000-0000-4000-8000-000000000999', '/intelligence/pessoas/10000000-0000-4000-8000-000000000999', '/moves/nao-e-uuid', '/x/y/z', '/intelligence/nao/existe']) {
      const r = await page.goto(rota);
      expect(r?.status(), rota).toBe(404);
      await expect.poll(() => page.title(), { message: rota }).toBe('Página não encontrada | Loyalty News');
      expect(await meta(page, 'meta[name="robots"]'), rota).toMatch(/noindex/);
      await expect(page.locator('header').first(), rota).toBeVisible();
      await expect(page.locator('footer').first(), rota).toBeVisible();
      await expect(page.getByText('Não encontramos o que você procurava'), rota).toBeVisible();
    }
  });
});
