import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * O portal contra o CONJUNTO REAL da seed v3 (29 organizações, 28 vínculos declarados), servido pelo fake-api em
 * FAKE_API_INTEL=seed. Fecha a lacuna que o QA 8 registrou: até aqui o modo api só tinha visto o MOCK de 5 empresas.
 *
 * A cadeia conferida é seed → resposta HTTP → página: a primeira bateria compara o HTTP com o arquivo da seed (pega erro
 * na fixture); a segunda confere o que a tela mostra com o que o HTTP devolveu (pega erro de contrato/render/paginação).
 * Nenhum dado é inventado: nome, vínculo, fonte e data de coleta vêm da seed e do relatório de verificação.
 */
const mode = process.env.PORTAL_MODE ?? 'empty';
const intel = process.env.PORTAL_API_INTEL ?? '';
const BASE = Number(process.env.PORTAL_PORT_BASE) || 0;
// O fake-api sobe na porta base+4 (e2e/portal.config.ts); o `request` do Playwright fala com ele, não com o portal.
const API = `http://127.0.0.1:${BASE ? BASE + 4 : 3104}`;
const ROTA = '/api/publico/intelligence';
const PAGINA = 24;

type Seed = {
  organizations: { key: string; legalName: string; kind: string; sourceId: string; quote: string }[];
  relations: { from: string; to: string; type: string; sourceId: string; quote: string }[];
  sources: { id: string; name: string; url: string }[];
};
type Verificacao = { sources: { id: string; fetched_at?: string; status?: string }[] };
type ListaItem = { id: string; nome: string; nomeLegal: string; tipo: string; relacoes: number; validadoEm: string };
type Fonte = { nome: string; url: string; coletadoEm: string };
type Relacao = { id: string; tipo: string; sentido: 'origem' | 'destino'; empresa: { id: string; nome: string; tipo: string }; vigenteDesde: string; validadoEm: string; fonte: Fonte };
type Detalhe = { id: string; nome: string; nomeLegal: string; tipo: string; fonte: Fonte; relacoes: Relacao[]; pessoas: { disponivel: boolean; itens: unknown[] } };
type Envelope = { data: ListaItem[]; total: number; tipos: { tipo: string; total: number }[] };

const json = <T,>(caminho: string) => JSON.parse(readFileSync(new URL(caminho, import.meta.url), 'utf8')) as T;
const SEED = json<Seed>('../../../../packages/intelligence/data/seed.public.v3.json');
const VER = json<Verificacao>('../../../../packages/intelligence/data/seed.public.v3.verification.json');
const coletaDe = (id: string) => VER.sources.find((s) => s.id === id)?.fetched_at ?? '';
const pagina = async (request: import('@playwright/test').APIRequestContext, qs: string) => {
  const res = await request.get(`${API}${ROTA}/empresas?${qs}`);
  expect(res.status(), qs).toBe(200);
  return (await res.json()) as Envelope;
};

