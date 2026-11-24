import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { aguardarHidratacao } from './hidratacao';

/**
 * Busca do cabeçalho (pedido do proprietário; desenho: auditoria-design/busca-header): a lupa EXPANDE um campo no próprio cabeçalho, sem navegar, com
 * sugestões de matérias. Roda nos três modos do portal (empty, mock e api): os dados vêm da fonte do portal por GET /busca/sugestoes.
 *   empty → nenhuma matéria: toda busca cai em "nada encontrado" honesto;  mock/api → o termo "teste" acha matérias das fixtures.
 */
const mode = (process.env.PORTAL_MODE ?? 'empty') as 'empty' | 'mock' | 'api';
const TEM_DADOS = mode !== 'empty';
const TERMO = 'teste';

async function abrir(page: Page, rota = '/') {
  await page.goto(rota);
  await expect(page.locator('main#conteudo')).toBeVisible();
  await aguardarHidratacao(page);
  const botao = page.getByRole('button', { name: 'Abrir busca' });
  await expect(botao).toBeVisible();
  await botao.click();
  const campo = page.getByRole('combobox', { name: 'Buscar matérias' });
  await expect(campo).toBeVisible();
  return campo;
}
const sugestoes = (page: Page) => page.getByRole('listbox', { name: 'Sugestões' });

