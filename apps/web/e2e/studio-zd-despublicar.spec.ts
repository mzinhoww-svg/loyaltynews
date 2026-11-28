import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { api, definirFlag, entrar, enviar, semearFabrica } from './helpers';

// Despublicar pela tela e o ID da evidência à vista, sobre as rotas reais (banco de e2e). O spec cria a própria matéria e a publica
// pela rota oficial. O nome o põe no fim da fila: ele deixa uma matéria despublicada no banco compartilhado.
// A conferência da página do portal só vale com PORTAL_SOURCE=api no servidor (o portal lendo as rotas públicas dele mesmo).
const PORTAL = process.env.PORTAL_SOURCE === 'api';
const TITULO = 'Matéria que sai do ar no teste';
const NOTA = 'Pedido da redação: informação incorreta';

let materia = { id: '', slug: '', evidencia: '', fonte: '' };

async function axe(page: Page, onde: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const graves = r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(graves, `${onde}\n${graves.join('\n')}`).toEqual([]);
}
const ok = async (context: BrowserContext, method: 'POST' | 'PATCH', path: string, body: unknown) => {
  const r = await api(context, method, path, body);
  expect(r.status, `${method} ${path}: ${JSON.stringify(r.body)}`).toBeLessThan(300);
  return r.body as { data?: Record<string, unknown> } & Record<string, unknown>;
};
const estado = async (context: BrowserContext) => ((await api(context, 'GET', `/api/materias/${materia.id}`)).body as { data: { status: string; transicoes: { para: string; nota: string | null }[] } }).data;
const publica = async (context: BrowserContext) => (await context.request.get(`/api/publico/materias/${materia.slug}`)).status();
const painel = (page: Page) => page.locator('#confirmar-despublicacao');
const abrir = (page: Page) => page.getByRole('link', { name: 'Despublicar matéria' });
const confirmar = (page: Page) => page.getByRole('button', { name: 'Confirmar despublicação' });
const erro = (page: Page) => page.locator('main .st-alert.err[data-flash="erro"]');

