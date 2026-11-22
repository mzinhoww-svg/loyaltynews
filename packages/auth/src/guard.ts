import { can, isRole, type Action, type Resource, type Role } from './rbac';
import type { Auth } from './server';

export interface Session {
  userId: string;
  email: string;
  /** Papel único do usuário (RBAC). */
  role: Role;
  /** Compatível com o stub do scaffold. */
  roles: readonly Role[];
  /** true só quando o usuário tem o 2º fator (TOTP) ativo; sem ele toda rota de admin nega. */
  mfa: boolean;
  sessionId: string;
}

export class AccessDeniedError extends Error {
  constructor(public readonly reason: 'NO_SESSION' | 'NO_MFA' | 'FORBIDDEN') {
    super(`acesso negado: ${reason}`);
    this.name = 'AccessDeniedError';
  }
}

/**
 * Sessão válida a partir dos cabeçalhos (cookie). Sessão revogada, expirada, usuário banido ou
 * papel desconhecido: null. Sem cookie cache: a revogação vale na requisição seguinte.
 */
export async function sessionFromHeaders(auth: Auth, headers: Headers): Promise<Session | null> {
  let res;
  try {
    res = await auth.api.getSession({ headers });
  } catch {
    return null;
  }
  if (!res) return null;
  const u = res.user as { id: string; email: string; role?: unknown; banned?: boolean; twoFactorEnabled?: boolean };
  if (u.banned === true || !isRole(u.role)) return null;
  return {
    userId: u.id,
    email: u.email,
    role: u.role,
    roles: [u.role],
    mfa: u.twoFactorEnabled === true,
    sessionId: res.session.id,
  };
}

/** Exige sessão com MFA e permissão (RBAC) para a ação. Nega por padrão. */
export async function authorize(auth: Auth, headers: Headers, resource: Resource, action: Action): Promise<Session> {
  const session = await sessionFromHeaders(auth, headers);
  if (!session) throw new AccessDeniedError('NO_SESSION');
  if (!session.mfa) throw new AccessDeniedError('NO_MFA');
  if (!can(session.role, resource, action)) throw new AccessDeniedError('FORBIDDEN');
  return session;
}

/** Exige sessão com MFA e um dos papéis. */
export async function requireRoleWith(auth: Auth, headers: Headers, allowed: readonly Role[]): Promise<Session> {
  const session = await sessionFromHeaders(auth, headers);
  if (!session) throw new AccessDeniedError('NO_SESSION');
  if (!session.mfa) throw new AccessDeniedError('NO_MFA');
  if (!allowed.includes(session.role)) throw new AccessDeniedError('FORBIDDEN');
  return session;
}
