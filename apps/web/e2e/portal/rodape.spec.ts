import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Rodapé do portal (pedido do proprietário; desenho: auditoria-design/rodape): frase em português, grupos recolhíveis até 1023 px e abertos no desktop,
 * sem sublinhado em repouso, colunas alinhadas, rodapé curto e o botão "Entrar" (login do Studio). Roda nos três modos do portal.
 * Alturas medidas na home do modo vazio (o conteúdo fixo da página não depende de dados); nos modos com matérias só se confere a estrutura.
 */
const mode = (process.env.PORTAL_MODE ?? 'empty') as 'empty' | 'mock' | 'api';
const GRUPOS = ['Editorias (rodapé)', 'Conteúdo', 'Institucional', 'Contato'];

async function pronto(page: Page, largura: number, rota = '/') {
  await page.setViewportSize({ width: largura, height: largura >= 1024 ? 800 : 900 });
  await page.goto(rota);
  await expect(page.locator('main#conteudo')).toBeVisible();
  // hidratado: o grupo já foi fechado (celular e tablet) ou mantido aberto (desktop)
  await page.waitForFunction(() => typeof (window as unknown as { next?: { router?: unknown } }).next?.router === 'object');
  const grupos = page.locator('footer .ln-footer__fold');
  // No modo api com o site publicado no Studio, o rodapé tem os grupos do editor (não os 4 padrão): só se confere que todos seguem a largura.
  if (mode === 'api') await expect(grupos.first()).toBeAttached();
  else await expect(grupos).toHaveCount(4);
  await expect.poll(() => grupos.evaluateAll((els) => els.every((e) => (e as HTMLDetailsElement).open === (window.innerWidth >= 1024)))).toBe(true);
  return page.locator('footer');
}

test.describe('rodapé: texto e links', () => {
  test('a frase é em português e não há nenhum trecho marcado como inglês no rodapé', async ({ page }) => {
    const rodape = await pronto(page, 1280);
    await expect(rodape.locator('.ln-footer__tagline')).toHaveText('Inteligência para quem constrói o futuro da fidelidade.');
    expect(await rodape.evaluate((f) => f.querySelectorAll('[lang]').length)).toBe(0);
    expect(await rodape.innerText()).not.toMatch(/board-level|global network/i);
  });

  test('nenhum link do rodapé é sublinhado em repouso; o hover e o foco sublinham', async ({ page }) => {
    const rodape = await pronto(page, 1280);
    const links = rodape.locator('a');
    const n = await links.count();
    expect(n).toBeGreaterThanOrEqual(mode === 'api' ? 3 : 27);
    const sublinhados = await links.evaluateAll((els) => els.filter((e) => getComputedStyle(e).textDecorationLine.includes('underline')).length);
    expect(sublinhados, 'links sublinhados em repouso').toBe(0);
    const um = rodape.getByRole('link', { name: mode === 'api' ? 'Nossa metodologia' : 'Sobre', exact: true });
    await um.hover();
    await expect(um).toHaveCSS('text-decoration-line', 'underline');
    await page.mouse.move(0, 0);
    await um.focus();
    await expect(um).toHaveCSS('text-decoration-line', 'underline');
  });

  test('os 4 landmarks de navegação do rodapé continuam com aria-label', async ({ page }) => {
    test.skip(mode === 'api', 'o modo api publica os grupos do rodapé pelo Studio');
    const rodape = await pronto(page, 1280);
    for (const nome of GRUPOS) await expect(rodape.getByRole('navigation', { name: nome })).toHaveCount(1);
  });
});

test.describe('rodapé: grupos por largura', () => {
  test.skip(mode === 'api', 'o modo api publica os grupos do rodapé pelo Studio (os 4 grupos padrão não existem)');
  for (const largura of [390, 768]) {
    test(`a ${largura} px os links ficam ocultos até abrir o grupo; o título tem 48 px; abrir mostra os links`, async ({ page }) => {
      const rodape = await pronto(page, largura);
      const sobre = rodape.getByRole('link', { name: 'Sobre', exact: true });
      await expect(sobre).toBeHidden();
      for (const nome of GRUPOS) {
        const resumo = rodape.getByRole('navigation', { name: nome }).locator('summary');
        expect((await resumo.boundingBox())!.height, `título ${nome}`).toBeGreaterThanOrEqual(47.5);
      }
      await rodape.getByRole('navigation', { name: 'Institucional' }).locator('summary').click();
      await expect(sobre).toBeVisible();
      expect((await sobre.boundingBox())!.height, 'alvo de toque do link').toBeGreaterThanOrEqual(43.5);
      await expect(rodape.getByRole('link', { name: 'Fale conosco' })).toBeHidden(); // os outros grupos continuam fechados
    });
  }

  test('a 1280 px os 27 links estão visíveis sem clique, sem botão "+/−" e com alvo de 32 px', async ({ page }) => {
    const rodape = await pronto(page, 1280);
    const links = rodape.locator('.ln-footer__list a');
    expect(await links.count()).toBe(27);
    for (const l of await links.all()) {
      await expect(l).toBeVisible();
      expect((await l.boundingBox())!.height).toBeGreaterThanOrEqual(31.5);
    }
    await expect(rodape.locator('summary').first()).toHaveCSS('pointer-events', 'none');
    expect(await rodape.locator('summary').first().evaluate((e) => getComputedStyle(e, '::after').content)).toBe('none');
  });

  test('sem JavaScript todos os links existem no HTML e os grupos vêm abertos', async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/');
    expect(await page.locator('footer .ln-footer__list a').count()).toBe(27);
    expect(await page.locator('footer details[open]').count()).toBe(4);
    await expect(page.locator('footer').getByRole('link', { name: 'Sobre', exact: true })).toBeVisible();
    await ctx.close();
  });

  test('o grupo fecha no celular, abre no desktop e acompanha a mudança de largura', async ({ page }) => {
    await pronto(page, 390);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(() => page.locator('footer .ln-footer__fold').evaluateAll((els) => els.every((e) => (e as HTMLDetailsElement).open))).toBe(true);
    await page.setViewportSize({ width: 768, height: 900 });
    await expect.poll(() => page.locator('footer .ln-footer__fold').evaluateAll((els) => els.every((e) => !(e as HTMLDetailsElement).open))).toBe(true);
  });
});

