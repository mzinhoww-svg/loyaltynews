import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrar, enviar } from './helpers';

// Refino do lançamento, pacote C, item 3 (formulários): resumo de erros no topo com foco, erro por campo com aria-invalid e aria-describedby,
// marcador de obrigatório, barra de salvar fixa no celular e foco na mensagem de erro das ações. (O botão com `loading` espera o pacote D.)

async function enviarVazio(page: Page) {
  await page.goto('/studio/cms/nova');
  await enviar(page, page.getByRole('button', { name: 'Criar rascunho' }));
  await expect(page.locator('[data-resumo-erros]')).toBeVisible();
}

test('resumo dos erros no topo: recebe o foco, diz quantos campos faltam e cada item leva ao campo', async ({ page, context }) => {
  await entrar(context, 'frm1', 'editor');
  await enviarVazio(page);
  const resumo = page.locator('[data-resumo-erros]');
  await expect(resumo).toBeFocused();
  await expect(resumo).toHaveAttribute('role', 'alert');
  await expect(resumo).toContainText('Corrija os campos destacados');
  const itens = resumo.getByRole('listitem');
  expect(await itens.count()).toBeGreaterThanOrEqual(2);
  // cada item é um link para o campo: ativar leva o foco ao controle
  await resumo.getByRole('link', { name: 'Título' }).click();
  await expect(page.locator('#titulo')).toBeFocused();
  await page.locator('[data-resumo-erros]').scrollIntoViewIfNeeded();
  await page.locator('[data-resumo-erros]').getByRole('link', { name: 'Corpo da matéria' }).click();
  await expect(page.locator('#corpo')).toBeFocused();
});

test('erro por campo: aria-invalid e aria-describedby apontam para a mensagem; editar o campo limpa o erro', async ({ page, context }) => {
  await entrar(context, 'frm1', 'editor');
  await enviarVazio(page);
  for (const id of ['titulo', 'corpo', 'editoria']) {
    const campo = page.locator(`#${id}`);
    await expect(campo, id).toHaveAttribute('aria-invalid', 'true');
    const ligado = (await campo.getAttribute('aria-describedby'))!.split(' ');
    expect(ligado, id).toContain(`${id}-erro`);
    const msg = page.locator(`#${id}-erro`);
    await expect(msg, id).toBeVisible();
    expect((await msg.textContent())!.trim().length, id).toBeGreaterThan(3);
  }
  // o campo "corpo" mantém também a dica ligada (não troca uma descrição pela outra)
  expect(await page.locator('#corpo').getAttribute('aria-describedby')).toContain('corpo-dica');
  // editar o título limpa só o erro dele
  await page.locator('#titulo').fill('Um título novo para limpar o erro');
  await expect(page.locator('#titulo')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#titulo-erro')).toHaveCount(0);
  await expect(page.locator('#corpo')).toHaveAttribute('aria-invalid', 'true');
});

test('marcador de obrigatório fora do rótulo: o nome acessível do campo não muda e o campo leva aria-required', async ({ page, context }) => {
  await entrar(context, 'frm1', 'editor');
  await page.goto('/studio/cms/nova');
  for (const [nome, id] of [['Título', 'titulo'], ['Editoria', 'editoria'], ['Corpo da matéria', 'corpo']] as const) {
    await expect(page.getByLabel(nome, { exact: true }), nome).toHaveAttribute('aria-required', 'true');
    await expect(page.locator('.st-label-linha', { has: page.locator(`label[for="${id}"]`) }).locator('.st-obrig'), nome).toHaveAttribute('aria-hidden', 'true');
  }
  await expect(page.getByLabel('Subtítulo (opcional)')).not.toHaveAttribute('aria-required', 'true');
  await expect(page.getByText('campo obrigatório para salvar.')).toBeVisible();
});

test('celular (390 px): a barra de salvar fica presa no rodapé da tela; botão de 44 px; sem rolagem horizontal', async ({ page, context }) => {
  await entrar(context, 'frm1', 'editor');
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/studio/cms/nova');
  const barra = page.locator('.st-barra-salvar');
  expect(await barra.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
  // com a página no topo (formulário longo), a barra já aparece colada ao rodapé da janela
  const caixa = (await barra.boundingBox())!;
  expect(caixa.y + caixa.height, 'a barra deve caber dentro da janela no topo da página').toBeLessThanOrEqual(641);
  expect(caixa.y, 'a barra deve estar na parte de baixo da janela').toBeGreaterThan(400);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(900);
  await page.evaluate(() => window.scrollTo(0, 500));
  const depois = (await barra.boundingBox())!;
  expect(Math.round(depois.y + depois.height), 'continua presa ao rodapé depois de rolar').toBeLessThanOrEqual(641);
  expect(depois.y).toBeGreaterThan(400);
  const botao = barra.getByRole('button', { name: 'Criar rascunho' });
  expect((await botao.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('o foco ao tabular segue a ordem do formulário e o campo focado não fica escondido atrás da barra fixa', async ({ page, context }) => {
  await entrar(context, 'frm1', 'editor');
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/studio/cms/nova');
  const ordem: string[] = [];
  await page.locator('#titulo').focus();
  for (let i = 0; i < 5; i++) {
    ordem.push(await page.evaluate(() => document.activeElement?.id ?? ''));
    await page.keyboard.press('Tab');
  }
  expect(ordem.slice(0, 4)).toEqual(['titulo', 'subtitulo', 'resumo', 'editoria']);
  // um campo lá embaixo, focado por teclado, fica acima da barra (scroll-padding reserva o espaço dela)
  await page.locator('#rotulo').focus();
  const campo = (await page.locator('#rotulo').boundingBox())!;
  const barra = (await page.locator('.st-barra-salvar').boundingBox())!;
  expect(campo.y + campo.height, 'campo coberto pela barra de salvar').toBeLessThanOrEqual(barra.y + 1);
});

test('erro de ação (Flash) recebe o foco: cadastrar fonte rápida sem URL', async ({ page, context }) => {
  await entrar(context, 'frm1', 'editor');
  await page.goto('/studio/cms/nova');
  const form = page.locator('[data-painel="fonte-rapida"]').getByRole('form', { name: 'Nova fonte rápida' });
  await enviar(page, form.getByRole('button', { name: 'Criar fonte (a confirmar)' }));
  const flash = page.locator('main [data-flash="erro"]');
  await expect(flash).toBeVisible();
  await expect(flash).toBeFocused();
  await expect(flash).toHaveAttribute('role', 'alert');
});

test('axe limpo com os erros na tela, a 390 e 1280 px', async ({ page, context }) => {
  await entrar(context, 'frm1', 'editor');
  for (const largura of [390, 1280]) {
    await page.setViewportSize({ width: largura, height: 800 });
    await enviarVazio(page);
    const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ax.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 2).join(' | ')}`), `@${largura}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `@${largura} rola na horizontal`).toBe(true);
  }
});
