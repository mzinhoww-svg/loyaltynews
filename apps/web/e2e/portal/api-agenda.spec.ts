import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import path from 'node:path';

/**
 * Agenda do Studio (GET /api/publico/agenda[/id]) e estados de carregando, vazio e erro do modo api.
 * O servidor MOCK (e2e/fake-api.mjs) devolve eventos só com data, sem organizador nem modalidade (como o Backend).
 */
const SHOTS = path.resolve(import.meta.dirname, '..', 'screenshots', 'api');

test.skip(process.env.PORTAL_MODE !== 'api' || Boolean(process.env.PORTAL_API_DOWN), 'somente no modo api com a API no ar');

test.describe('agenda do Studio', () => {
  test('lista os eventos aprovados com data, local, patrocínio e link para a página interna; sem organizador inventado', async ({ page }, info) => {
    await page.goto('/agenda');
    const rows = page.getByTestId('event-row');
    await expect(rows).toHaveCount(2);
    const ev1 = rows.filter({ hasText: 'Congresso publicado' });
    await expect(ev1.getByRole('link', { name: /Congresso publicado/ })).toHaveAttribute('href', '/agenda/ev-1');
    await expect(ev1).toContainText('São Paulo (MOCK)');
    await expect(ev1).toContainText(' a '); // intervalo de dias
    await expect(ev1).not.toContainText('Patrocinado');
    await expect(ev1).not.toContainText(/\d{2}:\d{2}/); // nunca inventa horário
    await expect(rows.filter({ hasText: 'Fórum patrocinado' })).toContainText('Patrocinado');
    await expect(page.getByText('Organizador')).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-agenda.png`), fullPage: true });
  });

  test('filtros online/presencial não classificam por palpite: modalidade desconhecida só aparece em "Todos"', async ({ page }) => {
    for (const f of ['online', 'presencial']) {
      await page.goto(`/agenda?filtro=${f}`);
      await expect(page.getByTestId('event-row')).toHaveCount(0);
      await expect(page.getByText('Nenhum evento verificado por enquanto')).toBeVisible();
    }
  });

  test('página do evento: só campos publicados, link oficial, fonte, calendário e JSON-LD sem organizador', async ({ page }, info) => {
    await page.goto('/agenda/ev-1');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK] Congresso publicado');
    const main = page.locator('main');
    await expect(main.getByText('Quando')).toBeVisible();
    await expect(main.locator('dd').first()).toContainText(' a ');
    await expect(main.getByText('Onde')).toBeVisible();
    await expect(main).toContainText('São Paulo (MOCK)');
    await expect(main.getByText('Organizador')).toHaveCount(0);
    await expect(main.getByText('Preço')).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'Página oficial do evento' })).toHaveAttribute('href', 'https://evento.example/mock');
    await expect(main.getByRole('link', { name: 'Fonte da informação' })).toHaveAttribute('href', 'https://fonte.example/evento-mock');
    await expect(main.getByRole('link', { name: /Adicionar ao calendário/ })).toHaveAttribute('href', '/agenda/ev-1/ics');
    await expect(page).toHaveTitle(/Congresso publicado/);
    const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t) as Record<string, unknown>).find((l) => l['@type'] === 'Event');
    expect(ld).toMatchObject({ name: '[MOCK] Congresso publicado', location: { '@type': 'Place', name: 'São Paulo (MOCK)' }, url: 'https://evento.example/mock' });
    expect(ld).not.toHaveProperty('organizer');
    expect(ld).not.toHaveProperty('eventAttendanceMode');
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-agenda-evento.png`), fullPage: true });
  });

  test('evento patrocinado é rotulado e sem link oficial não ganha botão', async ({ page }) => {
    await page.goto('/agenda/ev-2');
    await expect(page.getByTestId('event-sponsored')).toHaveText('Patrocinado');
    await expect(page.getByRole('link', { name: 'Página oficial do evento' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Adicionar ao calendário/ })).toBeVisible();
  });

  test('evento já encerrado abre pela rota por id; id inexistente dá 404 do portal', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/agenda/ev-passado');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK] Evento encerrado');
    await expect(page.getByTestId('event-sponsored')).toHaveCount(0);
    const res = await page.goto('/agenda/nao-existe');
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Não encontramos o que você procurava')).toBeVisible();
  });

  test('.ics: dia inteiro, sem horário inventado e sem organizador; inexistente = 404', async ({ request }) => {
    const r = await request.get('/agenda/ev-1/ics');
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('text/calendar');
    const body = await r.text();
    expect(body).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
    expect(body).toMatch(/DTEND;VALUE=DATE:\d{8}/);
    expect(body).toContain('SUMMARY:[MOCK] Congresso publicado');
    expect(body).toContain('LOCATION:São Paulo (MOCK)');
    expect(body).not.toMatch(/ORGANIZER/);
    expect((await request.get('/agenda/nao-existe/ics')).status()).toBe(404);
  });

  test('axe (WCAG A/AA) na agenda e no evento', async ({ page }) => {
    test.setTimeout(90_000);
    for (const p of ['/agenda', '/agenda/ev-1', '/agenda/ev-2']) {
      await page.goto(p);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
      expect(summary, `${p}: ${summary.join(' ; ')}`).toEqual([]);
    }
  });

  test('home: agenda do portal lista os próximos eventos com link interno', async ({ page }) => {
    await page.goto('/');
    const agenda = page.locator('section[aria-labelledby="home-agenda"]');
    await expect(agenda.getByRole('link', { name: /Congresso publicado/ }).first()).toHaveAttribute('href', '/agenda/ev-1');
  });
});

