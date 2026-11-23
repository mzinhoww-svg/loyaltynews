import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Publicidade no modo api (contrato do @ln/commercial). O servidor MOCK (e2e/fake-api.mjs) responde o PLANO conforme PORTAL_API_ADS:
 *   com  = TOP (1280×150) e SIDEBAR_1 (336×280) disponíveis, as demais ocultas;  sem = nenhuma posição disponível.
 * O serve e o evento são chamadas do NAVEGADOR ao próprio portal: aqui são interceptadas (page.route), então o teste controla a resposta.
 */
const ads = process.env.PORTAL_API_ADS ?? '';
test.skip(process.env.PORTAL_MODE !== 'api' || Boolean(process.env.PORTAL_API_DOWN) || !['com', 'sem'].includes(ads), 'somente no modo api com PORTAL_API_ADS=com|sem');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const creative = (positionId: string, w: number, h: number, impressionId: string | null = `imp-${positionId}`) => ({
  kind: 'creative', creativeId: `cr-${positionId}`, impressionId, counted: impressionId !== null,
  ad: { positionId, creativeId: `cr-${positionId}`, label: 'Publicidade', advertiser: 'Anunciante de teste (MOCK)', imageSrc: `/api/commercial/ads/creative-image?id=cr-${positionId}`, alt: `Banner ${positionId} de teste (MOCK)`, width: w, height: h, href: `/api/commercial/ads/click?ref=imp-${positionId}`, impressionId },
});

interface Calls { serve: { positionId: string; pageViewId: string }[]; events: { impressionId: string; event: string }[] }
async function mockAds(page: Page, respond: (positionId: string) => unknown): Promise<Calls> {
  const calls: Calls = { serve: [], events: [] };
  await page.route('**/api/commercial/ads/serve', async (r: Route) => {
    const body = r.request().postDataJSON() as { positionId: string; pageViewId: string };
    calls.serve.push(body);
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respond(body.positionId)) });
  });
  await page.route('**/api/commercial/ads/event', async (r) => {
    calls.events.push(r.request().postDataJSON() as { impressionId: string; event: string });
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ counted: true }) });
  });
  await page.route('**/api/commercial/ads/creative-image**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  return calls;
}
// No mobile (≤ 767 px) o criativo tem de ser de formato mobile (320×100 ou 300×250); no desktop, o do plano.
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1440) <= 767;
const dims = (id: string, page: Page) => (isMobile(page) ? (id === 'TOP' ? ([320, 100] as const) : ([300, 250] as const)) : id === 'TOP' ? ([1280, 150] as const) : ([336, 280] as const));

test.describe('plano sem criativo real', () => {
  test.skip(ads !== 'sem', 'somente com PORTAL_API_ADS=sem');
  test('nenhuma posição aparece, nenhum espaço é reservado e o navegador nem chama o serve', async ({ page }) => {
    const calls = await mockAds(page, (p) => creative(p, ...dims(p, page)));
    await page.goto('/noticias');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('portal-ad')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Publicidade' })).toHaveCount(0);
    await expect(page.getByText('espaço reservado')).toHaveCount(0);
    expect(calls.serve).toEqual([]);
    expect(calls.events).toEqual([]);
  });
});

