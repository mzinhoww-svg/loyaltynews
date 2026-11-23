import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

test.describe('Biblioteca de mídia', () => {
  test.describe.configure({ mode: 'serial' });

  test('estado vazio, validação de direito e registro', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/midia');
    await expect(page.getByRole('heading', { name: 'Nenhum ativo na biblioteca' })).toBeVisible();
    await page.getByRole('button', { name: 'Registrar ativo' }).click();
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'URL do ativo inválida' }).first()).toBeVisible();

    await page.getByLabel('URL do ativo').fill('https://exemplo.com.br/a.jpg');
    await page.getByLabel('Origem').selectOption('licenciada');
    await page.getByLabel('Base de direito').selectOption('licenca');
    await page.getByLabel('Crédito').fill('Agência');
    await page.getByLabel('Texto alternativo').fill('Cartão');
    await page.getByRole('button', { name: 'Registrar ativo' }).click();
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'exige evidência de licença' }).first()).toBeVisible();

    await page.getByLabel('URL do ativo').fill('https://exemplo.com.br/a.jpg');
    await page.getByLabel('Origem').selectOption('licenciada');
    await page.getByLabel('Base de direito').selectOption('licenca');
    await page.getByLabel('Crédito').fill('Agência');
    await page.getByLabel('Texto alternativo').fill('Cartão');
    await page.getByLabel(/Evidência da licença/).fill('contrato-123');
    await page.getByRole('button', { name: 'Registrar ativo' }).click();
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Ativo registrado' }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /a\.jpg/ })).toContainText('Utilizável');
  });

  test('direito pendente e licença expirada não são utilizáveis; remover audita', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/midia');
    await page.getByLabel('URL do ativo').fill('https://exemplo.com.br/p.jpg');
    await page.getByLabel('Crédito').fill('Própria');
    await page.getByLabel('Texto alternativo').fill('Pendente');
    await page.getByRole('button', { name: 'Registrar ativo' }).click();
    await expect(page.getByRole('row', { name: /p\.jpg/ })).toContainText('Direito pendente');

    await page.getByLabel('URL do ativo').fill('https://exemplo.com.br/e.jpg');
    await page.getByLabel('Base de direito').selectOption('propria');
    await page.getByLabel('Crédito').fill('Própria');
    await page.getByLabel('Texto alternativo').fill('Expirada');
    await page.getByLabel('Expiração da licença').fill('2000-01-01');
    await page.getByRole('button', { name: 'Registrar ativo' }).click();
    await expect(page.getByRole('row', { name: /e\.jpg/ })).toContainText('Licença expirada');

    await page.getByRole('button', { name: /Remover https:\/\/exemplo\.com\.br\/e\.jpg/ }).click();
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Ativo removido.' }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /e\.jpg/ })).toHaveCount(0);
  });
});

test.describe('Agenda e eventos', () => {
  test.describe.configure({ mode: 'serial' });

  test('exige fonte oficial; evento encerrado sai da lista de próximos', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/agenda');
    await expect(page.getByRole('heading', { name: 'Nenhum evento cadastrado' })).toBeVisible();
    await page.getByLabel('Título').fill('Congresso sem fonte');
    await page.getByLabel(/Início/).fill('2099-12-01');
    await page.getByLabel('Local').fill('São Paulo');
    await page.getByRole('button', { name: 'Criar evento' }).click();
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'Fonte oficial obrigatória' }).first()).toBeVisible();

    const criar = async (titulo: string, inicio: string, fim: string) => {
      await page.getByLabel('Título').fill(titulo);
      await page.getByLabel(/Início/).fill(inicio);
      await page.getByLabel(/Fim/).fill(fim);
      await page.getByLabel('Local').fill('São Paulo');
      await page.getByLabel('Fonte oficial (URL)').fill('https://congresso.exemplo.com.br');
      await page.getByRole('button', { name: 'Criar evento' }).click();
      await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Evento criado' }).first()).toBeVisible();
    };
    await criar('Evento futuro', '2099-12-01', '2099-12-02');
    await criar('Evento antigo', '2000-01-01', '2000-01-02');

    const proximos = page.getByRole('region', { name: 'Próximos' });
    const arquivo = page.getByRole('region', { name: 'Arquivo (encerrados)' });
    await expect(proximos.getByRole('row', { name: /Evento futuro/ })).toBeVisible();
    await expect(proximos.getByRole('row', { name: /Evento antigo/ })).toHaveCount(0);
    await expect(arquivo.getByRole('row', { name: /Evento antigo/ })).toBeVisible();
  });

  test('moderação: rejeitar exige motivo; revisor aprova', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/agenda');
    await page.getByRole('button', { name: 'Rejeitar Evento futuro' }).click();
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'Informe o motivo da rejeição.' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Aprovar Evento futuro' }).click();
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Evento aprovado.' }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Evento futuro/ })).toContainText('aprovado');
    await expect(page.getByRole('button', { name: 'Criar evento' })).toHaveCount(0);
  });
});

