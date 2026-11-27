import { expect, test } from '@playwright/test';
import { entrar, enviar } from './helpers';

const erro = (page: import('@playwright/test').Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: import('@playwright/test').Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();

test.describe('Comercial (@ln/commercial)', () => {
  test.describe.configure({ mode: 'serial' });

  test('papéis: só comercial e admin; editor é negado', async ({ page, context }) => {
    await entrar(context, 'ed', 'editor');
    for (const m of ['crm', 'inventario', 'campanhas']) {
      await page.goto(`/studio/${m}`);
      await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    }
  });

  test('inventário: 9 posições, sem número inventado, venda desligada, filtros do catálogo', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/inventario');
    await expect(page.getByRole('heading', { level: 1, name: 'Inventário' })).toBeVisible();
    await expect(page.getByText('Venda no ad server:')).toContainText('desligada');
    await expect(page.locator('tr[data-posicao]')).toHaveCount(9);
    await expect(page.locator('tr[data-posicao="TOP"]')).toContainText('1280x150');
    await expect(page.getByText(/Capacidades: venda desligada.*Instagram desligado/)).toBeVisible();
    await expect(page.getByText('Audiência:')).toBeVisible();

    const linhas = page.getByRole('table').nth(1).locator('tbody tr');
    const todos = await linhas.count();
    expect(todos).toBe(47);
    await page.getByLabel('Disponibilidade').selectOption('indisponivel');
    await enviar(page, page.getByRole('button', { name: 'Filtrar' }));
    const filtrados = await page.getByRole('table').nth(1).locator('tbody tr').count();
    expect(filtrados).toBeLessThan(47);
    await page.goto('/studio/inventario?status=xyz');
    await expect(page.getByText('Filtro de seção ou disponibilidade inválido')).toBeVisible();
  });

  test('CRM: estado vazio, validação, lead → qualificado → oportunidade → estágios', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/crm');
    await expect(page.getByRole('heading', { name: 'Nenhum lead' })).toBeVisible();
    await enviar(page, page.getByRole('button', { name: 'Registrar lead' }));
    await erro(page, /obrigatórios|Entrada inválida/);

    await page.getByLabel('Nome', { exact: true }).fill('Maria Souza');
    await page.getByLabel('Empresa').fill('Banco Exemplo');
    await page.getByLabel('E-mail').fill('maria@bancoexemplo.com.br');
    await page.getByLabel('Objetivo').fill('Campanha de cartão');
    await enviar(page, page.getByRole('button', { name: 'Registrar lead' }));
    await sucesso(page, 'Lead registrado');
    await expect(page.getByRole('row', { name: /Maria Souza/ })).toContainText('Novo');

    await enviar(page, page.getByRole('button', { name: 'qualificar Maria Souza' }));
    await sucesso(page, 'Lead qualificado.');
    await enviar(page, page.getByRole('button', { name: 'converter Maria Souza' }));
    await sucesso(page, 'Lead convertido em oportunidade.');
    await expect(page.getByRole('row', { name: /Maria Souza/ })).toContainText('Convertido');
    await expect(page.locator('[data-stage="novo"]')).toContainText('Banco Exemplo');

    await page.getByLabel(/Mover .* para/).first().selectOption('perdido');
    await page.getByRole('button', { name: /^Mover / }).first().click();
    await erro(page, /motivo/i);
    await page.getByLabel(/Mover .* para/).first().selectOption('perdido'); // a página recarregou após a recusa
    await page.getByLabel(/Motivo da perda/).first().fill('Sem verba');
    await page.getByRole('button', { name: /^Mover / }).first().click();
    await sucesso(page, 'Estágio atualizado.');
    await expect(page.locator('[data-stage="perdido"]')).toContainText('Banco Exemplo');

    await page.goto('/studio/crm?status=descartado');
    await expect(page.getByRole('heading', { name: 'Nenhum lead' })).toBeVisible();
    await page.goto('/studio/crm?status=zzz');
    await expect(page.getByText('Filtro inválido.')).toBeVisible();
  });

  test('campanhas: criar a partir da conta, estados do blueprint e recusas do domínio', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/campanhas');
    await expect(page.getByText('Venda no ad server:')).toContainText('desligada');
    await expect(page.getByRole('heading', { name: 'Nenhuma campanha' })).toBeVisible();
    await expect(page.locator('[data-estado="draft"]')).toContainText('draft: 0');
    await page.getByLabel('Nome', { exact: true }).fill('Cartão Verão');
    await page.getByLabel('Início (obrigatório)').fill('2099-01-10');
    await page.getByLabel('Fim (obrigatório)').fill('2099-01-09');
    await enviar(page, page.getByRole('button', { name: 'Criar campanha' }));
    await erro(page, /endDate|anterior/);

    await page.getByLabel('Nome', { exact: true }).fill('Cartão Verão');
    await page.getByLabel('Início (obrigatório)').fill('2099-01-10');
    await page.getByLabel('Fim (obrigatório)').fill('2099-01-20');
    await enviar(page, page.getByRole('button', { name: 'Criar campanha' }));
    await sucesso(page, 'Campanha criada em rascunho.');
    await expect(page.getByRole('heading', { level: 1, name: 'Cartão Verão' })).toBeVisible();
    await expect(page.getByTestId('rel-servidas')).toHaveText('—'); // sem entrega registrada: traço, nunca 0
    await expect(page.getByText('não disponível (sem analytics)')).toBeVisible();

    await enviar(page, page.getByRole('button', { name: 'Mover para reserved' }));
    await erro(page, /reserva/i);
    await expect(page.getByRole('button', { name: 'Mover para active' })).toHaveCount(0);

    await enviar(page, page.getByRole('button', { name: 'Mover para cancelled' }));
    await sucesso(page, 'Estado da campanha atualizado.');
    await expect(page.getByText('Estado final.')).toBeVisible();
    await page.goto('/studio/campanhas');
    await expect(page.locator('[data-estado="cancelled"]')).toContainText('cancelled: 1');
    await expect(page.locator('[data-estado="draft"]')).toContainText('draft: 0');
    // lista do Backend (GET /api/commercial/studio/campaigns): linha com estado, formato, período e anunciante; filtros e recusa de filtro
    const linha = page.locator('tr[data-campanha]').filter({ hasText: 'Cartão Verão' });
    await expect(linha).toHaveAttribute('data-status', 'cancelled');
    // nome acessível da célula: as duas datas e o separador lido pelo leitor de tela (a seta em SVG é só visual)
    await expect(linha.getByRole('cell', { name: '2099-01-10 a 2099-01-20', exact: true })).toBeVisible();
    await expect(linha.locator('svg.st-seta[aria-hidden="true"]')).toHaveCount(1);
    await expect(page.getByText('1 campanha(s) · página 1 de 1')).toBeVisible();
    await page.getByLabel('Estado', { exact: true }).selectOption('active');
    await enviar(page, page.getByRole('button', { name: 'Filtrar' }));
    await expect(page.locator('[data-vazio="filtro"]')).toBeVisible();
    await page.goto('/studio/campanhas?status=cancelled&q=verao');
    await expect(page.locator('[data-vazio="filtro"]')).toBeVisible(); // 'verao' sem acento não casa com 'Verão': busca é por nome contém
    await page.goto('/studio/campanhas?status=cancelled&q=Cartão');
    await expect(page.locator('tr[data-campanha]')).toHaveCount(1);
    await page.goto('/studio/campanhas');
    await page.getByLabel('ID da campanha').fill('campanha-que-nao-existe');
    await enviar(page, page.getByRole('button', { name: 'Abrir' }));
    await expect(page).toHaveURL(/campanhas[/]campanha-que-nao-existe/);
    const r = await page.goto('/studio/campanhas/inexistente');
    expect(r?.status()).toBe(404);
  });

  test('campanhas: relatório do anunciante (sem dado = "—"), janela e exportação CSV com acesso protegido', async ({ page, context, request }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/campanhas');
    await page.getByLabel('Nome', { exact: true }).fill('Relatório Teste');
    await page.getByLabel('Início (obrigatório)').fill('2099-01-10');
    await page.getByLabel('Fim (obrigatório)').fill('2099-01-20');
    await enviar(page, page.getByRole('button', { name: 'Criar campanha' }));
    await sucesso(page, 'Campanha criada em rascunho.');
    const id = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!);

    // cabeçalho e estado vazio honesto
    const rel = page.getByTestId('relatorio');
    await expect(rel.getByRole('heading', { name: 'Relatório do anunciante' })).toBeVisible();
    await expect(page.getByTestId('rel-anunciante')).not.toHaveText('');
    await expect(rel).toContainText('10/01/2099 a 20/01/2099');
    for (const k of ['servidas', 'visiveis', 'cliques', 'taxa-vis', 'ctr', 'atualizado']) await expect(page.getByTestId(`rel-${k}`)).toHaveText('—');
    await expect(page.getByTestId('rel-vazio')).toContainText('ainda não foi ativada');
    await expect(page.getByTestId('rel-estimado')).toContainText('não');
    await expect(page.getByTestId('rel-origem')).toContainText('Servidor de anúncios');
    await expect(page.getByTestId('rel-por-dia')).toHaveCount(0);
    expect(await rel.innerText()).not.toMatch(/R\$|fatur|cobran|pre[cç]o/i);

    // janela: válida recorta; inválida mostra o aviso e a página continua
    await page.goto(`/studio/campanhas/${encodeURIComponent(id)}?de=2099-01-12&ate=2099-01-15`);
    await expect(page.getByTestId('rel-janela')).toContainText('12/01/2099 a 15/01/2099');
    await expect(page.getByRole('link', { name: 'Exportar CSV diário' })).toHaveAttribute('href', /de=2099-01-12&ate=2099-01-15/);
    await page.goto(`/studio/campanhas/${encodeURIComponent(id)}?de=2099-01-15&ate=2099-01-12`);
    await expect(page.getByTestId('rel-erro')).toContainText(/janela/i);
    await expect(page.getByRole('heading', { level: 1, name: 'Relatório Teste' })).toBeVisible();

    // CSV: cabeçalhos de download e conteúdo (sem dado: só o cabeçalho, nenhuma linha de zero)
    await page.goto(`/studio/campanhas/${encodeURIComponent(id)}`);
    const href = (await page.getByRole('link', { name: 'Exportar CSV diário' }).getAttribute('href'))!;
    const diario = await page.request.get(href);
    expect(diario.status()).toBe(200);
    expect(diario.headers()['content-type']).toBe('text/csv; charset=utf-8');
    expect(diario.headers()['content-disposition']).toMatch(/^attachment; filename="relatorio-diario-[a-z0-9-]+-2099-01-10-2099-01-20\.csv"$/);
    expect(diario.headers()['x-content-type-options']).toBe('nosniff');
    expect(diario.headers()['cache-control']).toBe('no-store');
    const corpo = await diario.text();
    expect(corpo.charCodeAt(0)).toBe(0xfeff);
    expect(corpo.replace(/^\uFEFF/, '').trimEnd().split('\r\n')).toEqual(['campanha_id,campanha,anunciante,data,posicao,criativo_id,impressoes_servidas,impressoes_visiveis,cliques_validos,taxa_visibilidade,ctr,origem,coletado_em,periodo_auditavel']);
    const resumo = await page.request.get(href.replace('tipo=diario', 'tipo=resumo'));
    expect(resumo.status()).toBe(200);
    const r = await resumo.text();
    expect(r).toContain('\r\nestimado,nao\r\n'); expect(r).toContain('\r\nimpressoes_servidas,\r\n'); expect(r).toContain('sem_dado,');
    // janela inválida no CSV: recusa legível, sem arquivo
    const ruim = await page.request.get(href.replace(/de=[^&]+&ate=[^&]+/, 'de=2099-01-15&ate=2099-01-12'));
    expect(ruim.status()).toBe(422); expect(ruim.headers()['content-type']).toContain('text/plain');

    // protegido: sem sessão e com papel sem permissão NÃO recebem o arquivo
    const anonimo = await request.get(href, { maxRedirects: 0 });
    expect(anonimo.headers()['content-type'] ?? '').not.toContain('text/csv');
    expect(await anonimo.text()).not.toContain('campanha_id');
    await entrar(context, 'edu', 'editor');
    const editor = await page.request.get(href, { maxRedirects: 0 });
    expect(editor.headers()['content-type'] ?? '').not.toContain('text/csv');
    expect(await editor.text()).not.toContain('campanha_id');
  });
});
