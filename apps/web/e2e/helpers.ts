import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

/**
 * Login REAL de teste (Better Auth + TOTP) contra o backend de e2e em PGlite: a rota /api/e2e/login só existe no build de e2e
 * e devolve os cookies de sessão para o contexto do navegador. `roles` aceita um único papel do RBAC; `mfa=false` entra só com senha.
 * Cada par (usuário, papel) é um usuário distinto; o mesmo par reaproveita a conta.
 */
export async function entrar(context: BrowserContext, userId: string, roles: string, mfa = true): Promise<void> {
  await context.clearCookies();
  const role = roles.split('+')[0]!;
  const r = await context.request.get(`/api/e2e/login?user=${encodeURIComponent(userId)}&role=${encodeURIComponent(role)}&mfa=${mfa ? 1 : 0}`);
  expect(r.ok(), `login de teste ${userId}/${role}: ${r.status()}`).toBe(true);
}

/** Chamada às rotas reais da API com a sessão do contexto (para preparar dados de teste). */
export async function api(context: BrowserContext, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) {
  const r = await context.request.fetch(path, { method, ...(body !== undefined ? { data: body } : {}) });
  return { status: r.status(), body: await r.json().catch(() => null) };
}

/** Semeia uma matéria da Fábrica editorial no banco de e2e (rota só existe no build de e2e). */
export async function semearFabrica(context: BrowserContext): Promise<string> {
  const r = await context.request.get('/api/e2e/login?seed=editorial');
  expect(r.ok(), `seed da Fábrica: ${r.status()}`).toBe(true);
  return ((await r.json()) as { articleId: string }).articleId;
}

/**
 * Clica num botão de envio e espera o servidor responder e a tela assentar. Formulários com server action (React renderiza
 * action="javascript:...") esperam a resposta do POST; formulários GET (filtros) esperam a navegação. Sem isso, o próximo
 * `fill` pode correr com o re-render e ser apagado (o formulário é remontado após o redirect).
 */
export async function enviar(page: Page, botao: Locator): Promise<void> {
  const acao = await botao.evaluate((el) => el.closest('form')?.getAttribute('action') ?? '');
  if (acao.startsWith('javascript')) {
    await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), botao.click()]);
    await page.waitForTimeout(400); // o RSC do redirect é aplicado logo após a resposta
  } else {
    await Promise.all([page.waitForLoadState('load'), botao.click()]);
  }
}

/** Semeia uma matéria da Fábrica APROVADA (pronta para recibo e publicação oficiais) e devolve o rascunho dela (rota só existe no build de e2e). */
export async function semearFabricaAprovada(context: BrowserContext): Promise<{ articleId: string; draft: Record<string, unknown> }> {
  const r = await context.request.get('/api/e2e/login?seed=editorial-aprovada');
  expect(r.ok(), `seed da Fábrica aprovada: ${r.status()}`).toBe(true);
  return (await r.json()) as { articleId: string; draft: Record<string, unknown> };
}

/** Liga/desliga uma flag no backend de e2e (rota só existe no build de e2e). */
export async function definirFlag(context: BrowserContext, nome: string, ligada: boolean): Promise<void> {
  const r = await context.request.get(`/api/e2e/login?flag=${encodeURIComponent(nome)}&on=${ligada ? 1 : 0}`);
  expect(r.ok(), `flag ${nome}: ${r.status()}`).toBe(true);
}

/** Abre todos os grupos recolhíveis do menu lateral do Studio (só o grupo da tela atual abre sozinho). */
export async function abrirTodosOsGrupos(page: Page): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Módulos do Studio' });
  const botoes = nav.locator('button[aria-expanded="false"]');
  while ((await botoes.count()) > 0) await botoes.first().click();
}
