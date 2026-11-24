import { expect, test } from '@playwright/test';
import { entrar } from './helpers';

const MODULOS: Array<[string, string]> = [
  ['cms', 'CMS editorial'],
  ['fontes', 'Banco de fontes'],
  ['publicacoes', 'Publicações'],
  ['agenda', 'Agenda e eventos'],
  ['editorias', 'Editorias'],
  ['home-menus', 'Home e menus'],
  ['seo', 'SEO'],
  ['midia', 'Biblioteca de mídia'],
  ['social', 'Social dashboard'],
  ['creative', 'Creative studio'],
  ['entidades', 'Entity intelligence'],
  ['organogramas', 'Organogramas'],
  ['piloto', 'Leitura do piloto'],
  ['watchlists', 'Watchlists'],
  ['correcoes-titular', 'Pedidos do titular'],
  ['crm', 'CRM'],
  ['inventario', 'Inventário'],
  ['campanhas', 'Campanhas'],
  ['analytics', 'Analytics'],
  ['organizacao', 'Organização agêntica'],
  ['reunioes', 'Calendário de reuniões'],
  ['decisoes', 'Decisões e atas'],
  ['modelops', 'ModelOps'],
  ['finops', 'FinOps'],
  ['auditoria', 'Auditoria'],
  ['configuracoes', 'Configurações'],
  ['permissoes', 'Permissões'],
];

// Módulos com tela própria (os demais mostram o estado vazio genérico).
const IMPLEMENTADOS = ['cms', 'fontes', 'agenda', 'home-menus', 'seo', 'midia', 'social', 'creative', 'crm', 'inventario', 'campanhas', 'entidades', 'organogramas', 'watchlists', 'correcoes-titular', 'piloto', 'organizacao', 'reunioes', 'decisoes', 'modelops', 'finops', 'auditoria'];

test.describe('proteção de rota (negar por padrão)', () => {
  for (const rota of ['/studio', '/studio/cms', '/studio/cms/nova', '/studio/cms/checagem', '/studio/fontes', '/studio/finops', '/studio/nao-existe']) {
    test(`sem sessão ${rota} vai para acesso restrito`, async ({ page }) => {
      await page.goto(rota);
      await expect(page).toHaveURL(/\/studio\/entrar\?motivo=NO_SESSION/);
      await expect(page.getByRole('heading', { level: 1, name: 'Acesso restrito' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Módulos do Studio' })).toHaveCount(0);
    });
  }

  test('cookie de sessão forjado não vale: só a sessão real do Better Auth', async ({ page, context }) => {
    await context.addCookies([{ name: 'better-auth.session_token', value: 'forjado.assinatura', url: page.url() === 'about:blank' ? 'http://127.0.0.1:' + (process.env.E2E_PORT ?? 3100) : page.url() }]);
    await page.goto('/studio');
    await expect(page).toHaveURL(/NO_SESSION/);
  });

  test('sem MFA é negado', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin', false);
    await page.goto('/studio');
    await expect(page).toHaveURL(/motivo=NO_MFA/);
    await expect(page.getByRole('heading', { level: 1, name: /duas etapas/ })).toBeVisible();
  });

  test('papel sem permissão é negado no módulo', async ({ page, context }) => {
    await entrar(context, 'lia', 'leitor');
    await page.goto('/studio/finops');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sem permissão' })).toBeVisible();
    await page.goto('/studio/cms/nova');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  });
});

test.describe('shell e navegação', () => {
  test('admin vê os 27 módulos e abre cada um com estado vazio honesto', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio');
    await expect(page.getByRole('heading', { level: 1, name: 'LN Studio' })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Módulos do Studio' });
    for (const [, nome] of MODULOS) await expect(nav.getByRole('link', { name: nome })).toBeVisible();
    for (const [slug, nome] of MODULOS) {
      await page.goto(`/studio/${slug}`);
      await expect(page.getByRole('heading', { level: 1, name: nome })).toBeVisible();
      if (!IMPLEMENTADOS.includes(slug)) {
        await expect(page.getByRole('heading', { name: 'Nenhum dado disponível' })).toBeVisible();
        await expect(nav.getByRole('link', { name: nome })).toHaveAttribute('aria-current', 'page');
      }
    }
  });

  test('botão feito com link mantém o texto visível (cor do texto ≠ cor do fundo)', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/cms');
    const primario = page.getByRole('link', { name: 'Nova matéria' });
    const cores = await primario.evaluate((el) => ({ texto: getComputedStyle(el).color, fundo: getComputedStyle(el).backgroundColor }));
    expect(cores.texto).not.toBe(cores.fundo);
    expect(cores.texto).toBe('rgb(255, 255, 255)');
    const secundario = page.getByRole('link', { name: 'Fila de checagem' });
    const sec = await secundario.evaluate((el) => ({ texto: getComputedStyle(el).color, fundo: getComputedStyle(el).backgroundColor }));
    expect(sec.texto).not.toBe(sec.fundo);
  });

  test('título da tela tem altura de linha folgada (não encosta nos botões abaixo)', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/cms');
    const m = await page.locator('main h1').first().evaluate((el) => ({ linha: parseFloat(getComputedStyle(el).lineHeight), fonte: parseFloat(getComputedStyle(el).fontSize) }));
    expect(m.linha / m.fonte).toBeGreaterThanOrEqual(1.2);
  });

  // revisão visual P2-2: o usuário não vê nome de flag nem rótulo técnico; desligado e em uso não aparecem juntos
  test('painel, menu, CMS, fontes e entidades falam em português, sem nome de flag', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    for (const rota of ['/studio', '/studio/cms', '/studio/cms/checagem', '/studio/fontes', '/studio/fontes/fabrica', '/studio/entidades', '/studio/configuracoes', '/studio/permissoes']) {
      await page.goto(rota);
      await expect(page.locator('main h1').first()).toBeVisible();
      const texto = await page.locator('body').innerText();
      expect(texto, rota).not.toMatch(/\bflag\b|estado vazio/i);
    }
    await page.goto('/studio');
    await expect(page.locator('[data-estado-modulo="desligado"]').first()).toHaveText('Desligado nesta fase');
    await expect(page.locator('.st-card', { has: page.locator('[data-estado-modulo="desligado"]') }).getByText('Em uso')).toHaveCount(0);
    await expect(page.getByRole('navigation').getByText(/\(desligado nesta fase\)/).first()).toBeVisible();
  });

  test('flag desligada aparece no módulo', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/social');
    await expect(page.getByText('desligado nesta fase', { exact: false }).first()).toBeVisible();
    await page.goto('/studio/inexistente');
    await expect(page.getByRole('heading', { name: /404|not found|não encontrada/i }).first()).toBeVisible();
  });

  test('comercial só vê módulos comerciais', async ({ page, context }) => {
    await entrar(context, 'caio', 'comercial');
    await page.goto('/studio');
    const nav = page.getByRole('navigation', { name: 'Módulos do Studio' });
    await expect(nav.getByRole('link', { name: 'CRM' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'CMS editorial' })).toHaveCount(0);
    await page.goto('/studio/cms');
    await expect(page).toHaveURL(/motivo=FORBIDDEN/);
  });

  test('no celular o menu abre e fecha', async ({ page, context }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio');
    const nav = page.getByRole('navigation', { name: 'Módulos do Studio' });
    await expect(nav).toBeHidden();
    await page.getByRole('button', { name: 'Navegação' }).click();
    await expect(nav).toBeVisible();
  });
});