test.describe('busca do cabeçalho: expandir sem navegar', () => {
  test('a lupa expande o campo no próprio cabeçalho, com foco automático e sem mudar de página', async ({ page }) => {
    const campo = await abrir(page, '/noticias');
    await expect(page).toHaveURL(/\/noticias$/);
    await expect(campo).toBeFocused();
    expect(await campo.evaluate((e) => Boolean(e.closest('header')))).toBe(true); // dentro do cabeçalho
    await expect(page.getByRole('heading', { level: 1, name: 'Busca' })).toHaveCount(0); // não abriu a página de busca
    await expect(page.getByRole('search', { name: 'Buscar no portal' })).toBeVisible();
  });

  test('Esc fecha e devolve o foco à lupa; clique fora também fecha, sem devolver o foco', async ({ page }) => {
    const campo = await abrir(page);
    await page.keyboard.press('Escape');
    await expect(campo).toBeHidden();
    await expect(page.getByRole('button', { name: 'Abrir busca' })).toBeFocused();
    await page.getByRole('button', { name: 'Abrir busca' }).click();
    await expect(page.getByRole('combobox', { name: 'Buscar matérias' })).toBeVisible();
    await page.locator('main#conteudo').click({ position: { x: 5, y: 300 }, force: true });
    await expect(page.getByRole('combobox', { name: 'Buscar matérias' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Abrir busca' })).not.toBeFocused();
  });

  test('✕ Limpar busca: só aparece com texto, apaga o termo e mantém o foco no campo', async ({ page }) => {
    const campo = await abrir(page);
    await expect(page.getByRole('button', { name: 'Limpar busca' })).toHaveCount(0);
    await campo.fill('qualquer');
    await page.getByRole('button', { name: 'Limpar busca' }).click();
    await expect(campo).toHaveValue('');
    await expect(campo).toBeFocused();
    await expect(page.getByRole('button', { name: 'Limpar busca' })).toHaveCount(0);
  });

  test('padrão combobox: aria-expanded e aria-controls acompanham a lista de sugestões', async ({ page }) => {
    const campo = await abrir(page);
    await expect(campo).toHaveAttribute('aria-expanded', 'false');
    await expect(campo).toHaveAttribute('aria-autocomplete', 'list');
    await campo.fill(TERMO);
    const lista = sugestoes(page);
    await expect(lista).toBeVisible();
    await expect(campo).toHaveAttribute('aria-expanded', 'true');
    expect(await lista.getAttribute('id')).toBe(await campo.getAttribute('aria-controls'));
  });

  test('trocar de página fecha o campo e limpa o termo', async ({ page }) => {
    const campo = await abrir(page);
    await campo.fill('abc');
    await page.evaluate(() => (window as unknown as { next: { router: { push: (u: string) => void } } }).next.router.push('/noticias'));
    await expect(page).toHaveURL(/\/noticias$/);
    await expect(campo).toBeHidden();
    await page.getByRole('button', { name: 'Abrir busca' }).click();
    await expect(page.getByRole('combobox', { name: 'Buscar matérias' })).toHaveValue('');
  });
});

test.describe('busca do cabeçalho: sugestões', () => {
  test('1 caractere só mostra a dica; 2 chamam a API; digitar rápido gera UM pedido (debounce de 250 ms)', async ({ page }) => {
    const chamadas: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/busca/sugestoes')) chamadas.push(new URL(r.url()).searchParams.get('q') ?? '');
    });
    const campo = await abrir(page);
    await campo.pressSequentially('t');
    await expect(page.getByText('Digite pelo menos 2 caracteres.')).toBeVisible();
    await page.waitForTimeout(600); // mais que o debounce: nada pedido
    expect(chamadas).toEqual([]);
    await campo.pressSequentially('este');
    await expect(page.getByTestId(TEM_DADOS ? 'busca-sugestoes' : 'busca-vazio')).toBeVisible();
    expect(chamadas, 'uma chamada só, com o termo final').toEqual(['teste']);
  });

  test('estado "buscando": mensagem, esqueleto e aria-busy enquanto a resposta não chega', async ({ page }) => {
    let liberar: () => void = () => undefined;
    const portao = new Promise<void>((r) => (liberar = r));
    await page.route('**/busca/sugestoes**', async (r) => {
      await portao;
      await r.continue();
    });
    const campo = await abrir(page);
    await campo.fill(TERMO);
    await expect(page.getByTestId('busca-carregando')).toHaveText('Buscando…');
    await expect(page.locator('.ln-hsearch__panel')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('.ln-hsearch__skel span')).toHaveCount(3);
    liberar();
    await expect(page.getByTestId('busca-carregando')).toHaveCount(0);
  });

  test('até 5 matérias (título em destaque, editoria e data) e "Ver todos os resultados" como última opção; cada uma leva à própria página', async ({ page }) => {
    test.skip(!TEM_DADOS, 'precisa de matérias (mock ou api)');
    const campo = await abrir(page);
    await campo.fill(TERMO);
    const opcoes = page.getByRole('option');
    await expect(opcoes.last()).toContainText('Ver todos os resultados');
    const n = await opcoes.count();
    expect(n, 'de 2 a 6 opções (até 5 matérias + ver todos)').toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(6);
    const hrefs = await opcoes.evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    for (const h of hrefs.slice(0, -1)) expect(h).toMatch(/^\/noticia\/[^/]+$/);
    expect(hrefs[hrefs.length - 1]).toBe(`/busca?q=${TERMO}`);
    // o trecho que casou no título vem em negrito (a busca também casa no resumo: nem toda sugestão tem o termo no título)
    await expect(page.locator('.ln-hsearch__opt-title b').first()).toHaveText(new RegExp(TERMO, 'i'));
    await expect(opcoes.first().locator('.ln-hsearch__opt-meta')).toContainText(/ · \d{1,2} \p{L}+ \d{4}$/u); // editoria · data
  });

  test('nada encontrado: mensagem honesta com o termo e o caminho para a página de resultados continua', async ({ page }) => {
    const campo = await abrir(page);
    await campo.fill('zzzxqyw');
    await expect(page.getByTestId('busca-vazio')).toContainText('Nada encontrado para “zzzxqyw”.');
    await expect(page.getByTestId('busca-vazio')).toContainText('título e no resumo');
    await expect(page.getByTestId('busca-erro')).toHaveCount(0);
    const opcoes = page.getByRole('option');
    await expect(opcoes).toHaveCount(1);
    await expect(opcoes.first()).toContainText('Ver todos os resultados para “zzzxqyw”');
  });

  test('falha da busca é outro estado (nunca "nada encontrado"): diz que isso não significa ausência de resultados', async ({ page }) => {
    await page.route('**/busca/sugestoes**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    const campo = await abrir(page);
    await campo.fill(TERMO);
    await expect(page.getByTestId('busca-erro')).toContainText('Não conseguimos buscar agora.');
    await expect(page.getByTestId('busca-erro')).toContainText('Isso não significa que não haja resultados.');
    await expect(page.getByTestId('busca-vazio')).toHaveCount(0);
    await expect(page.getByRole('option')).toHaveCount(1); // só "Ver todos os resultados"
  });

  test('resposta atrasada de um termo antigo nunca sobrescreve a do termo novo', async ({ page }) => {
    await page.route('**/busca/sugestoes**', async (r) => {
      const q = new URL(r.request().url()).searchParams.get('q');
      if (q === 'aaa') await new Promise((ok) => setTimeout(ok, 1200)); // a antiga demora mais
      await r.continue();
    });
    const campo = await abrir(page);
    await campo.fill('aaa');
    await page.waitForTimeout(400); // passou o debounce: o pedido de "aaa" saiu e está pendente
    await campo.fill('zzzxqyw');
    await expect(page.getByTestId('busca-vazio')).toContainText('“zzzxqyw”');
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('busca-vazio')).toContainText('“zzzxqyw”'); // continua o novo
  });
});

test.describe('busca do cabeçalho: teclado e resultados', () => {
  test('setas navegam as opções (aria-activedescendant), Home/End vão às pontas e Enter abre a opção ativa', async ({ page }) => {
    test.skip(!TEM_DADOS, 'precisa de matérias (mock ou api)');
    const campo = await abrir(page);
    await campo.fill(TERMO);
    const opcoes = page.getByRole('option');
    await expect(opcoes.last()).toContainText('Ver todos os resultados');
    await campo.press('ArrowDown');
    await expect(opcoes.first()).toHaveAttribute('aria-selected', 'true');
    expect(await campo.getAttribute('aria-activedescendant')).toBe(await opcoes.first().getAttribute('id'));
    const href = await opcoes.first().getAttribute('href');
    await campo.press('ArrowDown');
    await expect(opcoes.nth(1)).toHaveAttribute('aria-selected', 'true');
    await campo.press('End');
    await expect(opcoes.last()).toHaveAttribute('aria-selected', 'true');
    await campo.press('Home');
    await expect(opcoes.first()).toHaveAttribute('aria-selected', 'true');
    await campo.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Buscar matérias' })).toBeHidden(); // fechou ao navegar
  });

  test('ArrowUp sem opção ativa vai à última ("Ver todos") e Enter abre a página de resultados com o termo preenchido', async ({ page }) => {
    const campo = await abrir(page);
    await campo.fill(TERMO);
    const opcoes = page.getByRole('option');
    await expect(opcoes.last()).toContainText('Ver todos os resultados');
    await campo.press('ArrowUp');
    await expect(opcoes.last()).toHaveAttribute('aria-selected', 'true');
    await campo.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/busca\\?q=${TERMO}$`));
    await expect(page.getByRole('searchbox', { name: 'Buscar no portal' })).toHaveValue(TERMO);
  });

  test('Enter sem opção ativa leva a /busca?q=<termo> (aparado, acento e espaço codificados) com o campo da página preenchido', async ({ page }) => {
    const campo = await abrir(page);
    await campo.fill('  fidelização programa ');
    await campo.press('Enter');
    await expect(page).toHaveURL(/\/busca\?q=fideliza(ç|%C3%A7)(ã|%C3%A3)o%20programa$/);
    await expect(page.getByRole('searchbox', { name: 'Buscar no portal' })).toHaveValue('fidelização programa');
  });

  test('na página de resultados, a lupa abre o campo já com o termo da busca atual', async ({ page }) => {
    const campo = await abrir(page, `/busca?q=${TERMO}`);
    await expect(campo).toHaveValue(TERMO);
  });
});

test.describe('página de busca', () => {
  test('sem termo o campo da página já vem com foco; com termo não rouba o foco', async ({ page }) => {
    await page.goto('/busca');
    await expect(page.getByRole('searchbox', { name: 'Buscar no portal' })).toBeFocused();
    await page.goto(`/busca?q=${TERMO}`);
    await expect(page.getByRole('searchbox', { name: 'Buscar no portal' })).not.toBeFocused();
  });
});

test.describe('busca do cabeçalho: sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('a lupa é um link para a página de busca, que já vem com o campo em foco e tem o formulário GET de resultados', async ({ page }) => {
    await page.goto('/');
    const lupa = page.getByRole('link', { name: 'Abrir busca' });
    await expect(lupa).toHaveAttribute('href', '/busca');
    await lupa.click();
    await expect(page).toHaveURL(/\/busca$/);
    // /busca sem loading.tsx: o conteúdo vem no HTML inicial (com loading.tsx o Next o entrega num bloco oculto que só o script revela).
    await expect(page.getByTestId('portal-loading')).toHaveCount(0);
    const campo = page.getByRole('searchbox', { name: 'Buscar no portal' });
    // O HTML traz `autofocus` (o navegador foca o campo ao carregar). O Chromium headless do Playwright não aplica autofocus com JavaScript desligado
    // (nem numa página estática mínima), então aqui se prova o atributo no HTML e, no teste com JavaScript abaixo, o foco real.
    await expect(campo).toHaveJSProperty('autofocus', true);
    await campo.fill(TERMO);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(page).toHaveURL(new RegExp(`/busca\\?q=${TERMO}$`));
    await expect(page.getByTestId('result-count').or(page.getByText(/Nenhum resultado para/))).toBeVisible();
  });
});

test.describe('busca do cabeçalho: celular e desktop', () => {
  for (const largura of [390, 320]) {
    test(`a ${largura} px o campo cobre a barra do cabeçalho, sem estourar a página, com alvos de 44 px e a lista cabendo na tela`, async ({ page }) => {
      await page.setViewportSize({ width: largura, height: 800 });
      const campo = await abrir(page);
      await campo.fill(TERMO);
      await expect(page.getByRole('option').last()).toBeVisible();
      const m = await page.evaluate(() => {
        const r = (s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) }; };
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, campo: r('.ln-hsearch__field'), painel: r('.ln-hsearch__panel'), barra: r('.ln-header__bar') };
      });
      expect(m.sw, `scrollWidth ${m.sw} > ${m.cw}`).toBeLessThanOrEqual(m.cw);
      expect(m.campo.w, 'o campo cobre a largura da barra').toBeGreaterThanOrEqual(m.barra.w - 1);
      expect(m.painel.w, 'a lista tem a largura da tela').toBeGreaterThanOrEqual(largura - 1);
      const fonte = await campo.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
      expect(fonte, 'campo com 16 px (iOS não dá zoom)').toBeGreaterThanOrEqual(16);
      await expect(page.getByRole('button', { name: 'Cancelar' })).toBeVisible();
      for (const alvo of [campo, page.getByRole('button', { name: 'Limpar busca' }), page.getByRole('button', { name: 'Cancelar' }), page.getByRole('option').first()]) {
        expect((await alvo.boundingBox())!.height, 'alvo de toque').toBeGreaterThanOrEqual(43.5);
      }
    });
  }

  test('abaixo de 1024 px o resto da barra e a página ficam inertes enquanto o campo está aberto; Cancelar fecha e devolve o foco', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    const campo = await abrir(page);
    for (const alvo of ['.ln-header__brand', '.ln-header__toggle', 'main#conteudo', 'footer']) {
      expect(await page.locator(alvo).first().evaluate((e) => (e as HTMLElement & { inert: boolean }).inert), `${alvo} inerte`).toBe(true);
    }
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(campo).toBeHidden();
    await expect(page.getByRole('button', { name: 'Abrir busca' })).toBeFocused();
    expect(await page.locator('main#conteudo').evaluate((e) => (e as HTMLElement & { inert: boolean }).inert)).toBe(false);
  });

  test('no desktop o campo expande à esquerda da lupa: logo e Anuncie não se movem, o menu fica oculto e não há "Cancelar"', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'largura de desktop');
    for (const largura of [1280, 1440]) {
      await page.setViewportSize({ width: largura, height: 800 });
      await page.goto('/');
      await aguardarHidratacao(page);
      const marcas = () => page.evaluate(() => {
        const x = (s: string) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().x) : -1; };
        return { barra: Math.round(document.querySelector('.ln-header__bar')!.getBoundingClientRect().height), logo: x('.ln-header__brand'), anuncie: x('.ln-header__cta'), menu: x('.ln-header__main') };
      });
      const antes = await marcas();
      await page.getByRole('button', { name: 'Abrir busca' }).click();
      await expect(page.getByRole('combobox', { name: 'Buscar matérias' })).toBeVisible();
      expect(await marcas(), `${largura}px: nada se move`).toEqual(antes);
      await expect(page.locator('.ln-header__main')).toHaveCSS('visibility', 'hidden');
      await expect(page.getByRole('button', { name: 'Cancelar' })).toBeHidden();
      const w = (await page.locator('.ln-hsearch__field').boundingBox())!.width;
      expect(w, `largura do campo a ${largura}px`).toBeGreaterThanOrEqual(359);
      expect(w).toBeLessThanOrEqual(561);
      await page.keyboard.press('Escape');
      await expect(page.locator('.ln-header__main')).toHaveCSS('visibility', 'visible');
    }
  });

  test('prefers-reduced-motion: reduce: o campo aparece sem animação', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await abrir(page);
    await expect(page.locator('.ln-hsearch__field')).toHaveCSS('animation-name', 'none');
  });
});

test.describe('busca do cabeçalho: rota /busca/sugestoes', () => {
  test('q com 1 e com 81 caracteres = 400 q_invalido em no-store; sem q também', async ({ request }, info) => {
    test.skip(info.project.name !== 'desktop', 'chamada direta: um projeto basta');
    for (const q of ['a', 'a'.repeat(81), '', '   ']) {
      const r = await request.get(`/busca/sugestoes?q=${encodeURIComponent(q)}`);
      expect(r.status(), `q de ${q.length} caracteres`).toBe(400);
      expect((await r.json()).erro).toBe('q_invalido');
      expect(r.headers()['cache-control']).toBe('no-store');
    }
    expect((await request.get(`/busca/sugestoes?q=${'a'.repeat(80)}`)).status()).toBe(200); // 80 é o limite aceito
  });

  test('resposta boa: no máximo 5 itens, só matérias (slug, título, editoria, data), 60 s de cache público e fora dos buscadores', async ({ request }, info) => {
    test.skip(info.project.name !== 'desktop', 'chamada direta: um projeto basta');
    const r = await request.get(`/busca/sugestoes?q=${TERMO}`);
    expect(r.status()).toBe(200);
    expect(r.headers()['cache-control']).toBe('public, s-maxage=60, stale-while-revalidate=30');
    expect(r.headers()['x-robots-tag']).toMatch(/noindex/); // fora de produção o Next soma "nofollow"
    const j = await r.json();
    expect(j.estado).toBe('ok');
    expect(j.itens.length).toBeLessThanOrEqual(5);
    if (!TEM_DADOS) expect(j.itens).toEqual([]);
    for (const i of j.itens) expect(Object.keys(i).sort()).toEqual(['editoria', 'publicadoEm', 'slug', 'titulo']);
    expect(Object.keys(j).sort()).toEqual(['estado', 'itens', 'q', 'total']);
  });

  test('fonte fora do ar = estado "indisponivel" em no-store (nunca "nada encontrado")', async ({ request }, info) => {
    test.skip(info.project.name !== 'desktop' || mode !== 'api', 'o gatilho q=falha é do servidor MOCK do modo api');
    const r = await request.get('/busca/sugestoes?q=falha');
    expect(r.status()).toBe(200);
    expect((await r.json()).estado).toBe('indisponivel');
    expect(r.headers()['cache-control']).toBe('no-store');
  });
});

test.describe('busca do cabeçalho: acessibilidade', () => {
  for (const [nome, termo, estado] of [
    ['resultados', TERMO, 'busca-sugestoes'],
    ['nada encontrado', 'zzzxqyw', 'busca-vazio'],
  ] as const) {
    test(`axe sem violações com o campo aberto (${nome})`, async ({ page }) => {
      test.skip(nome === 'resultados' && !TEM_DADOS, 'precisa de matérias (mock ou api)');
      test.slow();
      const campo = await abrir(page);
      await campo.fill(termo);
      await expect(page.getByTestId(estado)).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const resumo = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
      expect(resumo, resumo.join('\n')).toEqual([]);
    });
  }

  test('axe sem violações no estado de erro', async ({ page }) => {
    test.slow();
    await page.route('**/busca/sugestoes**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    const campo = await abrir(page);
    await campo.fill(TERMO);
    await expect(page.getByTestId('busca-erro')).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const resumo = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
    expect(resumo, resumo.join('\n')).toEqual([]);
  });
});
