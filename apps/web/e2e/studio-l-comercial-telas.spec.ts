import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrar, enviar } from './helpers';

// Telas comerciais do Studio (Studio 3): anunciantes e contatos no CRM; posições, criativos e transição com reservas na campanha.
// DP-43 por ambiente: venda, aprovação e ativação só no staging; em produção (padrão do e2e) a tela não tem esses controles.
const STAGING = process.env.APP_ENV === 'staging';
const erro = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.err').filter({ hasText: txt }).first()).toBeVisible();
const sucesso = (page: Page, txt: string | RegExp) => expect(page.locator('main .st-alert.ok').filter({ hasText: txt }).first()).toBeVisible();
async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const resumo = r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`);
  expect(resumo, resumo.join('\n')).toEqual([]);
}

test.describe('Studio comercial: anunciantes, posições e criativos', () => {
  test.describe.configure({ mode: 'serial' });

  test('CRM: lead convertido vira anunciante com o contato; axe', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/crm');
    const sec = page.getByTestId('anunciantes');
    await expect(sec.getByRole('heading', { name: 'Anunciantes e contatos' })).toBeVisible();

    await page.getByLabel('Nome', { exact: true }).fill('Rita Lima');
    await page.getByLabel('Empresa').fill('Fidelidade Telas SA');
    await page.getByLabel('E-mail').fill('rita@fidelidadetelas.com.br');
    await page.getByLabel('Objetivo').fill('Banner topo');
    await enviar(page, page.getByRole('button', { name: 'Registrar lead' }));
    await sucesso(page, 'Lead registrado');
    // lead ainda não convertido: não é contato de conta nenhuma
    await expect(sec.locator('[data-contato]').filter({ hasText: 'Rita Lima' })).toHaveCount(0);

    await enviar(page, page.getByRole('button', { name: 'qualificar Rita Lima' }));
    await enviar(page, page.getByRole('button', { name: 'converter Rita Lima' }));
    await sucesso(page, 'Lead convertido em oportunidade.');
    const conta = sec.locator('[data-conta]').filter({ hasText: 'Fidelidade Telas SA' });
    await expect(conta).toBeVisible();
    await expect(conta).toContainText('1 lead(s)');
    await expect(conta).toContainText('0 campanha(s)');
    await expect(conta.getByRole('list', { name: 'Contatos de Fidelidade Telas SA' })).toContainText('rita@fidelidadetelas.com.br');
    await expect(conta.getByRole('link', { name: 'Campanhas de Fidelidade Telas SA' })).toHaveAttribute('href', /\/studio\/campanhas\?conta=/);
    // o filtro de leads não esconde os contatos dos anunciantes
    await page.goto('/studio/crm?status=descartado');
    await expect(page.getByTestId('anunciantes').locator('[data-contato]').filter({ hasText: 'Rita Lima' })).toHaveCount(1);
    await page.goto('/studio/crm');
    await semViolacoes(page);
  });

  test('campanha: reservar posição, transição com reservas, criativo recusado sem arquivo; axe', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/campanhas');
    await page.getByLabel('Nome', { exact: true }).fill('Telas Topo');
    await page.getByLabel('Anunciante (conta)').selectOption({ label: 'Fidelidade Telas SA' });
    await page.getByLabel('Início (obrigatório)').fill('2099-03-01');
    await page.getByLabel('Fim (obrigatório)').fill('2099-05-31');
    await enviar(page, page.getByRole('button', { name: 'Criar campanha' }));
    await sucesso(page, 'Campanha criada em rascunho.');

    // estados vazios honestos
    await expect(page.locator('[data-vazio="posicoes"]')).toBeVisible();
    await expect(page.locator('[data-vazio="criativos"]')).toBeVisible();

    // posições da campanha: sem nenhuma, não há reserva nem criativo; salvar sem marcar é recusado
    await expect(page.locator('[data-vazio="posicoes-campanha"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reservar posição' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Adicionar criativo' })).toHaveCount(0);
    await enviar(page, page.getByRole('button', { name: 'Salvar posições' }));
    await expect(page.locator('main .st-alert.err').first()).toBeVisible();
    await page.getByTestId('posicoes-campanha').getByLabel('TOP').check();
    await enviar(page, page.getByRole('button', { name: 'Salvar posições' }));
    await sucesso(page, 'Posições da campanha atualizadas.');
    await expect(page.getByTestId('posicoes-campanha').getByLabel('TOP')).toBeChecked();
    await expect(page.getByLabel('Posição', { exact: true }).locator('option')).toHaveCount(1);
    // venda desligada: confirmar não é oferecido (só pré-reserva)
    if (STAGING) await expect(page.getByLabel('Confirmar venda')).toBeDisabled(); // venda liberada no ambiente, flag desligada
    else {
      await expect(page.getByLabel('Confirmar venda')).toHaveCount(0); // produção: nenhum controle de venda
      await expect(page.getByTestId('venda-desligada-ambiente')).toBeVisible();
    }

    // período inválido: o domínio recusa e a página mostra
    await page.getByLabel('Início da reserva').fill('2099-05-31');
    await page.getByLabel('Fim da reserva').fill('2099-03-01');
    await enviar(page, page.getByRole('button', { name: 'Reservar posição' }));
    await expect(page.locator('main .st-alert.err').first()).toBeVisible();

    await enviar(page, page.getByRole('button', { name: 'Reservar posição' }));
    await sucesso(page, 'Posição reservada.');
    const reserva = page.locator('tr[data-reserva]');
    await expect(reserva).toHaveCount(1);
    await expect(reserva).toHaveAttribute('data-status', 'held');
    await expect(reserva).toContainText('pré-reserva');
    await expect(reserva).toContainText('2099-03-01');
    await expect(reserva).toContainText('2099-05-31');
    await expect(reserva.locator('svg.st-seta')).toHaveCount(1);

    // com a reserva, 'reserved' passa (antes recusava por falta de reserva)
    await enviar(page, page.getByRole('button', { name: 'Mover para reserved' }));
    await sucesso(page, 'Estado da campanha atualizado.');
    await expect(page.locator('main .st-badge').first()).toHaveText('reserved');
    await expect(page.getByTestId('posicoes-campanha').getByRole('button', { name: 'Salvar posições' })).toHaveCount(0); // fora de rascunho não muda

    // criativo: nasce não aprovado; aprovar sem arquivo é recusado com o que falta
    await page.getByLabel('Texto alternativo').fill('Banner topo Telas');
    await page.getByLabel('Destino (https').fill('https://fidelidadetelas.example/oferta');
    await enviar(page, page.getByRole('button', { name: 'Adicionar criativo' }));
    await sucesso(page, 'Criativo adicionado');
    const cr = page.locator('li[data-criativo]');
    await expect(cr).toHaveCount(1);
    await expect(cr).toHaveAttribute('data-aprovado', 'nao');
    await expect(cr).toContainText('Arquivo: nenhum');
    const crId = (await cr.getAttribute('data-criativo'))!;
    // DP-43: o comercial não aprova (sem botão); o proprietário (admin) tenta e o domínio recusa o criativo incompleto
    await expect(page.getByRole('button', { name: `Aprovar ${crId}` })).toHaveCount(0);
    const urlCamp = page.url().split('?')[0]!;
    await entrar(context, 'dono', 'admin');
    await page.goto(urlCamp);
    if (STAGING) {
      await enviar(page, page.getByRole('button', { name: `Aprovar ${crId}` }));
      await erro(page, /incompleto|especificação/);
    } else {
      // produção: nem o proprietário vê "Aprovar" (aprovação só no staging)
      await expect(page.getByRole('button', { name: `Aprovar ${crId}` })).toHaveCount(0);
      await expect(page.getByTestId('venda-desligada-ambiente')).toBeVisible();
    }
    await expect(page.getByTestId('aprovacao-proprietario')).toHaveCount(0);
    await entrar(context, 'caio', 'comercial');
    await page.goto(urlCamp);
    await expect(page.locator('li[data-criativo]')).toHaveAttribute('data-aprovado', 'nao');

    // envio sem arquivo: aviso, nada gravado; com arquivo e sem armazenamento S3 no teste, recusa honesta (nunca sucesso falso)
    await enviar(page, page.getByRole('button', { name: `Enviar arquivo de ${crId}` }));
    await erro(page, 'Escolha o arquivo do criativo.');
    await page.getByLabel(`Arquivo de ${crId}`).setInputFiles({ name: 'topo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]) });
    await enviar(page, page.getByRole('button', { name: `Enviar arquivo de ${crId}` }));
    await expect(page.locator('main .st-alert.err').first()).toBeVisible();
    await expect(page.locator('main .st-alert.ok')).toHaveCount(0);
    await semViolacoes(page);

    // cancelar a reserva de campanha não ativa
    await enviar(page, page.getByRole('button', { name: /Cancelar reserva TOP/ }));
    await sucesso(page, 'Reserva cancelada.');
    await expect(page.locator('tr[data-reserva]')).toHaveAttribute('data-status', 'cancelled');
    await expect(page.getByRole('button', { name: /Cancelar reserva TOP/ })).toHaveCount(0);

    // o CRM conta a campanha da conta
    await page.goto('/studio/crm');
    await expect(page.getByTestId('anunciantes').locator('[data-conta]').filter({ hasText: 'Fidelidade Telas SA' })).toContainText('1 campanha(s)');
  });

  test('anunciante direto, contato com base legal e relatório do anunciante com CSV; axe', async ({ page, context, request }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio/crm');
    await page.getByLabel('Nome do anunciante').fill('Anunciante Direto Ltda');
    await enviar(page, page.getByRole('button', { name: 'Criar anunciante' }));
    await sucesso(page, 'Anunciante criado.');
    const conta = page.getByTestId('anunciantes').locator('[data-conta]').filter({ hasText: 'Anunciante Direto Ltda' });
    await expect(conta.locator('[data-vazio="contatos"]')).toBeVisible();

    // sem base legal: recusado pelo domínio
    await conta.getByText('Adicionar contato a Anunciante Direto Ltda').click();
    await conta.getByLabel('Nome do contato').fill('Bruno Reis');
    await conta.getByLabel('Email do contato').fill('bruno@direto.example');
    await enviar(page, conta.getByRole('button', { name: 'Registrar contato' }));
    await expect(page.locator('main .st-alert.err').first()).toBeVisible();

    const conta2 = page.getByTestId('anunciantes').locator('[data-conta]').filter({ hasText: 'Anunciante Direto Ltda' });
    await conta2.getByText('Adicionar contato a Anunciante Direto Ltda').click();
    await conta2.getByLabel('Nome do contato').fill('Bruno Reis');
    await conta2.getByLabel('Email do contato').fill('bruno@direto.example');
    await conta2.getByLabel('Cargo').fill('Marketing');
    await conta2.getByLabel('Base legal').selectOption('legitimo_interesse');
    await enviar(page, conta2.getByRole('button', { name: 'Registrar contato' }));
    await sucesso(page, 'Contato registrado');
    const contato = page.getByTestId('anunciantes').locator('[data-contato][data-origem="direto"]').filter({ hasText: 'Bruno Reis' });
    await expect(contato).toContainText('Legítimo interesse');
    await expect(contato).toContainText('(Marketing)');
    await semViolacoes(page);

    // relatório do anunciante sem campanha: vazio honesto, traço e nunca estimado
    await page.getByRole('link', { name: 'Relatório de Anunciante Direto Ltda' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Anunciante Direto Ltda' })).toBeVisible();
    for (const k of ['servidas', 'visiveis', 'cliques', 'taxa-vis', 'ctr', 'atualizado']) await expect(page.getByTestId(`rel-${k}`)).toHaveText('—');
    await expect(page.getByTestId('rel-estimado')).toContainText('não');
    await expect(page.locator('[data-vazio="campanhas"]')).toBeVisible();
    expect(await page.getByTestId('relatorio-anunciante').innerText()).not.toMatch(/R\$|fatur|cobran|pre[cç]o/i);
    await semViolacoes(page);

    // relatório do anunciante com campanha: a campanha da conta aparece; janela inválida mostra o erro
    await page.goto('/studio/crm');
    await page.getByRole('link', { name: 'Relatório de Fidelidade Telas SA' }).click();
    await expect(page.locator('tr[data-campanha]').filter({ hasText: 'Telas Topo' })).toContainText('TOP');
    const url = page.url();
    await page.goto(`${url}?de=2099-05-31&ate=2099-03-01`);
    await expect(page.getByTestId('rel-erro')).toContainText(/janela/i);

    // CSV: anexo protegido, só cabeçalho sem entrega (nenhum zero inventado)
    await page.goto(url);
    const href = (await page.getByRole('link', { name: 'Exportar CSV diário' }).getAttribute('href'))!;
    const diario = await page.request.get(href);
    expect(diario.status()).toBe(200);
    expect(diario.headers()['content-type']).toContain('text/csv');
    expect(diario.headers()['content-disposition']).toMatch(/^attachment; filename="[a-z0-9.-]+\.csv"$/);
    expect((await diario.text()).replace(/^\uFEFF/, '').trimEnd().split('\r\n')).toHaveLength(1);
    const anonimo = await request.get(href, { maxRedirects: 0 });
    expect(anonimo.headers()['content-type'] ?? '').not.toContain('text/csv');
  });

  test('revisão visual int/012: axe no celular (tabela rolável focável) e sem nome de flag na tela', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.setViewportSize({ width: 390, height: 800 });
    for (const rota of ['/studio/inventario', '/studio/campanhas', '/studio/crm', '/studio/creative']) {
      await page.goto(rota);
      await semViolacoes(page);
      const texto = await page.locator('main').innerText();
      expect(texto, rota).not.toMatch(/\(flag |adServerVendas|flag instagram/);
    }
    // a região que rola recebe foco pelo teclado e tem nome
    await page.goto('/studio/inventario');
    const regiao = page.getByRole('region', { name: 'Posições do inventário' });
    await expect(regiao).toHaveAttribute('tabindex', '0');
    // estados do CRM em português, com acento
    await page.goto('/studio/crm');
    await expect(page.locator('[data-stage="negociacao"]')).toContainText('Negociação');
  });

  test('RBAC: editor não chega às telas nem às actions comerciais', async ({ page, context }) => {
    await entrar(context, 'ed3', 'editor');
    for (const m of ['crm', 'campanhas']) {
      await page.goto(`/studio/${m}`);
      await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    }
  });
});
