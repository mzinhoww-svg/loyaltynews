import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const BASE = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;

async function entrar(context: BrowserContext, userId: string, roles: string, mfa = true) {
  await context.clearCookies();
  await context.addCookies([{ name: 'ln-test-session', value: `${userId}:${roles}${mfa ? '' : ':nomfa'}`, url: BASE }]);
}

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
  ['watchlists', 'Watchlists'],
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
const IMPLEMENTADOS = ['cms', 'fontes', 'agenda', 'home-menus', 'seo', 'midia', 'social'];

test.describe('proteção de rota (negar por padrão)', () => {
  for (const rota of ['/studio', '/studio/cms', '/studio/cms/nova', '/studio/cms/checagem', '/studio/fontes', '/studio/finops', '/studio/nao-existe']) {
    test(`sem sessão ${rota} vai para acesso restrito`, async ({ page }) => {
      await page.goto(rota);
      await expect(page).toHaveURL(/\/studio\/entrar\?motivo=NO_SESSION/);
      await expect(page.getByRole('heading', { level: 1, name: 'Acesso restrito' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Módulos do Studio' })).toHaveCount(0);
    });
  }

  test('cookie com papel inexistente não vale como sessão', async ({ page, context }) => {
    await entrar(context, 'x', 'superuser');
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
  test('admin vê os 25 módulos, o aviso MOCK de sessão e abre cada um com estado vazio honesto', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio');
    await expect(page.getByRole('heading', { level: 1, name: 'LN Studio' })).toBeVisible();
    await expect(page.getByText('MOCK · sessão de teste simulada')).toBeVisible();
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

  test('flag desligada aparece no módulo', async ({ page, context }) => {
    await entrar(context, 'ana', 'admin');
    await page.goto('/studio/social');
    await expect(page.getByText('desligada', { exact: false }).first()).toBeVisible();
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

async function preencherValida(page: Page, titulo: string) {
  await page.getByLabel('Título', { exact: true }).fill(titulo);
  await page.getByLabel('Editoria', { exact: true }).selectOption('pontos');
  await page.getByLabel('Corpo da matéria', { exact: true }).fill('Texto completo da matéria de teste.');
}

test.describe('CMS editorial', () => {
  test.describe.configure({ mode: 'serial' });
  test('fila começa vazia, sem matéria fictícia', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/cms');
    await expect(page.getByRole('heading', { name: 'Nenhuma matéria ainda' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Criar a primeira matéria' })).toBeVisible();
    await page.goto('/studio/cms/checagem');
    await expect(page.getByRole('heading', { name: 'Nenhuma matéria aguardando checagem' })).toBeVisible();
  });

  test('validação do editor aponta os campos', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/cms/nova');
    await page.getByRole('button', { name: 'Criar rascunho' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Título obrigatório' }).first()).toBeVisible();
  });

  test('criar, bloquear envio sem fonte, nova versão, checagem, quatro olhos e aprovação', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/cms/nova');
    await preencherValida(page, 'Programa Alfa muda regra de pontos');
    await page.getByRole('button', { name: 'Criar rascunho' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Programa Alfa muda regra de pontos' })).toBeVisible();
    await expect(page.getByText('Rascunho criado (v1).')).toBeVisible();
    await expect(page.getByText('assinatura Redação Loyalty News')).toBeVisible();

    // sem fonte: a checagem automática bloqueia o envio
    await expect(page.getByText('Matéria sem fonte verificável')).toBeVisible();
    await page.getByRole('button', { name: 'Enviar para checagem' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'checagem automática encontrou bloqueios' })).toBeVisible();

    // adiciona fonte e imagem com base de direito: nova versão, v1 preservada
    await page.getByLabel('Fonte 1: nome', { exact: true }).fill('Comunicado oficial');
    await page.getByLabel('Fonte 1: URL', { exact: true }).fill('https://exemplo.com.br/comunicado');
    await page.getByLabel('URL da imagem', { exact: true }).fill('https://exemplo.com.br/capa.jpg');
    await page.getByLabel('Base de direito', { exact: true }).selectOption('propria');
    await page.getByLabel('Crédito', { exact: true }).fill('Redação Loyalty News');
    await page.getByLabel('Texto alternativo', { exact: true }).fill('Cartão de fidelidade');
    await page.getByLabel(/Nota da versão/).fill('fonte e imagem');
    await page.getByRole('button', { name: 'Salvar como nova versão' }).click();
    await expect(page.getByText('Nova versão v2 salva.')).toBeVisible();
    await expect(page.getByText(/v1 · ana/)).toBeVisible();
    await expect(page.getByText(/v2 · ana/)).toBeVisible();

    await page.getByRole('button', { name: 'Enviar para checagem' }).click();
    await expect(page.getByText('Enviada para a fila de checagem.')).toBeVisible();
    await expect(page.locator('.ln-pill', { hasText: 'Em checagem' }).first()).toBeVisible();

    // o autor não aprova a própria versão
    await expect(page.getByRole('button', { name: 'Aprovar v2' })).toHaveCount(0); // editor puro não revisa
    await entrar(context, 'ana', 'editor+revisor');
    await page.goto('/studio/cms/checagem');
    await expect(page.getByRole('link', { name: 'Programa Alfa muda regra de pontos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aprovar v2' })).toBeDisabled(); // autora com papel de revisor ainda não aprova a própria versão

    // revisor diferente aprova a versão vigente
    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/cms/checagem');
    await page.getByRole('button', { name: 'Aprovar v2' }).click();
    await expect(page.getByText('Versão v2 aprovada por rui.')).toBeVisible();
    await expect(page.locator('.ln-pill', { hasText: 'Aprovado' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publicar' })).toBeDisabled();
    await expect(page.getByText('Publicar não está disponível')).toBeVisible();
    await expect(page.getByText(/rui · aprovada/)).toBeVisible();

    // revisor não edita (somente leitura)
    await expect(page.getByRole('button', { name: 'Salvar como nova versão' })).toHaveCount(0);
  });

  test('editar matéria aprovada invalida a aprovação', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/cms?q=alfa');
    await page.getByRole('link', { name: 'Programa Alfa muda regra de pontos' }).click();
    await page.getByLabel('Corpo da matéria', { exact: true }).fill('Texto revisado depois da aprovação.');
    await page.getByRole('button', { name: 'Salvar como nova versão' }).click();
    await expect(page.getByText('Nova versão v3 salva.')).toBeVisible();
    await expect(page.locator('.ln-pill', { hasText: 'Rascunho' }).first()).toBeVisible();
  });

  test('imagem sem base de direito e conteúdo pago sem rótulo bloqueiam a checagem; bloqueio exige motivo', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/cms/nova');
    await preencherValida(page, 'Matéria Beta com pendências');
    await page.getByLabel('Fonte 1: nome', { exact: true }).fill('Fonte B');
    await page.getByLabel('Fonte 1: URL', { exact: true }).fill('https://exemplo.com.br/b');
    await page.getByLabel('URL da imagem', { exact: true }).fill('https://exemplo.com.br/b.jpg');
    await page.getByLabel('Crédito', { exact: true }).fill('Agência');
    await page.getByLabel('Texto alternativo', { exact: true }).fill('Alt');
    await page.getByLabel('Conteúdo patrocinado', { exact: true }).check();
    await page.getByRole('button', { name: 'Criar rascunho' }).click();
    await expect(page.getByText('Imagem sem base de direito demonstrável')).toBeVisible();
    await expect(page.getByText('Conteúdo pago exige rótulo publieditorial')).toBeVisible();

    await page.getByLabel('Base de direito', { exact: true }).selectOption('licenca');
    await page.getByLabel('Rótulo publieditorial', { exact: true }).fill('Conteúdo patrocinado');
    await page.getByRole('button', { name: 'Salvar como nova versão' }).click();
    await page.getByRole('button', { name: 'Enviar para checagem' }).click();
    await expect(page.getByText('Enviada para a fila de checagem.')).toBeVisible();

    await entrar(context, 'rui', 'revisor');
    await page.goto('/studio/cms/checagem');
    await page.getByRole('button', { name: 'Bloquear' }).click();
    await expect(page.getByText('Informe o motivo do bloqueio.')).toBeVisible();
    await page.getByLabel('Motivo do bloqueio', { exact: true }).fill('Fonte não confirma o número');
    await page.getByRole('button', { name: 'Bloquear' }).click();
    await expect(page.getByText('Matéria bloqueada.')).toBeVisible();
    await expect(page.getByText('Bloqueada: Fonte não confirma o número')).toBeVisible();
  });

  test('filtros da fila por estado, editoria e busca', async ({ page, context }) => {
    await entrar(context, 'ana', 'editor');
    await page.goto('/studio/cms?status=bloqueado');
    await expect(page.getByRole('link', { name: 'Matéria Beta com pendências' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Programa Alfa muda regra de pontos' })).toHaveCount(0);
    await page.goto('/studio/cms?editoria=mercado');
    await expect(page.getByRole('heading', { name: 'Nenhuma matéria com esses filtros' })).toBeVisible();
    await page.goto('/studio/cms');
    await page.getByLabel('Buscar no título').fill('alfa');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page.getByRole('link', { name: 'Programa Alfa muda regra de pontos' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Matéria Beta com pendências' })).toHaveCount(0);
  });
});