test.describe('plano com criativo (TOP e SIDEBAR_1)', () => {
  test.skip(ads !== 'com', 'somente com PORTAL_API_ADS=com');

  test('só as posições do plano aparecem; rótulo Publicidade, anunciante, imagem e link patrocinado; um pageViewId por página', async ({ page }) => {
    const calls = await mockAds(page, (p) => creative(p, ...dims(p, page)));
    await page.goto('/noticias');
    const top = page.locator('[data-testid="portal-ad"][data-position="TOP"]');
    const side = page.locator('[data-testid="portal-ad"][data-position="SIDEBAR_1"]');
    await expect(top).toHaveAttribute('data-state', 'ad');
    await expect(side).toHaveAttribute('data-state', 'ad');
    await expect(page.getByTestId('portal-ad')).toHaveCount(2); // SIDEBAR_2/3 e FOOTER não estão no plano
    await expect(top.getByRole('group', { name: 'Publicidade' })).toBeVisible();
    await expect(top.getByTestId('ad-advertiser')).toContainText('Publicidade · Anunciante de teste (MOCK)');
    const link = top.getByRole('link', { name: /Publicidade: Anunciante de teste/ });
    await expect(link).toHaveAttribute('href', '/api/commercial/ads/click?ref=imp-TOP');
    await expect(link).toHaveAttribute('rel', /sponsored/);
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(top.locator('img')).toHaveAttribute('alt', 'Banner TOP de teste (MOCK)');
    await expect.poll(() => top.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    // O serve é chamado pelo navegador, uma vez por posição, com o MESMO pageViewId
    expect(calls.serve.map((s) => s.positionId).sort()).toEqual(['SIDEBAR_1', 'TOP']);
    expect(new Set(calls.serve.map((s) => s.pageViewId)).size).toBe(1);
    expect(calls.serve[0]!.pageViewId.length).toBeGreaterThan(8);
  });

  test('o HTML do servidor não traz anúncio nem chama o serve: só a caixa reservada das duas posições do plano', async ({ request }) => {
    // Em desenvolvimento a 1ª requisição compila a rota: repete até a página completa chegar.
    let html = '';
    await expect.poll(async () => {
      html = await (await request.get('/noticias')).text();
      return (html.match(/data-testid="portal-ad"/g) ?? []).length;
    }, { timeout: 30_000 }).toBe(2);
    expect(html).not.toContain('Anunciante de teste');
    expect(html).not.toContain('creative-image');
    expect(html).toContain('data-position="TOP"');
    expect(html).toContain('data-position="SIDEBAR_1"');
    // Dimensão reservada = a do plano (evita deslocamento de layout)
    expect(html).toContain('data-reserved="1280x150"');
    expect(html).toContain('data-reserved="336x280"');
  });

  test('visível: só depois de ≥ 50 % por ≥ 1 s, uma única vez, com o impressionId', async ({ page }) => {
    const calls = await mockAds(page, (p) => creative(p, ...dims(p, page)));
    await page.goto('/noticias');
    const top = page.locator('[data-testid="portal-ad"][data-position="TOP"]');
    await expect(top).toHaveAttribute('data-state', 'ad');
    await page.waitForTimeout(300);
    // O anúncio do topo está na dobra: depois de ≥ 1 s o evento sai (uma vez)
    await expect.poll(() => calls.events.filter((e) => e.impressionId === 'imp-TOP').length, { timeout: 8000 }).toBe(1);
    expect(calls.events.find((e) => e.impressionId === 'imp-TOP')).toEqual({ impressionId: 'imp-TOP', event: 'visible' });
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(1500);
    expect(calls.events.filter((e) => e.impressionId === 'imp-TOP')).toHaveLength(1);
  });

  test('impressão não contada (impressionId nulo): o anúncio aparece, mas nenhum evento é enviado', async ({ page }) => {
    const calls = await mockAds(page, (p) => creative(p, ...dims(p, page), null));
    await page.goto('/noticias');
    await expect(page.locator('[data-testid="portal-ad"][data-position="TOP"]')).toHaveAttribute('data-state', 'ad');
    await page.waitForTimeout(2000);
    expect(calls.events).toEqual([]);
  });

  test('sem `ad` na resposta (house) a posição recolhe: nada de espaço reservado nem rótulo', async ({ page }) => {
    await mockAds(page, () => ({ kind: 'house', creativeId: null, impressionId: null, counted: false, reason: 'sem criativo' }));
    await page.goto('/noticias');
    await expect(page.getByTestId('portal-ad')).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Publicidade' })).toHaveCount(0);
  });

  test('erro do serve (500) ou resposta inválida recolhe a posição, sem quebrar a página', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(e.message));
    await page.route('**/api/commercial/ads/serve', (r) => r.fulfill({ status: 500, body: 'erro interno' }));
    await page.goto('/noticias');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('portal-ad')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(erros).toEqual([]);
  });

  test('anúncio com URL perigosa é descartado (javascript:)', async ({ page }) => {
    await mockAds(page, (p) => { const c = creative(p, ...dims(p, page)); c.ad.href = 'javascript:alert(1)'; return c; });
    await page.goto('/noticias');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('portal-ad')).toHaveCount(0);
  });

  test('a lateral existe por causa do anúncio da SIDEBAR_1 mesmo sem "Em alta"', async ({ page }) => {
    await mockAds(page, (p) => creative(p, ...dims(p, page)));
    await page.goto('/noticias');
    await expect(page.getByRole('complementary', { name: 'Barra lateral' })).toBeVisible();
    await expect(page.locator('aside [data-testid="portal-ad"][data-position="SIDEBAR_1"]')).toHaveAttribute('data-state', 'ad');
  });

  test('axe com anúncios no ar', async ({ page }) => {
    test.setTimeout(90_000);
    await mockAds(page, (p) => creative(p, ...dims(p, page)));
    await page.goto('/noticias');
    await expect(page.getByTestId('portal-ad').first()).toHaveAttribute('data-state', 'ad');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
    expect(summary, summary.join(' ; ')).toEqual([]);
  });

  test('navegação interna (sem recarregar) usa um novo pageViewId na página seguinte', async ({ page }) => {
    test.setTimeout(90_000);
    const calls = await mockAds(page, (p) => creative(p, ...dims(p, page)));
    await page.goto('/noticias');
    await expect(page.getByTestId('portal-ad').first()).toHaveAttribute('data-state', 'ad');
    await page.waitForFunction(() => Boolean((window as unknown as { next?: { router?: unknown } }).next?.router));
    const primeiro = calls.serve[0]!.pageViewId;
    await page.evaluate(() => (window as unknown as { next: { router: { push: (u: string) => void } } }).next.router.push('/agenda'));
    await expect(page).toHaveURL(/\/agenda$/);
    await expect.poll(() => calls.serve.some((s) => s.pageViewId !== primeiro), { timeout: 15_000 }).toBe(true);
    const segundo = calls.serve.find((s) => s.pageViewId !== primeiro)!.pageViewId;
    // Todas as posições da mesma página compartilham o id
    await expect.poll(() => new Set(calls.serve.filter((s) => s.pageViewId === segundo).map((s) => s.positionId)).size, { timeout: 15_000 }).toBe(2);
  });

  test('mobile: pede device=mobile, usa o criativo de 320×100 (topo) e 300×250 (sidebar) sem estourar a largura; desktop não manda device', async ({ page }) => {
    const calls = await mockAds(page, (p) => creative(p, ...dims(p, page)));
    await page.goto('/noticias');
    await expect(page.getByTestId('portal-ad').first()).toHaveAttribute('data-state', 'ad');
    const mobile = isMobile(page);
    for (const s of calls.serve) {
      if (mobile) expect((s as { device?: string }).device).toBe('mobile');
      else expect((s as { device?: string }).device).toBeUndefined();
    }
    if (!mobile) return;
    const topBox = page.locator('[data-testid="portal-ad"][data-position="TOP"] .ln-ad__box');
    const sideBox = page.locator('[data-testid="portal-ad"][data-position="SIDEBAR_1"] .ln-ad__box');
    await sideBox.scrollIntoViewIfNeeded();
    const t = (await topBox.boundingBox())!;
    const sd = (await sideBox.boundingBox())!;
    expect(Math.round(t.width)).toBeLessThanOrEqual(320);
    expect(Math.abs(t.width / t.height - 3.2)).toBeLessThan(0.05); // 320×100
    expect(Math.round(sd.width)).toBeLessThanOrEqual(300);
    expect(Math.abs(sd.width / sd.height - 1.2)).toBeLessThan(0.05); // 300×250
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `e2e/screenshots/api/${test.info().project.name}-anuncio-mobile.png`, fullPage: false });
  });

  test('mobile: criativo de formato desktop recebido no mobile NÃO é exibido (recolhe, sem espaço reservado e sem evento de visibilidade)', async ({ page }) => {
    test.skip(!isMobile(page), 'somente no mobile');
    const calls = await mockAds(page, (p) => creative(p, p === 'TOP' ? 1280 : 336, p === 'TOP' ? 150 : 280));
    await page.goto('/noticias');
    await page.waitForLoadState('networkidle');
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('portal-ad')).toHaveCount(0);
    expect(calls.events).toEqual([]);
  });
});
