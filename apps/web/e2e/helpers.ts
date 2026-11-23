import { expect, type BrowserContext } from '@playwright/test';

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