test.describe('rodapé: altura e alinhamento (home do modo vazio)', () => {
  test.skip(mode !== 'empty', 'as alturas-alvo são da home sem matérias');
  const MAXIMA: Record<number, number> = { 390: 560, 768: 420, 1280: 440 };
  for (const largura of [390, 768, 1280]) {
    test(`a ${largura} px o rodapé tem no máximo ${MAXIMA[largura]} px`, async ({ page }) => {
      const rodape = await pronto(page, largura);
      const h = (await rodape.boundingBox())!.height;
      expect(h, `altura ${Math.round(h)} px a ${largura} px`).toBeLessThanOrEqual(MAXIMA[largura]!);
    });
  }

  test('alinhamento: a 768 px as colunas começam em duas posições x e a 1280 px os 4 grupos têm o mesmo topo', async ({ page }) => {
    let rodape = await pronto(page, 768);
    const pos = async (nome: string) => {
      const b = (await rodape.getByRole('navigation', { name: nome }).boundingBox())!;
      return { x: Math.round(b.x), y: Math.round(b.y) };
    };
    const [ed, co, ins, ct] = [await pos('Editorias (rodapé)'), await pos('Conteúdo'), await pos('Institucional'), await pos('Contato')];
    expect(ed.x, 'Editorias e Institucional na mesma coluna').toBe(ins.x);
    expect(co.x, 'Conteúdo e Contato na mesma coluna').toBe(ct.x);
    expect(ed.y).toBe(co.y);
    expect(ins.y).toBe(ct.y);
    expect(co.x).toBeGreaterThan(ed.x);
    rodape = await pronto(page, 1280);
    const topos = await Promise.all(GRUPOS.map(async (n) => Math.round((await rodape.getByRole('navigation', { name: n }).boundingBox())!.y)));
    expect(new Set(topos).size, `topos ${topos.join(', ')}`).toBe(1);
  });
});

test.describe('rodapé e cabeçalho: "Entrar"', () => {
  for (const largura of [390, 768, 1280]) {
    test(`a ${largura} px o botão "Entrar" do rodapé tem 44 px e leva ao login do Studio`, async ({ page }) => {
      const rodape = await pronto(page, largura);
      const entrar = rodape.getByRole('link', { name: 'Entrar', exact: true });
      await expect(entrar).toBeVisible();
      await expect(entrar).toHaveAttribute('href', '/studio/entrar');
      expect((await entrar.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    });
  }

  test('no celular o "Entrar" também está no painel do Menu e o cabeçalho não estoura a 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await page.waitForFunction(() => typeof (window as unknown as { next?: { router?: unknown } }).next?.router === 'object');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await expect(page.locator('header').getByRole('link', { name: 'Entrar' })).toBeHidden(); // na barra não cabe: só no painel
    await page.getByRole('button', { name: /Menu/ }).click();
    const noPainel = page.locator('header .ln-header__panel').getByRole('link', { name: 'Entrar' });
    await expect(noPainel).toBeVisible();
    await expect(noPainel).toHaveAttribute('href', '/studio/entrar');
    expect((await noPainel.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  });

  test('no desktop o "Entrar" é um link de texto no cabeçalho, à esquerda do Anuncie, e o painel do menu fica oculto', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    const entrar = page.locator('header .ln-header__entrar');
    await expect(entrar).toBeVisible();
    await expect(entrar).toHaveAttribute('href', '/studio/entrar');
    const anuncie = page.locator('header .ln-header__cta');
    expect((await entrar.boundingBox())!.x).toBeLessThan((await anuncie.boundingBox())!.x);
    await expect(page.locator('header .ln-header__panel-entrar')).toBeHidden();
  });
});

test.describe('rodapé: acessibilidade e responsividade', () => {
  for (const largura of [390, 768, 1280]) {
    test(`axe sem violações a ${largura} px com um grupo aberto e sem rolagem horizontal`, async ({ page }) => {
      test.slow();
      const rodape = await pronto(page, largura);
      if (largura < 1024) await rodape.locator('.ln-footer__col').nth(1).locator('summary').click();
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const resumo = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
      expect(resumo, resumo.join('\n')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }

  test('foco visível no título do grupo e nos links', async ({ page }) => {
    const rodape = await pronto(page, 390);
    const resumo = rodape.locator('.ln-footer__col').nth(1).locator('summary');
    await resumo.focus();
    await expect(resumo).toBeFocused();
    expect(await resumo.evaluate((e) => parseFloat(getComputedStyle(e).outlineWidth))).toBeGreaterThan(0);
  });

  test('prefers-reduced-motion e impressão: sem animação e com todos os grupos visíveis', async ({ page }) => {
    const rodape = await pronto(page, 390);
    await page.emulateMedia({ media: 'print' });
    await expect(rodape.locator('.ln-footer__list a').first()).toBeVisible();
    await expect(rodape.locator('.ln-footer__col').nth(1).locator('.ln-footer__list a').first()).toBeVisible();
    expect(await rodape.locator('summary').first().evaluate((e) => getComputedStyle(e, '::after').content)).toBe('none');
  });
});
