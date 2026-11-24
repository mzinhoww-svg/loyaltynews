import { expect, test } from '@playwright/test';
import path from 'node:path';
import { aguardarHidratacao, focarELer } from './hidratacao';

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
    await expect(menu, 'Esc devolve o foco ao botão do menu').toBeFocused();
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
    // O painel móvel traz as 10 editorias, os conteúdos e o Anuncie; a barra fechada é uma só (≤64 px).
    for (const nome of ['Mercado & Negócios', 'Programas de Fidelidade', 'Pontos & Milhas', 'Bancos & Cartões', 'Varejo & Cashback', 'Travel & Hospitality', 'LoyaltyTech & IA', 'CRM & CX', 'Global Loyalty', 'Regulação & Dados']) {
      await expect(nav.getByRole('link', { name: nome, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Anuncie' })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, 'mobile-menu-aberto.png') });
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(toggle, 'Esc devolve o foco ao botão do menu').toBeFocused();
    await expand(toggle);
    await nav.getByRole('link', { name: 'Pontos & Milhas' }).click();
    await expect(page).toHaveURL(/\/editoria\/pontos$/);
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

test.describe('mídia kit: alvos de toque (UI/UX: mínimo de 44 px no mobile)', () => {
  test('os 10 links de editoria, os botões e os atalhos do mídia kit têm pelo menos 44 × 44 px', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile');
    await page.goto('/midia-kit');
    const alvos = page.locator('#cobertura .pt-table a, main .ln-btn, nav[aria-label="Seções do mídia kit"] a');
    expect(await alvos.count()).toBeGreaterThanOrEqual(13); // 10 editorias + 2 botões + 4 atalhos (a contagem exata muda com o conteúdo)
    const ruins: string[] = [];
    for (const el of await alvos.all()) {
      const box = await el.boundingBox();
      const nome = ((await el.innerText()).trim() || (await el.getAttribute('aria-label')) || '?').slice(0, 40);
      if (!box || box.height < 44 - 0.5 || box.width < 44 - 0.5) ruins.push(`${nome}: ${Math.round(box?.width ?? 0)}×${Math.round(box?.height ?? 0)}`);
    }
    expect(ruins, 'alvos de toque menores que 44 px').toEqual([]);
    expect(await page.locator('#cobertura .pt-table a').count()).toBe(10);
  });
});

test.describe('honestidade de dados', () => {
  test('V-05: cobertura do mídia kit — demonstração leva selo MOCK; sem dado real mostra "—" e "sem dado real"', async ({ page }) => {
    await page.goto('/midia-kit');
    for (const key of ['articles', 'events']) {
      const card = page.getByTestId(`coverage-${key}`);
      const value = (await card.locator(':scope > strong').innerText()).replace(/\s+/g, ' ').trim();
      if (mode === 'mock') {
        if (value.startsWith('—')) continue;
        await expect(card).toHaveAttribute('data-mock', 'true');
        await expect(card).toContainText('MOCK');
        await expect(card).toContainText('Demonstração');
      } else {
        expect(value).toBe('—');
        await expect(card).toContainText('sem dado real');
        await expect(card).toHaveAttribute('data-mock', 'false');
      }
    }
    // Editorias é taxonomia do portal, nunca marcada como demonstração
    await expect(page.getByTestId('coverage-editorias')).toHaveAttribute('data-mock', 'false');
  });

  test('V-13: mídia kit tem o mapa visual das posições, em texto acessível e sem sair da tela no celular', async ({ page }) => {
    await page.goto('/midia-kit');
    const mapa = page.getByTestId('mk-mapa');
    await expect(mapa).toBeVisible();
    await expect(mapa.locator('svg')).toHaveAttribute('role', 'img');
    await expect(mapa.locator('[data-position="TOP"]')).toHaveCount(1);
    await expect(page.getByTestId('mk-mapa-lista')).toContainText('Banner topo');
    const box = await mapa.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await mapa.innerText()).not.toMatch(/R$/);
  });

  test('P2-1: toda tabela com rolagem do mídia kit é região focável, com nome único, e o foco por teclado fica visível', async ({ page }) => {
    await page.goto('/midia-kit');
    const regioes = page.locator('.pt-scroll');
    const n = await regioes.count();
    expect(n).toBeGreaterThanOrEqual(2);
    const nomes: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = regioes.nth(i);
      await expect(r).toHaveAttribute('tabindex', '0');
      await expect(r).toHaveAttribute('role', 'region');
      const nome = (await r.getAttribute('aria-label')) ?? '';
      expect(nome.trim().length).toBeGreaterThan(10);
      nomes.push(nome);
    }
    expect(new Set(nomes).size).toBe(nomes.length); // nomes distintos (leitor de tela diferencia as tabelas)
    // foco: depois da hidratação a região recebe foco e o anel de foco aparece (foco e leitura no mesmo instante, sem repetir)
    const primeira = regioes.first();
    await aguardarHidratacao(page);
    const foco = await focarELer(primeira);
    expect(foco.focado).toBe(true);
    expect(foco.estiloAnel).not.toBe('none');
    expect(foco.larguraAnel).toBeGreaterThanOrEqual(2);
  });

  test('P3-5: no desktop o mapa (≤ 520 px) e a lista ficam lado a lado e a figura é baixa; no celular ficam empilhados', async ({ page }) => {
    await page.goto('/midia-kit');
    const largo = page.viewportSize()!.width >= 1024; // pela largura da tela, não pelo nome do projeto (a rodada geral só tem 'chromium')
    const svg = (await page.locator('[data-testid="mk-mapa"] svg').boundingBox())!;
    const lista = (await page.getByTestId('mk-mapa-lista').boundingBox())!;
    const figura = (await page.getByTestId('mk-mapa').boundingBox())!;
    const vb = (await page.locator('[data-testid="mk-mapa"] svg').getAttribute('viewBox'))!.split(' ').map(Number);
    expect(svg.height / svg.width).toBeCloseTo(vb[3]! / vb[2]!, 1); // proporção preservada
    if (largo) {
      expect(svg.width).toBeLessThanOrEqual(520.5);
      expect(lista.x).toBeGreaterThanOrEqual(svg.x + svg.width); // lista à direita do mapa
      expect(lista.y).toBeLessThan(svg.y + svg.height); // e começa na altura do mapa
      expect(figura.height).toBeLessThan(700); // antes: 1.014 px
    } else {
      const vw = page.viewportSize()!.width;
      expect(svg.width).toBeGreaterThan(vw * 0.8);
      expect(lista.y).toBeGreaterThanOrEqual(svg.y + svg.height); // empilhado
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('P2-a: rótulos do mapa legíveis (≥ 11 px reais) e dentro das caixas, no desktop e no celular', async ({ page }) => {
    await page.goto('/midia-kit');
    const r = await page.evaluate(() => {
      const svg = document.querySelector('[data-testid="mk-mapa"] svg') as SVGSVGElement;
      const k = svg.getScreenCTM()!.a;
      const px = (sel: string) => [...svg.querySelectorAll(sel)].map((t) => parseFloat(getComputedStyle(t).fontSize) * k);
      const fora: string[] = [];
      for (const g of svg.querySelectorAll('g[data-position]')) {
        const rect = g.querySelector('rect')!.getBBox();
        for (const t of g.querySelectorAll('text')) {
          const b = (t as SVGTextElement).getBBox();
          if (b.x < rect.x || b.x + b.width > rect.x + rect.width || b.y < rect.y || b.y + b.height > rect.y + rect.height) fora.push(`${g.getAttribute('data-position')}: ${t.textContent}`);
        }
      }
      const ed = svg.querySelector('[data-testid="mk-mapa-editorial"]')!;
      const er = ed.querySelector('rect')!.getBBox();
      for (const t of ed.querySelectorAll('text')) { const b = (t as SVGTextElement).getBBox(); if (b.x + b.width > er.x + er.width || b.y + b.height > er.y + er.height) fora.push(`editorial: ${t.textContent}`); }
      return { nomes: px('.pt-map-text'), dims: px('.pt-map-small'), legenda: px('.pt-map-cap'), fora };
    });
    for (const v of [...r.nomes, ...r.dims, ...r.legenda]) expect(v).toBeGreaterThanOrEqual(11);
    expect(r.nomes.length).toBeGreaterThan(5);
    expect(r.fora).toEqual([]);
  });

  test('P3-a: kicker do bloco de abertura usa o verde de destaque (#A7DDC9), não branco, e sem estilo inline', async ({ page }) => {
    await page.goto('/midia-kit');
    const kicker = page.locator('.pt-hero-band .pt-kicker');
    await expect(kicker).toHaveText(/Mídia kit · Proposta comercial/i);
    await expect(kicker).toHaveCSS('color', 'rgb(167, 221, 201)');
    expect(await kicker.getAttribute('style')).toBeNull();
  });

  test('P3-b: título de abertura do mídia kit em escala de exibição (≥ 28 px no celular, 44 px no desktop) e sem estourar a tela', async ({ page }) => {
    await page.goto('/midia-kit');
    const largo = page.viewportSize()!.width >= 1024; // pela largura da tela, não pelo nome do projeto (a rodada geral só tem 'chromium')
    const h1 = page.locator('.pt-hero-band--mk h1');
    const size = parseFloat(await h1.evaluate((el) => getComputedStyle(el).fontSize));
    if (largo) expect(size).toBeCloseTo(44, 0); else expect(size).toBeGreaterThanOrEqual(28);
    const lh = parseFloat(await h1.evaluate((el) => getComputedStyle(el).lineHeight)) / size;
    expect(lh).toBeCloseTo(1.15, 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // outros h1 do portal não mudam de escala
    await page.goto('/contato');
    const outro = parseFloat(await page.locator('main h1').first().evaluate((el) => getComputedStyle(el).fontSize));
    expect(outro).toBeLessThanOrEqual(36);
  });

  test('P3-d: Audiência em duas colunas no desktop (tempo real ao lado do histórico) e empilhada no celular, sem perder métrica', async ({ page }) => {
    await page.goto('/midia-kit');
    const largo = page.viewportSize()!.width >= 768; // as duas colunas começam em 768 px
    const grupos = page.getByTestId('audience-groups');
    const [a, b] = await grupos.locator(':scope > div').all();
    const ba = (await a!.boundingBox())!; const bb = (await b!.boundingBox())!;
    await expect(a!.locator('h3')).toHaveText('Tempo real');
    await expect(b!.locator('h3')).toHaveText('Histórico');
    expect(await grupos.locator('.pt-metric').count()).toBeGreaterThanOrEqual(2);
    if (largo) {
      expect(Math.abs(ba.y - bb.y)).toBeLessThan(2); // mesma linha
      expect(bb.x).toBeGreaterThan(ba.x + ba.width - 1);
    } else {
      expect(bb.y).toBeGreaterThanOrEqual(ba.y + ba.height); // empilhado
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('P2-a: rótulos do mapa com ≥ 11 px reais em 320, 360, 390 e 412 px, dentro das caixas e sem sobrepor nome e dimensão', async ({ page }) => {
    for (const largura of [320, 360, 390, 412]) {
      await page.setViewportSize({ width: largura, height: 800 });
      await page.goto('/midia-kit');
      const r = await page.evaluate(() => {
        const svg = document.querySelector('[data-testid="mk-mapa"] svg') as SVGSVGElement;
        const k = svg.getScreenCTM()!.a;
        const px = (sel: string) => [...svg.querySelectorAll(sel)].map((t) => parseFloat(getComputedStyle(t).fontSize) * k);
        const fora: string[] = []; const sobrepoe: string[] = [];
        for (const g of svg.querySelectorAll('g[data-position]')) {
          const rect = g.querySelector('rect')!.getBBox();
          const textos = [...g.querySelectorAll('text')] as SVGTextElement[];
          for (const t of textos) {
            const b = t.getBBox();
            if (b.x < rect.x || b.x + b.width > rect.x + rect.width || b.y < rect.y || b.y + b.height > rect.y + rect.height) fora.push(`${g.getAttribute('data-position')}: ${t.textContent}`);
          }
          if (textos.length === 2) {
            // glifos: o nome desce até a linha de base + 20% do corpo (descendente); a dimensão sobe até a linha de base − 72% (maiúscula/dígito)
            const [n, d] = textos as [SVGTextElement, SVGTextElement];
            const corpo = (t: SVGTextElement) => parseFloat(getComputedStyle(t).fontSize);
            const baseN = parseFloat(n.getAttribute('y')!); const baseD = parseFloat(d.getAttribute('y')!);
            const folga = (baseD - 0.72 * corpo(d)) - (baseN + 0.2 * corpo(n));
            if (folga < 2) sobrepoe.push(`${g.getAttribute('data-position')} (folga ${folga.toFixed(1)})`);
          }
        }
        return { nomes: px('.pt-map-text'), dims: px('.pt-map-small'), legenda: px('.pt-map-cap'), fora, sobrepoe };
      });
      for (const v of [...r.nomes, ...r.dims, ...r.legenda]) expect(v, `${largura}px`).toBeGreaterThanOrEqual(11);
      expect(r.nomes.length).toBeGreaterThan(5);
      expect(r.fora, `${largura}px`).toEqual([]);
      expect(r.sobrepoe, `${largura}px`).toEqual([]);
    }
  });

  test('V-04: botões do bloco de abertura do mídia kit são visíveis (contraste do texto ≥ 4,5:1 e do botão contra o bloco ≥ 3:1)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await page.goto('/midia-kit');
    const r = await page.evaluate(() => {
      const parse = (c: string): [number, number, number, number] => {
        const m = /rgba?\(([^)]+)\)/.exec(c)!; const p = m[1]!.split(',').map((x) => parseFloat(x));
        return [p[0]!, p[1]!, p[2]!, p[3] ?? 1];
      };
      const lum = ([r, g, b]: number[]) => { const f = [r!, g!, b!].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * f[0]! + 0.7152 * f[1]! + 0.0722 * f[2]!; };
      const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
      const bgOf = (el: Element): [number, number, number, number] => { let e: Element | null = el; while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) return c; e = e.parentElement; } return [255, 255, 255, 1]; };
      const hero = document.querySelector('.pt-hero-band')!;
      const heroBg = bgOf(hero);
      const info = (id: string) => {
        const el = document.querySelector(`[data-testid="${id}"]`)!; const cs = getComputedStyle(el);
        const color = parse(cs.color); const own = parse(cs.backgroundColor);
        const bg = own[3] > 0 ? own : heroBg; const border = parse(cs.borderTopColor);
        return { textRatio: ratio(color, bg), buttonVsHero: ratio(own[3] > 0 ? own : border, heroBg), borderWidth: parseFloat(cs.borderTopWidth), borderVisible: border[3] > 0 };
      };
      return { primary: info('mk-cta-primary'), secondary: info('mk-cta-secondary') };
    });
    expect(r.primary.textRatio).toBeGreaterThanOrEqual(4.5);
    expect(r.primary.buttonVsHero).toBeGreaterThanOrEqual(3);
    expect(r.secondary.textRatio).toBeGreaterThanOrEqual(4.5);
    expect(r.secondary.borderWidth).toBeGreaterThan(0);
    expect(r.secondary.buttonVsHero).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('mk-cta-primary')).toBeVisible();
    await expect(page.getByTestId('mk-cta-secondary')).toBeVisible();
  });

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
