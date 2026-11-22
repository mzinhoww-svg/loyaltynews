// @ln/auth — autenticação do LN Studio (ADR-011). Dono: Frente 02 — LN Backend Engineer.
// STUB do scaffold (fast-track): nega por padrão. A implementação real substitui este arquivo.

/** Papéis propostos pela Frente 02 (lista oficial a confirmar pelo dono). */
export const ROLES = ['admin', 'editor_chefe', 'editor', 'revisor', 'comercial', 'leitor'] as const;
export type Role = (typeof ROLES)[number];

export interface Session {
  userId: string;
  roles: readonly Role[];
  mfa: boolean;
}

export class AccessDeniedError extends Error {
  constructor(public readonly reason: 'NO_SESSION' | 'NO_MFA' | 'FORBIDDEN') {
    super(`acesso negado: ${reason}`);
    this.name = 'AccessDeniedError';
  }
}

/** Stub: não há sessão até a implementação real existir. */
export async function getSession(_request?: Request): Promise<Session | null> {
  return null;
}

/** Exige sessão com MFA e um dos papéis. Sem sessão, nega (padrão seguro). */
export async function requireRole(allowed: readonly Role[], request?: Request): Promise<Session> {
  const session = await getSession(request);
  if (!session) throw new AccessDeniedError('NO_SESSION');
  if (!session.mfa) throw new AccessDeniedError('NO_MFA');
  if (!session.roles.some((r) => allowed.includes(r))) throw new AccessDeniedError('FORBIDDEN');
  return session;
}