test.describe('CMS: despublicar e ID da evidência', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    await definirFlag(context, 'publicacaoPortal', true);
    const marca = Date.now().toString(36);
    await entrar(context, 'desp-autor', 'editor');
    const fonte = `fonte-despublicar-${marca}`;
    await ok(context, 'POST', '/api/fontes', { id: fonte, nome: 'Fonte da despublicação', url: `https://exemplo.com.br/${marca}`, tipo: 'comunicado', editorias: ['pontos'], termosRevisados: true });
    await ok(context, 'PATCH', `/api/fontes/${fonte}`, { ativo: true });
    const ev = await ok(context, 'POST', `/api/fontes/${fonte}/evidencias`, { url: `https://exemplo.com.br/${marca}/nota`, capturadoEm: new Date().toISOString(), sha256: 'b'.repeat(64) });
    const evidencia = (ev.data as { id: string }).id;
    const slug = `materia-que-sai-do-ar-${marca}`;
    const m = (await ok(context, 'POST', '/api/materias', { slug, titulo: TITULO, editoria: 'pontos', resumo: 'Resumo curto da matéria de teste.', corpo: 'Texto completo da matéria de teste.', evidenceIds: [evidencia] })).data as { id: string; versao: number };
    await ok(context, 'POST', `/api/materias/${m.id}/transicao`, { para: 'em_checagem' });
    await entrar(context, 'desp-revisor', 'revisor');
    const checagens = ['fatos', 'direitos', 'originalidade', 'editor', 'classe_de_dado'].map((tipo) => ({ tipo, resultado: 'aprovado', ...(tipo === 'fatos' ? { autorModelo: 'openai' } : {}) }));
    const recibo = (await ok(context, 'POST', `/api/materias/${m.id}/recibos`, { versao: m.versao, checagens })).data as { id: string };
    await ok(context, 'POST', `/api/materias/${m.id}/transicao`, { para: 'aprovado' });
    await entrar(context, 'desp-chefe', 'editor_chefe');
    await ok(context, 'POST', `/api/studio/editorial/articles/${m.id}/publication`, { receiptId: recibo.id, url: `https://portal.example.test/noticia/${slug}` });
    materia = { id: m.id, slug, evidencia, fonte };
    await context.close();
  });
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    await definirFlag(context, 'publicacaoPortal', false);
    await context.close();
  });

  for (const [largura, altura] of [[1280, 800], [390, 844]] as const) {
    test(`o ID da evidência aparece no Banco de fontes e no CMS a ${largura} px; axe`, async ({ page, context }) => {
      await page.setViewportSize({ width: largura, height: altura });
      await entrar(context, 'desp-chefe', 'editor_chefe');
      for (const [onde, url] of [
        ['fonte', `/studio/fontes/${materia.fonte}`],
        ['matéria', `/studio/cms/${materia.id}`],
        ['nova matéria', '/studio/cms/nova'],
      ] as const) {
        await page.goto(url);
        const id = page.locator(`[data-id-evidencia="${materia.evidencia}"]`).first();
        await expect(id, onde).toBeVisible();
        await expect(id).toHaveText(materia.evidencia);
        await axe(page, `${onde} ${largura}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${onde} ${largura}: rolagem da página`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('o ID aparece na checagem da Fábrica e no caso de correção, junto do campo que o pede', async ({ page, context }) => {
    await entrar(context, 'desp-chefe', 'editor_chefe');
    const fabrica = await semearFabrica(context);
    await page.goto(`/studio/cms/checagem/${fabrica}`);
    await expect(page.locator('[data-id-evidencia="ev-fabrica-1"]')).toHaveText('ev-fabrica-1');
    const caso = await ok(context, 'POST', '/api/studio/editorial/corrections', { articleId: materia.id, kind: 'erratum', contested: 'Trecho contestado no teste.', requester: { name: 'Redação', channel: 'internal' } });
    const casoId = ((caso.data ?? caso) as { id: string }).id;
    await ok(context, 'POST', `/api/studio/editorial/corrections/${casoId}/preserve-evidence`, { url: `https://portal.example.test/noticia/${materia.slug}`, body: 'Texto da página preservado.' });
    await page.goto(`/studio/cms/correcoes/${casoId}`);
    const lista = page.getByRole('list', { name: 'Evidências desta matéria' });
    await expect(lista.locator(`[data-id-evidencia="${materia.evidencia}"]`)).toHaveText(materia.evidencia);
    await axe(page, 'caso de correção');
  });

  test('quem não tem permissão não despublica: sem botão, sem formulário e a API recusa', async ({ page, context }) => {
    for (const papel of ['editor', 'revisor', 'leitor']) {
      await entrar(context, `desp-${papel}`, papel);
      await page.goto(`/studio/cms/${materia.id}?despublicar=1`);
      await expect(page.locator('[data-despublicar="sem-permissao"]'), papel).toBeVisible();
      await expect(abrir(page)).toHaveCount(0);
      await expect(confirmar(page)).toHaveCount(0);
      expect((await api(context, 'POST', `/api/materias/${materia.id}/transicao`, { para: 'despublicado', nota: NOTA })).status, papel).toBe(403);
    }
    // confirmação aberta pelo editor-chefe e enviada com a sessão já de um editor: a ação recusa
    await entrar(context, 'desp-chefe', 'editor_chefe');
    await page.goto(`/studio/cms/${materia.id}?despublicar=1`);
    await page.getByLabel('Nota da despublicação').fill(NOTA);
    await entrar(context, 'desp-editor', 'editor');
    await confirmar(page).click();
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    await entrar(context, 'desp-chefe', 'editor_chefe');
    expect((await estado(context)).status).toBe('publicado');
    expect(await publica(context)).toBe(200);
  });

  test('sem nota é recusada com o foco no erro; Cancelar não envia', async ({ page, context }) => {
    await entrar(context, 'desp-chefe', 'editor_chefe');
    await page.goto(`/studio/cms/${materia.id}`);
    await expect(painel(page)).toHaveCount(0);
    await abrir(page).click();
    await expect(painel(page)).toBeFocused();
    await expect(painel(page)).toContainText('sai do portal e das listagens públicas');
    await axe(page, 'confirmação');
    for (const nota of ['', 'ok']) {
      await page.getByLabel('Nota da despublicação').fill(nota);
      await enviar(page, confirmar(page));
      await expect(erro(page)).toContainText('Informe a nota da despublicação');
      await expect(erro(page), `nota "${nota}": foco no erro`).toBeFocused();
      await page.waitForTimeout(400);
      await expect(erro(page)).toBeFocused();
      await page.getByLabel('Nota da despublicação').focus();
    }
    await axe(page, 'nota recusada');
    const envios: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') envios.push(r.url());
    });
    await page.getByLabel('Nota da despublicação').fill(NOTA);
    await painel(page).getByRole('link', { name: 'Cancelar' }).click();
    await expect(painel(page)).toHaveCount(0);
    expect(envios).toEqual([]);
    expect((await estado(context)).status).toBe('publicado');
    expect(await publica(context)).toBe(200);
  });

  test('o editor-chefe confirma com nota: a página pública some e o histórico guarda a nota', async ({ page, context }) => {
    await entrar(context, 'desp-chefe', 'editor_chefe');
    expect(await publica(context)).toBe(200);
    if (PORTAL) {
      const antes = await page.goto(`/noticia/${materia.slug}`);
      expect(antes!.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: TITULO })).toBeVisible();
    }
    await page.goto(`/studio/cms/${materia.id}`);
    await abrir(page).click();
    await page.getByLabel('Nota da despublicação').fill(NOTA);
    expect(page.url()).not.toContain('Pedido');
    await enviar(page, confirmar(page));
    await expect(page.locator('main .st-alert.ok')).toContainText('Matéria despublicada.');
    expect(page.url()).not.toContain('Pedido');
    await expect(page.locator('.ln-pill', { hasText: 'Despublicado' }).first()).toBeVisible();
    await expect(page.locator('aside')).toContainText(NOTA);
    await expect(abrir(page)).toHaveCount(0);
    await expect(confirmar(page)).toHaveCount(0);
    await axe(page, 'despublicada');
    const depois = await estado(context);
    expect(depois.status).toBe('despublicado');
    expect(depois.transicoes.filter((t) => t.para === 'despublicado')).toEqual([expect.objectContaining({ nota: NOTA })]);
    expect(await publica(context)).toBe(404);
    const lista = (await (await context.request.get('/api/publico/materias?limit=100')).json()) as { data: { slug: string }[] };
    expect(lista.data.map((x) => x.slug)).not.toContain(materia.slug);
    if (PORTAL) {
      const pagina = await page.goto(`/noticia/${materia.slug}`);
      expect(pagina!.status()).toBe(404);
      await expect(page.getByText(TITULO)).toHaveCount(0);
    }
  });
});