test.describe('seed v3 real: a resposta HTTP é a seed, sem truncar', () => {
  test.skip(mode !== 'api' || intel !== 'seed', 'roda com PORTAL_MODE=api PORTAL_API_INTEL=seed');

  test('lista devolve as 29 organizações da seed, com a contagem de vínculos certa', async ({ request }) => {
    const corpo = await pagina(request, 'limit=100');
    expect(corpo.total).toBe(SEED.organizations.length);
    expect(corpo.data).toHaveLength(SEED.organizations.length);
    // Nome publicado = razão social da seed; nenhum nome inventado e nenhum cortado.
    const naSeed = new Set(SEED.organizations.map((o) => o.legalName));
    expect(corpo.data.map((o) => o.nome).sort()).toEqual([...naSeed].sort());
    // Cada vínculo aparece nos DOIS lados (origem e destino): soma das contagens = 2 × 28.
    expect(corpo.data.reduce((n, o) => n + o.relacoes, 0)).toBe(SEED.relations.length * 2);
    // Os chips somam o total, sem perder tipo.
    expect(corpo.tipos.reduce((n, t) => n + t.total, 0)).toBe(SEED.organizations.length);
    // Data de coleta da lista = fetched_at da fonte da organização no relatório de verificação.
    for (const o of corpo.data) {
      const org = SEED.organizations.find((x) => x.legalName === o.nome)!;
      expect(o.validadoEm, o.nome).toBe(coletaDe(org.sourceId));
    }
  });

  test('paginação não perde ninguém: as duas páginas somam as 29, sem repetir', async ({ request }) => {
    const p1 = await pagina(request, `limit=${PAGINA}&offset=0`);
    const p2 = await pagina(request, `limit=${PAGINA}&offset=${PAGINA}`);
    expect(p1.data).toHaveLength(PAGINA);
    expect(p2.data).toHaveLength(SEED.organizations.length - PAGINA);
    expect(p1.total).toBe(29);
    expect(p2.total).toBe(29);
    const ids = [...p1.data, ...p2.data].map((o) => o.id);
    expect(new Set(ids).size).toBe(29);
    // `tipos` é do universo, não da página: os chips não podem encolher na página 2.
    expect(p2.tipos).toEqual(p1.tipos);
  });

  test('detalhe devolve os vínculos reais com fonte https e a citação NUNCA sai no contrato', async ({ request }) => {
    const lista = await pagina(request, 'limit=100');
    const alvo = [...lista.data].sort((a, b) => b.relacoes - a.relacoes)[0]!;
    const res = await request.get(`${API}${ROTA}/empresas/${alvo.id}`);
    expect(res.status()).toBe(200);
    const { data } = (await res.json()) as { data: Detalhe };
    const orgSeed = SEED.organizations.find((o) => o.legalName === data.nome)!;
    const relSeed = SEED.relations.filter((r) => r.from === orgSeed.key || r.to === orgSeed.key);
    expect(data.relacoes).toHaveLength(relSeed.length);
    expect(data.fonte.coletadoEm).toBe(coletaDe(orgSeed.sourceId));
    const urlsDaSeed = new Set(SEED.sources.map((s) => s.url));
    for (const r of data.relacoes) {
      expect(r.fonte.url, `${r.id}`).toMatch(/^https:\/\//);
      expect(urlsDaSeed.has(r.fonte.url), `${r.fonte.url} não é fonte da seed`).toBe(true);
      expect(r.validadoEm, `${r.id}: validação = data da evidência (seed-load.ts)`).toBe(r.fonte.coletadoEm);
    }
    // Trecho literal de página não é campo do contrato público.
    const bruto = JSON.stringify(data);
    expect(bruto).not.toContain('quote');
    expect(bruto).not.toContain(orgSeed.quote.slice(0, 40));
  });
});

test.describe('seed v3 real: o que a página mostra', () => {
  test.skip(mode !== 'api' || intel !== 'seed', 'roda com PORTAL_MODE=api PORTAL_API_INTEL=seed');

  test('diretório: 24 na primeira página, total 29 e faixa honesta; a segunda fecha as 29', async ({ page, request }) => {
    await page.goto('/intelligence/empresas');
    await expect(page.getByTestId('directory-count')).toHaveText(/^29 organizações$/);
    await expect(page.getByTestId('company-card-link')).toHaveCount(PAGINA);
    await expect(page.getByTestId('directory-range')).toHaveText(/Mostrando 1.24 de 29/);
    await expect(page.getByTestId('directory-page')).toHaveText('Página 1 de 2');
    const primeiraPagina = await page.getByTestId('company-card-link').allInnerTexts();

    await page.getByRole('link', { name: /Próxima página/ }).click();
    await page.waitForURL(/pagina=2/);
    await expect(page.getByTestId('company-card-link')).toHaveCount(29 - PAGINA);
    await expect(page.getByTestId('directory-range')).toHaveText(/Mostrando 25.29 de 29/);
    await expect(page.getByTestId('directory-page')).toHaveText('Página 2 de 2');
    // Chips com a contagem do universo, não da página.
    const corpo = await pagina(request, 'limit=100');
    await expect(page.getByRole('link', { name: `Todos (${corpo.total})` })).toBeVisible();

    // A união das duas páginas é exatamente a seed: nada truncado, nada duplicado.
    const segundaPagina = await page.getByTestId('company-card-link').allInnerTexts();
    const naSeed = SEED.organizations.map((o) => o.legalName);
    expect([...primeiraPagina, ...segundaPagina].sort()).toEqual([...naSeed].sort());
  });

  test('filtro por tipo usa a contagem real e cabe numa página', async ({ page, request }) => {
    const corpo = await pagina(request, 'limit=100');
    const rotulo: Record<string, string> = { company: 'Empresa', program: 'Programa de fidelidade', association: 'Associação', other: 'Outros (tipo não declarado)' };
    await page.goto('/intelligence/empresas');
    for (const t of corpo.tipos) {
      await expect(page.getByRole('link', { name: `${rotulo[t.tipo]} (${t.total})` })).toBeVisible();
    }
    const maior = [...corpo.tipos].sort((a, b) => b.total - a.total)[0]!;
    await page.goto(`/intelligence/empresas?tipo=${maior.tipo}`);
    await expect(page.getByTestId('company-card-link')).toHaveCount(maior.total);
    await expect(page.getByTestId('directory-count')).toHaveText(new RegExp(`^${maior.total} (organização|organizações) · `));
    await expect(page.getByTestId('directory-pagination')).toHaveCount(0);
  });

  test('página fora do intervalo diz que a página não existe, sem fingir filtro vazio', async ({ page }) => {
    await page.goto('/intelligence/empresas?pagina=9');
    // EmptyState do portal é inline: o título é texto em negrito, não heading.
    await expect(page.getByText('Esta página não existe mais')).toBeVisible();
    await expect(page.getByText(/29 organizações publicadas em 2 páginas/)).toBeVisible();
    await expect(page.getByTestId('company-card-link')).toHaveCount(0);
    // Sem filtro, o total é o do diretório: nada de "com este filtro".
    await expect(page.getByText(/com este filtro/)).toHaveCount(0);
  });

  test('página fora do intervalo com filtro: o total é anunciado como o do filtro', async ({ page, request }) => {
    const total = (await pagina(request, 'tipo=company&limit=100')).total;
    await page.goto('/intelligence/empresas?tipo=company&pagina=9');
    await expect(page.getByText(new RegExp(`${total} (organização publicada|organizações publicadas) com este filtro em`))).toBeVisible();
  });

  // Parecer de empresas 26/11 (P3-2) e do Auditor (P3): alvos de borda e paginação com 44 px no celular E no tablet.
  test('alvos de toque do diretório >= 44px a 390 e 768; o desktop não muda', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop', 'as larguras são fixadas aqui');
    const alvos = [
      { rota: '/intelligence/empresas', nome: /Próxima página/ },
      { rota: '/intelligence/empresas?pagina=9', nome: 'Ir para a última página' },
      { rota: `/intelligence/empresas?q=zzz-sem-empresa`, nome: 'Ver todas as empresas' },
    ] as const;
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      for (const a of alvos) {
        await page.goto(a.rota);
        const caixa = (await page.getByRole('link', { name: a.nome }).boundingBox())!;
        expect(caixa.height, `${width}px ${a.rota}: altura`).toBeGreaterThanOrEqual(44);
        expect(caixa.width, `${width}px ${a.rota}: largura`).toBeGreaterThanOrEqual(44);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const a of alvos) {
      await page.goto(a.rota);
      expect(await page.getByRole('link', { name: a.nome }).evaluate((e) => getComputedStyle(e).minHeight), `desktop ${a.rota}`).not.toBe('44px');
    }
  });

  test('empresa com mais vínculos: tabela com todas as fontes reais e navegação para a relacionada', async ({ page, request }) => {
    const lista = await pagina(request, 'limit=100');
    const alvo = [...lista.data].sort((a, b) => b.relacoes - a.relacoes)[0]!;
    const { data } = (await (await request.get(`${API}${ROTA}/empresas/${alvo.id}`)).json()) as { data: Detalhe };

    const res = await page.goto(`/intelligence/empresas/${alvo.id}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(alvo.nome);
    const linhas = page.getByTestId('relations').locator('tbody tr');
    await expect(linhas).toHaveCount(data.relacoes.length);
    // Fonte de cada linha aponta para a URL real da seed (https) e mostra a data de coleta.
    for (const r of data.relacoes) {
      const linha = linhas.filter({ hasText: r.empresa.nome });
      await expect(linha.getByRole('link', { name: r.fonte.nome })).toHaveAttribute('href', r.fonte.url);
      await expect(linha.locator('time')).toHaveAttribute('datetime', r.fonte.coletadoEm);
    }
    // O trecho literal da fonte não pode aparecer na tela.
    const corpoTexto = await page.locator('body').innerText();
    const orgSeed = SEED.organizations.find((o) => o.legalName === data.nome)!;
    expect(corpoTexto).not.toContain(orgSeed.quote.slice(0, 40));

    // Navegação entre empresas relacionadas: o link leva ao perfil da outra e o título confirma.
    const primeira = data.relacoes[0]!;
    await page.getByRole('link', { name: primeira.empresa.nome, exact: true }).first().click();
    await page.waitForURL(`**/intelligence/empresas/${primeira.empresa.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(primeira.empresa.nome);
  });

  test('pessoas e Moves seguem vazios com o motivo real (a seed não tem nenhum dos dois)', async ({ page, request }) => {
    const lista = await pagina(request, 'limit=100');
    const { data } = (await (await request.get(`${API}${ROTA}/empresas/${lista.data[0]!.id}`)).json()) as { data: Detalhe };
    await page.goto(`/intelligence/empresas/${data.id}`);
    await expect(page.getByText('Nenhum cargo declarado com fonte oficial foi publicado para esta empresa')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Movimentações confirmadas' })).toHaveCount(0);
    await expect(page.getByText(/executivos verificados/)).toHaveCount(0);
  });

  test('id desconhecido no formato UUID dá 404, não "indisponível"', async ({ page }) => {
    const res = await page.goto('/intelligence/empresas/10000000-0000-4000-8000-0000000000ff');
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Página não encontrada')).toBeVisible();
  });

  test('axe com o conjunto real: 0 serious/critical no diretório (as duas páginas) e no perfil', async ({ page, request }) => {
    test.setTimeout(90_000);
    const lista = await pagina(request, 'limit=100');
    const alvo = [...lista.data].sort((a, b) => b.relacoes - a.relacoes)[0]!;
    for (const rota of ['/intelligence/empresas', '/intelligence/empresas?pagina=2', `/intelligence/empresas/${alvo.id}`]) {
      await page.goto(rota);
      // Espera o conteúdo real em vez de 'networkidle': com 24 cards o ocioso de rede é instável nesta máquina.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.locator('[data-testid="directory-count"], [data-testid="relations"]').first().waitFor();
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      console.log(`axe seed ${rota}: ${graves.length} serious/critical de ${r.violations.length} violação(ões)`);
      expect(graves.map((v) => `${v.id} (${v.nodes.length} nó(s))`), rota).toEqual([]);
    }
  });
});
