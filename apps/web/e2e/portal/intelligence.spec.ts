import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Entity Intelligence no portal: lista de empresas com filtro por tipo, página da empresa com vínculos e fonte de cada um,
 * navegação entre empresas relacionadas, estado vazio honesto (empty; pessoas e Moves) e axe nos três modos.
 *   empty → fonte vazia; mock → fixtures MOCK; api → e2e/fake-api.mjs no formato do contrato público.
 */
const mode = (process.env.PORTAL_MODE ?? 'empty') as 'empty' | 'mock' | 'api';
/** Modo do Intelligence no servidor MOCK (só api): '' = full | vazio | sem-flag. */
const intel = process.env.PORTAL_API_INTEL ?? '';
// Com o e2e contra o build de produção (next start, sem compilação sob demanda) o padrão de 5 s basta.
const NAV_MS = 5_000;

async function axe(page: Page) {
  // 'load', não 'networkidle': no build de produção o Next faz prefetch dos links visíveis e páginas com muitos links (perfil com um
  // pedido por cargo) não ficam 500 ms sem rede; o axe só precisa do documento carregado e do título.
  await page.waitForLoadState('load');
  // Na navegação por clique o Next atualiza o <title> logo depois do conteúdo: espera o título antes de auditar.
  await expect.poll(() => page.title()).not.toBe('');
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const summary = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(summary, summary.join('\n')).toEqual([]);
}

test.describe('empty', () => {
  test.skip(mode !== 'empty', 'somente no modo empty');

  test('diretório, pessoas e Moves vazios e honestos; perfil inexistente é 404', async ({ page }) => {
    await page.goto('/intelligence/empresas');
    await expect(page.getByText('Em breve: primeiros perfis verificados')).toBeVisible();
    await expect(page.getByTestId('company-list')).toHaveCount(0);
    await axe(page);
    await page.goto('/intelligence/empresas?tipo=company');
    await expect(page.getByText('Nenhuma empresa com esse filtro')).toBeVisible();
    const r = await page.goto('/intelligence/empresas/00000000-0000-4000-8000-00000000000a');
    expect(r?.status()).toBe(404);
    await page.goto('/moves');
    // Estado vazio honesto: sem Moves publicados não se promete disponibilidade nem "em breve" (P3 do QA 6, 25/11).
    await expect(page.getByText('Ainda não há Moves publicados')).toBeVisible();
    await expect(page.getByTestId('moves-empty-honest')).toBeVisible();
    await expect(page.getByText(/em breve: primeiras movimentações/i)).toHaveCount(0);
  });
});