test.describe('estados de carregando e de erro (modo api)', () => {
  test('carregando: a busca do cabeçalho mostra "Buscando…" com esqueleto até a resposta chegar, e depois o vazio honesto', async ({ page, request }, info) => {
    test.setTimeout(90_000);
    // /busca não tem mais loading.tsx (o streaming esconde o conteúdo sem JavaScript; a busca precisa funcionar sem JS). O estado "carregando" da busca
    // é o do campo do cabeçalho. Portão determinístico no servidor MOCK: a resposta só sai quando este teste a libera, depois de ver o estado.
    const chave = `${info.project.name}-${info.parallelIndex}-${Date.now()}`;
    const termo = `portao-${chave}`;
    const fakeApi = `http://localhost:${Number(process.env.PORTAL_PORT_BASE) ? Number(process.env.PORTAL_PORT_BASE) + 4 : 3104}`;
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as unknown as { next?: { router?: unknown } }).next?.router));
    await page.getByRole('button', { name: 'Abrir busca' }).click();
    await page.getByRole('combobox', { name: 'Buscar matérias' }).fill(termo);
    await expect(page.getByTestId('busca-carregando')).toHaveText('Buscando…');
    await expect(page.locator('.ln-hsearch__panel')).toHaveAttribute('aria-busy', 'true');
    // Libera a resposta: nada encontrado (honesto), não erro.
    expect((await request.post(`${fakeApi}/__portao/abrir?chave=${encodeURIComponent(chave)}`)).ok()).toBe(true);
    await expect(page.getByTestId('busca-vazio')).toContainText(`Nada encontrado para “${termo}”`, { timeout: 15_000 });
    await expect(page.getByTestId('busca-carregando')).toHaveCount(0);
    await expect(page.getByTestId('busca-erro')).toHaveCount(0);
  });

  test('erro: a busca com a API em falha mostra erro (não "Nenhum resultado"), sem 500, sem detalhe interno, sem MOCK', async ({ page }) => {
    const erros: string[] = [];
    page.on('pageerror', (e) => erros.push(e.message));
    const res = await page.goto('/busca?q=falha');
    expect(res?.status()).toBe(200);
    const err = page.getByTestId('error-state');
    await expect(err).toBeVisible();
    await expect(err.getByRole('alert')).toBeVisible();
    await expect(err).toContainText('Não conseguimos buscar agora');
    await expect(err.getByRole('link', { name: 'Tentar de novo' })).toHaveAttribute('href', '/busca?q=falha');
    await expect(page.getByText(/Nenhum resultado para/)).toHaveCount(0);
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/Banco não configurado|NOT_CONFIGURED|detalhe interno|Internal Server Error|Application error/);
    expect(erros).toEqual([]);
  });

  test('erro: matéria cuja leitura falha mostra erro com 200 e noindex (não vira 404 nem 500)', async ({ page }) => {
    const res = await page.goto('/noticia/api-falha');
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId('error-state')).toContainText('Não conseguimos carregar esta matéria agora');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByText('Não encontramos o que você procurava')).toHaveCount(0);
  });

  test('vazio honesto continua vazio (não erro): editoria sem matérias e busca sem resultado', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/editoria/tech');
    await expect(page.getByText('Em breve: primeiras matérias')).toBeVisible();
    await expect(page.getByTestId('error-state')).toHaveCount(0);
    await page.goto('/busca?q=zzzz-nada');
    await expect(page.getByText(/Nenhum resultado para/)).toBeVisible();
    await expect(page.getByTestId('error-state')).toHaveCount(0);
  });

  test('axe no estado de erro', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/busca?q=falha');
    await page.waitForLoadState('networkidle');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
    expect(summary, summary.join(' ; ')).toEqual([]);
  });
});
