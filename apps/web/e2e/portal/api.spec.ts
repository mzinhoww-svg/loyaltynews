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

  test('P3-4: sem lateral a coluna de leitura da matéria fica centralizada a 1440 px (antes: ~40% da largura vazia à direita)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'largura de desktop');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/noticia/api-foto-terceiro');
    const artigo = page.locator('article.pt-article');
    await expect(artigo).toBeVisible();
    // este modo não tem anúncio de lateral nem "Em alta": sem lateral
    await expect(page.getByRole('complementary', { name: 'Barra lateral' })).toHaveCount(0);
    const box = (await artigo.boundingBox())!;
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    const esquerda = box.x;
    const direita = vw - (box.x + box.width);
    expect(Math.abs(esquerda - direita), `margens ${Math.round(esquerda)} px à esquerda e ${Math.round(direita)} px à direita`).toBeLessThanOrEqual(2);
    expect(box.width).toBeLessThanOrEqual(760 + 1);
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

  test('N-01: a matéria vinda da API (sem lateral) começa pelo menos 16 px abaixo do cabeçalho', async ({ page }) => {
    await page.goto('/noticia/api-ilustracao-corrigida');
    await expect(page.locator('.ln-breadcrumb')).toBeVisible();
    // A API de teste não traz ranking nem anúncio: não há .pt-layout, e o respiro tem de vir da própria matéria.
    await expect(page.locator('.pt-layout')).toHaveCount(0);
    const gap = await page.evaluate(() => document.querySelector('.ln-breadcrumb')!.getBoundingClientRect().top - document.querySelector('header')!.getBoundingClientRect().bottom);
    expect(gap).toBeGreaterThanOrEqual(16);
  });

  test('D-6: o rótulo da ilustração na miniatura pequena (card sm) tem pelo menos 10 px e cobre no máximo metade da imagem', async ({ page }) => {
    await page.goto('/editoria/pontos');
    const card = page.locator('article.ln-card--sm', { hasText: 'imagem venceu' });
    await expect(card.locator('.ln-card__imglabel')).toBeVisible();
    const m = await card.evaluate((c) => {
      const l = c.querySelector('.ln-card__imglabel')!.getBoundingClientRect();
      const i = c.querySelector('.ln-card__media')!.getBoundingClientRect();
      return { px: parseFloat(getComputedStyle(c.querySelector('.ln-card__imglabel')!).fontSize), cobertura: (l.width * l.height) / (i.width * i.height) };
    });
    expect(m.px).toBeGreaterThanOrEqual(10);
    expect(m.cobertura).toBeLessThanOrEqual(0.5);
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
    // DP-54: formato disponível com canal desligado sai com a ressalva que veio da API — nunca "Disponível" puro.
    const comRessalva = precos.getByRole('row', { name: /Banner entre seções.*Disponível para proposta, com ressalva/ });
    await expect(comRessalva).toBeVisible();
    await expect(comRessalva.getByTestId('mk-ressalva')).toContainText('a entrega só começa com o canal ativo');
    // "Banner meio" está na 2ª categoria (P3-5: recolhida por padrão): abre-se pelo título antes de conferir a linha
    await page.getByTestId('mk-preco-secao').nth(1).locator('summary').click();
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

  test('P3-5: categorias de preço recolhíveis (details): a primeira aberta, as demais fechadas, o título é alvo de 44 px e a página fica mais curta', async ({ page }, info) => {
    await page.goto('/midia-kit');
    await aguardarHidratacao(page);
    const secoes = page.getByTestId('mk-preco-secao');
    await expect(secoes.nth(1).locator('summary')).toBeVisible(); // a seção chega no streaming e só depois troca de lugar
    expect(await secoes.count()).toBe(2); // Banners e The Loyal no mock
    await expect(secoes.nth(0)).toHaveJSProperty('open', true);
    await expect(secoes.nth(1)).toHaveJSProperty('open', false);
    // o título mostra a categoria e quantos formatos ela tem
    await expect(secoes.nth(1).locator('summary')).toContainText('The Loyal');
    await expect(secoes.nth(1).locator('summary')).toContainText(/\(\d+ formatos?\)/);
    // alvo de toque do título: >= 44 px de altura
    const alturaTitulo = (await secoes.nth(1).locator('summary').boundingBox())!.height;
    expect(alturaTitulo, 'altura do título da categoria').toBeGreaterThanOrEqual(43.5);
    // fechada: as linhas ficam fora da vista; aberta pelo título: aparecem, e a página cresce
    const rolagemFechada = await page.evaluate(() => document.documentElement.scrollHeight);
    await expect(secoes.nth(1).getByRole('row').nth(1)).toBeHidden();
    await secoes.nth(1).locator('summary').click();
    await expect(secoes.nth(1)).toHaveJSProperty('open', true);
    await expect(secoes.nth(1).getByRole('row').nth(1)).toBeVisible();
    const rolagemAberta = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(rolagemAberta, `página fechada ${rolagemFechada} px, aberta ${rolagemAberta} px`).toBeGreaterThan(rolagemFechada);
    expect(info.project.name.length).toBeGreaterThan(0);
  });

  test('P3-5 impressão: todas as categorias de preço saem no papel (tabela e título visíveis), sem seta nem marcador de abrir', async ({ page }) => {
    await page.goto('/midia-kit');
    await aguardarHidratacao(page);
    const secoes = page.getByTestId('mk-preco-secao');
    await expect(secoes.nth(1).locator('summary')).toBeVisible(); // a seção chega no streaming e só depois troca de lugar
    const n = await secoes.count();
    expect(n).toBeGreaterThanOrEqual(2);
    // na tela, a 2ª categoria segue recolhida
    await expect(secoes.nth(1)).toHaveJSProperty('open', false);
    await expect(secoes.nth(1).locator('table')).toBeHidden();

    await page.emulateMedia({ media: 'print' });
    for (let i = 0; i < n; i++) {
      const secao = secoes.nth(i);
      await expect(secao.locator('summary'), `título ${i}`).toBeVisible();
      await expect(secao.locator('summary'), `título ${i}`).toContainText(/\(\d+ formatos?\)/);
      await expect(secao.locator('table'), `tabela ${i}`).toBeVisible();
      await expect(secao.getByRole('row').nth(1), `primeira linha de dados ${i}`).toBeVisible();
      // nem o marcador padrão (list-item) nem uma seta gerada (::before): nada de "abrir/fechar" no papel
      const marcador = await secao.locator('summary').evaluate((el) => ({ display: getComputedStyle(el).display, antes: getComputedStyle(el, '::before').content, listStyle: getComputedStyle(el).listStyleType }));
      expect(marcador.display, `marcador ${i}`).not.toBe('list-item');
      expect(['none', 'normal'], `seta ${i}`).toContain(marcador.antes);
      expect(marcador.listStyle, `estilo de lista ${i}`).toBe('none');
    }
    // imprimir não abre nem fecha nada: o estado do <details> é o mesmo, só o conteúdo aparece
    await expect(secoes.nth(1)).toHaveJSProperty('open', false);

    await page.emulateMedia({ media: 'screen' });
    await expect(secoes.nth(1).locator('table')).toBeHidden(); // de volta à tela: recolhida de novo
  });

  test('P3-5 indicador: na tela o resumo mostra ▸ fechado e ▾ aberto (sem ser lido), na cor do título, a 8 px do texto, com 44 px e foco visível', async ({ page }) => {
    await page.goto('/midia-kit');
    await aguardarHidratacao(page);
    const secoes = page.getByTestId('mk-preco-secao');
    await expect(secoes.nth(1).locator('summary')).toBeVisible();
    const seta = (i: number) => secoes.nth(i).locator('summary').evaluate((el) => {
      const antes = getComputedStyle(el, '::before'); const resumo = getComputedStyle(el);
      return { conteudo: antes.content, cor: antes.color, corTitulo: resumo.color, largura: antes.width, espaco: resumo.columnGap, fonte: resumo.fontSize, altura: el.getBoundingClientRect().height };
    });
    // 1ª aberta: ▾; 2ª fechada: ▸. O texto alternativo é vazio (/ ""): o leitor de tela não lê o símbolo.
    const aberta = await seta(0); const fechada = await seta(1);
    expect(aberta.conteudo).toContain('▾'); expect(fechada.conteudo).toContain('▸');
    for (const s of [aberta, fechada]) {
      expect(s.conteudo).toMatch(/\/\s*""$/);
      expect(s.cor).toBe(s.corTitulo); // cor do texto do título
      expect(s.espaco).toBe('8px'); // 8 px entre a seta e o texto
      expect(s.altura).toBeGreaterThanOrEqual(43.5); // o resumo continua com 44 px
    }
    // largura fixa de 1em nos dois estados: o título não pula ao abrir (só igualar as duas não basta: os dois glifos têm a mesma largura natural)
    for (const s of [aberta, fechada]) expect(parseFloat(s.largura)).toBeCloseTo(parseFloat(s.fonte), 1);
    // foco visível no resumo (anel do design system), lido antes de qualquer clique (depois de um clique o Chromium não mostra o anel em foco programático)
    const foco = await focarELer(secoes.nth(1).locator('summary'));
    expect(foco.focado).toBe(true);
    expect(foco.estiloAnel).not.toBe('none');
    expect(foco.larguraAnel).toBeGreaterThan(0);
    // abrir e fechar troca a seta
    await secoes.nth(1).locator('summary').click();
    expect((await seta(1)).conteudo).toContain('▾');
    await secoes.nth(1).locator('summary').click();
    expect((await seta(1)).conteudo).toContain('▸');
  });

  test('P3-5 indicador: em impressão não há seta em nenhum estado (aberta nem fechada)', async ({ page }) => {
    await page.goto('/midia-kit');
    await aguardarHidratacao(page);
    const secoes = page.getByTestId('mk-preco-secao');
    await expect(secoes.nth(1).locator('summary')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    const n = await secoes.count();
    for (let i = 0; i < n; i++) {
      const aberta = await secoes.nth(i).evaluate((e) => (e as HTMLDetailsElement).open);
      const antes = await secoes.nth(i).locator('summary').evaluate((el) => getComputedStyle(el, '::before').content);
      expect(['none', 'normal'], `categoria ${i} (aberta: ${aberta})`).toContain(antes);
    }
    // a categoria aberta é o caso de maior especificidade ([open]): garante que ela também perde a seta no papel
    expect(await secoes.nth(0).evaluate((e) => (e as HTMLDetailsElement).open)).toBe(true);
  });

  test('P3-5 indicador: axe sem violações (padrão e todas abertas) e sem rolagem horizontal a 390 e 320 px', async ({ page }) => {
    await page.goto('/midia-kit');
    await aguardarHidratacao(page);
    await expect(page.getByTestId('mk-preco-secao').nth(1).locator('summary')).toBeVisible();
    const axe = async () => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => `${v.id}: ${v.nodes.length}`);
    expect(await axe()).toEqual([]);
    await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>('details.pt-fold').forEach((d) => { d.open = true; }));
    expect(await axe()).toEqual([]);
    for (const largura of [390, 320]) {
      await page.setViewportSize({ width: largura, height: 800 });
      await page.goto('/midia-kit');
      await aguardarHidratacao(page);
      await expect(page.getByTestId('mk-preco-secao').nth(1).locator('summary')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${largura}px recolhidas`).toBe(true);
      await page.evaluate(() => document.querySelectorAll<HTMLDetailsElement>('details.pt-fold').forEach((d) => { d.open = true; }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${largura}px todas abertas`).toBe(true);
    }
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
    // P3-5: a segunda categoria (The Loyal) fica recolhida; abre-se pelo título, POR TECLADO (Enter), antes de focar a tabela: o clique do mouse
    // faria o foco programático seguinte não mostrar o anel (heurística do :focus-visible).
    await expect(precos.nth(0)).toBeVisible(); // a seção chega no streaming e só depois troca de lugar: espera a troca terminar antes de abrir a 2ª (senão o estado aberto se perde)
    await expect(precos.nth(1)).toBeHidden();
    await page.getByTestId('mk-preco-secao').nth(1).locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(precos.nth(1)).toBeVisible(); // int/017: /midia-kit dinâmico com esqueleto; a tabela chega oculta no streaming e só depois troca de lugar
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