test.describe('mock', () => {
  test.skip(mode !== 'mock', 'somente no modo mock');

  test('lista MOCK rotulada, perfil com vínculos e navegação de ida e volta', async ({ page }) => {
    await page.goto('/intelligence/empresas');
    const list = page.getByTestId('company-list');
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(list).toContainText('MOCK');
    await axe(page);
    await page.getByRole('link', { name: 'Programa', exact: false }).filter({ hasText: 'Programa de Teste' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Programa de Teste (MOCK)', { timeout: NAV_MS });
    await expect(page.getByTestId('relations')).toContainText('Controlada por');
    await axe(page);
    await page.getByTestId('relations').getByRole('link', { name: 'Empresa de Teste (MOCK)' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Empresa de Teste (MOCK)', { timeout: NAV_MS });
    await expect(page.getByTestId('relations').locator('tbody tr')).toHaveCount(2);
  });
});

test.describe('api', () => {
  test.skip(mode !== 'api' || intel !== '', 'somente no modo api com Intelligence completo');

  test('lista com filtro por tipo e contagens', async ({ page }) => {
    await page.goto('/intelligence/empresas');
    await expect(page.getByTestId('company-list').getByRole('listitem')).toHaveCount(5);
    const chips = page.getByRole('list', { name: 'Filtrar por tipo' });
    await expect(chips.getByRole('link', { name: 'Todos (5)' })).toHaveAttribute('aria-current', 'true');
    await chips.getByRole('link', { name: 'Empresa (2)' }).click();
    await expect(page).toHaveURL(/tipo=company/, { timeout: NAV_MS });
    await expect(page.getByTestId('company-list').getByRole('listitem')).toHaveCount(2);
    await expect(page.getByTestId('directory-count')).toContainText('2 organizações · Empresa');
    await expect(chips.getByRole('link', { name: 'Empresa (2)' })).toHaveAttribute('aria-current', 'true');
    await axe(page);
    // Tipo inválido na URL é ignorado (mostra todos), nunca erro.
    await page.goto('/intelligence/empresas?tipo=%3Cscript%3E');
    await expect(page.getByTestId('company-list').getByRole('listitem')).toHaveCount(5);
  });

  test('perfil: vínculos com fonte, link e data; sem trecho literal; navegação entre relacionadas', async ({ page }) => {
    await page.goto('/intelligence/empresas');
    await page.getByRole('link', { name: '[MOCK API] Programa Alfa' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK API] Programa Alfa', { timeout: NAV_MS });
    const rel = page.getByTestId('relations');
    await expect(rel.locator('tbody tr')).toHaveCount(3);
    await expect(rel).toContainText('Parceria declarada com');
    await expect(rel).not.toContainText('Parceria anunciada');
    await expect(rel).toContainText('Vínculo declarado com');
    const src = rel.getByRole('link', { name: /Fonte de teste/ }).first();
    await expect(src).toHaveAttribute('href', /^https:\/\/fonte-.*\.invalid\//);
    await expect(src).toHaveAttribute('rel', /noopener/);
    await expect(rel.locator('time').first()).toHaveAttribute('datetime', '2026-11-23T00:00:00.000Z');
    await expect(page.locator('main')).not.toContainText('TRECHO LITERAL');
    // Programa Alfa tem uma pessoa com cargo vigente no MOCK: a seção mostra a tabela, não o "em breve".
    await expect(page.getByTestId('company-people')).toContainText('[MOCK API] Ana Teste');
    await axe(page);

    await rel.getByRole('link', { name: '[MOCK API] Clube Delta' }).click();
    // Espera determinística da navegação (URL e título do destino) antes de checar o conteúdo.
    await expect(page).toHaveURL(/\/intelligence\/empresas\/10000000-0000-4000-8000-000000000004$/, { timeout: NAV_MS });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK API] Clube Delta', { timeout: NAV_MS });
    await expect(page.getByText('Em breve: executivos verificados')).toBeVisible();
    await expect(page.getByTestId('company-meta')).toContainText('Tipo não declarado na fonte');
    await page.getByTestId('relations').getByRole('link', { name: '[MOCK API] Associação Gama' }).click();
    // M-02 (revisão 25/11): os 2 vínculos da Gama têm o mesmo rótulo → sem coluna "Vínculo" repetida; o rótulo vai uma vez na legenda.
    await expect(page.locator('#legenda-relations')).toContainText('Vínculo declarado com', { timeout: NAV_MS });
    await expect(page.getByTestId('relations').locator('th', { hasText: 'Vínculo' })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK API] Associação Gama', { timeout: NAV_MS });
    await expect(page.getByTestId('relations').locator('tbody tr')).toHaveCount(2);
  });

  test('perfil inexistente ou id fora do formato: 404', async ({ page }) => {
    expect((await page.goto('/intelligence/empresas/10000000-0000-4000-8000-000000000999'))?.status()).toBe(404);
    expect((await page.goto('/intelligence/empresas/nao-e-uuid'))?.status()).toBe(404);
  });

  test('hub conta empresas, pessoas e Moves confirmados válidos', async ({ page }) => {
    await page.goto('/intelligence');
    await expect(page.getByTestId('count-empresas')).toHaveText('5 cadastrado(s) e verificado(s)');
    await expect(page.getByTestId('count-pessoas')).toHaveText('2 cadastrado(s) e verificado(s)');
    // 2 Moves na resposta, 1 sem a leitura "antes" (viola o modelo): só 1 é publicado.
    await expect(page.getByTestId('count-moves')).toHaveText('1 cadastrado(s) e verificado(s)');
  });

  test('Moves: só o válido, com antes e depois e a fonte de cada lado; sem trecho literal; detalhe e 404', async ({ page }) => {
    await page.goto('/moves');
    const cards = page.getByTestId('move-card');
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('Mudança de empresa');
    await expect(cards).toContainText('data efetiva não declarada pela fonte');
    const before = cards.getByTestId('move-before');
    const after = cards.getByTestId('move-after');
    await expect(before).toContainText('Diretora Comercial (MOCK)');
    await expect(before).toContainText('[MOCK API] Banco Beta');
    await expect(after).toContainText('CEO (MOCK)');
    await expect(after).toContainText('[MOCK API] Programa Alfa');
    await expect(before.getByRole('link', { name: /Fonte de teste/ })).toHaveAttribute('href', /\.invalid\//);
    await expect(after.getByRole('link', { name: /Fonte de teste/ })).toHaveAttribute('href', /\.invalid\//);
    await expect(page.locator('main')).not.toContainText('TRECHO LITERAL');
    await expect(page.locator('main')).not.toContainText('Bia Teste');
    await axe(page);
    await cards.getByRole('link', { name: '[MOCK API] Ana Teste' }).click();
    await expect(page).toHaveURL(/\/moves\/10000000-0000-4000-8000-000000000401$/, { timeout: NAV_MS });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mudança de empresa: [MOCK API] Ana Teste', { timeout: NAV_MS });
    // DP-38: o Move tem o próprio pedido; a URL /moves/<id> é a que o Backend 2 usa como alvo.
    await expect(page.getByTestId('move-correction')).toHaveAttribute('href', '/correcoes?alvo=%2Fmoves%2F10000000-0000-4000-8000-000000000401#pedido');
    await axe(page);
    // Move fora do modelo ou inexistente: 404 de verdade.
    expect((await page.goto('/moves/10000000-0000-4000-8000-000000000402'))?.status()).toBe(404);
    expect((await page.goto('/moves/10000000-0000-4000-8000-000000000999'))?.status()).toBe(404);
    expect((await page.goto('/moves/nao-e-uuid'))?.status()).toBe(404);
  });

  test('pessoas: lista, busca, perfil com cargos atuais, histórico e Move; navegação até a empresa e de volta', async ({ page }) => {
    await page.goto('/intelligence/pessoas');
    await expect(page.getByTestId('people-list').getByRole('listitem')).toHaveCount(2);
    await axe(page);
    await page.goto('/intelligence/pessoas?q=bia');
    await expect(page.getByTestId('people-list').getByRole('listitem')).toHaveCount(1);
    // Cargo vigente com fim no futuro (a rota real o manda): não pode sumir da lista.
    await expect(page.getByTestId('people-list')).toContainText('Presidente (MOCK)');
    await page.goto('/intelligence/pessoas');
    await page.getByRole('link', { name: '[MOCK API] Ana Teste' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK API] Ana Teste', { timeout: NAV_MS });
    await expect(page.getByTestId('current-roles')).toContainText('CEO (MOCK)');
    await expect(page.getByTestId('history-roles')).toContainText('Diretora Comercial (MOCK)');
    // DP-38: todo perfil público de pessoa tem o caminho de correção ou remoção (direito de resposta / LGPD).
    await expect(page.getByTestId('request-correction')).toHaveAttribute('href', '/correcoes?alvo=%2Fintelligence%2Fpessoas%2F10000000-0000-4000-8000-000000000201#pedido');
    await expect(page.getByTestId('move-card')).toHaveCount(1);
    // Correção do titular (rota real: periodo e corrigidoPeloTitular): período corrigido e aviso visíveis.
    await expect(page.getByTestId('current-roles')).toContainText('desde nov. 2026 (MOCK, corrigido)');
    await expect(page.getByTestId('current-roles').getByTestId('corrected-tag')).toBeVisible();
    await expect(page.getByTestId('person-meta').getByTestId('corrected-tag')).toBeVisible();
    // Pedido por cargo: ?cargo=<id> na URL do perfil identifica o cargo como alvo (Backend 2).
    await expect(page.getByTestId('current-roles').getByTestId('role-correction')).toHaveAttribute('href', '/correcoes?alvo=%2Fintelligence%2Fpessoas%2F10000000-0000-4000-8000-000000000201%3Fcargo%3D10000000-0000-4000-8000-000000000302#pedido');
    await expect(page.locator('main')).not.toContainText('TRECHO LITERAL');
    await axe(page);
    await page.getByTestId('current-roles').getByRole('link', { name: '[MOCK API] Programa Alfa' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK API] Programa Alfa', { timeout: NAV_MS });
    const people = page.getByTestId('company-people');
    await expect(people).toContainText('CEO (MOCK)');
    await expect(page.getByTestId('move-card')).toHaveCount(1);
    await axe(page);
    await people.getByRole('link', { name: '[MOCK API] Ana Teste' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK API] Ana Teste', { timeout: NAV_MS });
    // M-04: com inicioDeclarado: false da API, o período não mostra a data da coleta como início.
    await page.goto('/intelligence/pessoas/10000000-0000-4000-8000-000000000202');
    await expect(page.getByTestId('current-roles').getByTestId('periodo')).toHaveText('início não informado na fonte; até 31 de dezembro de 2030', { timeout: NAV_MS });
    expect((await page.goto('/intelligence/pessoas/10000000-0000-4000-8000-000000000999'))?.status()).toBe(404);
  });
});

test.describe('fake-api do Intelligence = contrato da API real (erros)', () => {
  test.skip(mode !== 'api' || intel !== '', 'somente no modo api com Intelligence completo');
  // Mesma porta que portal.config.ts dá ao servidor MOCK (base+4, ou 3104 sem PORTAL_PORT_BASE).
  const base = Number(process.env.PORTAL_PORT_BASE) || 0;
  const fake = `http://localhost:${base ? base + 4 : 3104}`;

  test('id fora de UUID = 400 invalid_input (pessoa, Move, empresa); inexistente = 404 not_found', async ({ request }, info) => {
    test.skip(info.project.name !== 'desktop', 'chamada direta: um projeto basta');
    for (const rota of ['pessoas', 'moves', 'empresas']) {
      const r = await request.get(`${fake}/api/publico/intelligence/${rota}/nao-e-uuid`);
      expect(r.status(), rota).toBe(400);
      expect((await r.json()).error.code, rota).toBe('invalid_input');
    }
    const nf = await request.get(`${fake}/api/publico/intelligence/empresas/10000000-0000-4000-8000-000000000999`);
    expect(nf.status()).toBe(404);
    expect((await nf.json()).error.code).toBe('not_found');
  });
});

test.describe('api com pessoas desligadas ou sem registros', () => {
  test.skip(mode !== 'api' || (intel !== 'sem-flag' && intel !== 'vazio'), 'somente com PORTAL_API_INTEL=sem-flag|vazio');

  test('pessoas e Moves: estado vazio honesto (não erro); perfis 404; empresa sem pessoas', async ({ page }) => {
    for (const [rota, texto] of [
      ['/intelligence/pessoas', 'Em breve: primeiros perfis verificados'],
      // No modo vazio o fake-api responde `disponivel: true` com total 0 (o caso do staging): a página não pode prometer
      // disponibilidade; diz que ainda não há Moves publicados.
      ['/moves', 'Ainda não há Moves publicados'],
    ] as const) {
      const res = await page.goto(rota);
      expect(res?.status(), rota).toBe(200);
      await expect(page.getByText(texto), rota).toBeVisible();
      await expect(page.getByTestId('error-state'), rota).toHaveCount(0);
      await axe(page);
    }
    // P3-3 (revisão visual int/012) também com o vazio vindo da API: texto do aviso abaixo do título e bloco "Enquanto isso".
    await page.goto('/moves');
    const titulo = page.getByText('Ainda não há Moves publicados', { exact: true });
    const bt = (await titulo.boundingBox())!;
    const bx = (await page.getByTestId('moves-empty-text').boundingBox())!;
    expect(bx.y, 'o texto do aviso começa abaixo do título').toBeGreaterThanOrEqual(bt.y + bt.height - 1);
    // Coerência: com 0 Moves não aparece nada que sugira lista disponível, nem "em breve" de promessa.
    await expect(page.getByTestId('moves-list')).toHaveCount(0);
    await expect(page.getByTestId('moves-empty-honest')).toBeVisible();
    await expect(page.getByTestId('moves-meanwhile').getByRole('link', { name: /Diretório de empresas/ })).toHaveAttribute('href', '/intelligence/empresas');
    await expect(page.getByTestId('moves-meanwhile').getByRole('link', { name: /Pessoas e cargos/ })).toHaveAttribute('href', '/intelligence/pessoas');
    expect((await page.goto('/intelligence/pessoas/10000000-0000-4000-8000-000000000201'))?.status()).toBe(404);
    expect((await page.goto('/moves/10000000-0000-4000-8000-000000000401'))?.status()).toBe(404);
    await page.goto('/intelligence/empresas/10000000-0000-4000-8000-000000000001');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('[MOCK API] Programa Alfa', { timeout: NAV_MS });
    await expect(page.getByText('Em breve: executivos verificados')).toBeVisible({ timeout: NAV_MS });
    await expect(page.getByTestId('move-card')).toHaveCount(0);
    await page.goto('/intelligence');
    await expect(page.getByTestId('count-pessoas')).toHaveText('Cadastros verificados: em breve');
    await expect(page.getByTestId('count-moves')).toHaveText('Cadastros verificados: em breve');
  });
});

test.describe('mock: pessoas e Moves', () => {
  test.skip(mode !== 'mock', 'somente no modo mock');

  test('Move MOCK com antes e depois; pessoa MOCK com histórico; navegação', async ({ page }) => {
    await page.goto('/moves');
    const card = page.getByTestId('move-card');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('MOCK');
    await expect(card.getByTestId('move-before')).toContainText('Diretora de Parcerias (MOCK)');
    await expect(card.getByTestId('move-after')).toContainText('Diretora-Geral (MOCK)');
    await axe(page);
    await card.getByRole('link', { name: 'perfil' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pessoa de Teste Um (MOCK)', { timeout: NAV_MS });
    await expect(page.getByTestId('history-roles')).toContainText('Diretora de Parcerias (MOCK)');
    await expect(page.getByTestId('request-correction')).toBeVisible();
    await axe(page);
    await page.goto('/intelligence/pessoas');
    await expect(page.getByTestId('people-list').getByRole('listitem')).toHaveCount(2);
    await axe(page);
  });
});