test.describe('Home e menus', () => {
  test.describe.configure({ mode: 'serial' });

  test('mostra a ordem do blueprint; header e footer não saem do lugar nem se escondem', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus');
    const blocos = page.getByRole('list', { name: 'Blocos da home em ordem' }).getByRole('listitem');
    await expect(blocos).toHaveCount(13);
    await expect(blocos.nth(1)).toContainText('Logo, header e menu');
    await expect(blocos.nth(12)).toContainText('Footer');
    await expect(page.getByRole('button', { name: 'Subir Logo, header e menu' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ocultar Footer' })).toHaveCount(0);
    await expect(blocos.nth(2)).toContainText('reserva 1280×150');
    await expect(blocos.nth(10)).toContainText('reserva 1280×200');
  });

  test('editar é rascunho; salvar cria versão; reverter cria nova versão', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus');
    await page.getByRole('button', { name: 'Subir Destaques' }).click();
    await expect(page.getByText('Rascunho com alterações não salvas')).toBeVisible();
    await expect(page.getByText('Versão vigente: v1')).toBeVisible();
    const blocos = page.getByRole('list', { name: 'Blocos da home em ordem' }).getByRole('listitem');
    await expect(blocos.nth(2)).toContainText('Destaques');

    await page.getByRole('button', { name: 'Ocultar Banner topo' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Banner topo' })).toContainText('reserva 1280×150');
    await page.getByLabel('Nota da versão').fill('destaques antes do banner');
    await page.getByRole('button', { name: 'Salvar versão' }).click();
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Versão v2 salva.' }).first()).toBeVisible();
    await expect(page.getByText('Versão vigente: v2')).toBeVisible();

    await page.getByRole('button', { name: 'Reverter para v1' }).click();
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'nova versão v3' }).first()).toBeVisible();
    await expect(page.getByText('Versão vigente: v3')).toBeVisible();
    await expect(blocos.nth(2)).toContainText('Banner topo');
    await expect(page.getByText('rollback para v1')).toBeVisible();
    await expect(page.getByText(/v2 · [0-9a-f-]{36} · /)).toBeVisible();
  });

  test('item de menu com flag desligada não pode ficar visível', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor_chefe');
    await page.goto('/studio/home-menus');
    await page.getByRole('button', { name: 'Mostrar Market Data no menu' }).click();
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'portalMarketData' }).first()).toBeVisible();
    await page.getByLabel('Nota da versão').fill('tentativa');
    await page.getByRole('button', { name: 'Salvar versão' }).click();
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'flag portalMarketData, desligada' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Descartar rascunho' }).click();
    await expect(page.getByText('Rascunho descartado.')).toBeVisible();
  });

  test('editor sem chefia não acessa', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/home-menus');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  });
});

test.describe('SEO', () => {
  test.describe.configure({ mode: 'serial' });

  test('redirecionamentos válidos; recusa ciclo, rota canônica e domínio', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/seo');
    await expect(page.getByRole('heading', { name: 'Nenhum redirecionamento' })).toBeVisible();
    const criar = async (de: string, para: string) => {
      await page.getByLabel(/Origem \(caminho\)/).fill(de);
      await page.getByLabel(/Destino \(caminho\)/).fill(para);
      await page.getByRole('button', { name: 'Criar redirecionamento' }).click();
    };
    await criar('/noticia-antiga/', '/noticia/nova');
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Redirecionamento criado.' }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /noticia-antiga/ })).toContainText('301');

    await criar('/noticia/nova', '/noticia-antiga');
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'formaria um ciclo' }).first()).toBeVisible();
    await criar('/editoria/pontos', '/outra');
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'rota canônica ativa' }).first()).toBeVisible();
    await criar('https://x.com/a', '/b');
    await expect(page.locator('main .st-alert.err').filter({ hasText: 'Origem inválida' }).first()).toBeVisible();

    await criar('/noticia/nova', '/noticia/final');
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'Redirecionamento criado.' }).first()).toBeVisible();
    await expect(page.getByText(/Cadeias de redirecionamento/)).toContainText('/noticia-antiga → /noticia/nova → /noticia/final');

    await page.getByRole('button', { name: 'Remover redirecionamento de /noticia-antiga' }).click();
    await expect(page.locator('main .st-alert.ok').filter({ hasText: 'removido' }).first()).toBeVisible();
  });

  test('prévia do sitemap lista as dez editorias', async ({ page, context }) => {
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/seo');
    await expect(page.getByRole('list', { name: 'Rotas canônicas' }).getByText(/\/editoria\//)).toHaveCount(10);
    await expect(page.getByRole('button', { name: 'Criar redirecionamento' })).toHaveCount(0);
  });
});
