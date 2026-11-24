import { safeErr } from '@ln/db/safe-log';
import { can, isRole, type Action, type Resource, type Role } from './rbac';
import type { Auth } from './server';

/** Sessão no formato do stub do scaffold (o Studio constrói e consome este formato). */
export interface Session {
  userId: string;
  /** Compatível com o stub do scaffold. */
  roles: readonly Role[];
  /** true só quando o usuário tem o 2º fator (TOTP) ativo; sem ele toda rota de admin nega. */
  mfa: boolean;
  email?: string;
  /** Papel único do usuário (RBAC). */
  role?: Role;
  sessionId?: string;
}

/** Sessão devolvida pelo auth real: todos os campos presentes. */
export interface FullSession extends Session {
  email: string;
  role: Role;
  sessionId: string;
}

export class AccessDeniedError extends Error {
  constructor(public readonly reason: 'NO_SESSION' | 'NO_MFA' | 'FORBIDDEN') {
    super(`acesso negado: ${reason}`);
    this.name = 'AccessDeniedError';
  }
}

/** Falha de infraestrutura ao LER a sessão (banco, conexão, pool). Não é "sem sessão": quem chama mostra erro, nunca a tela de entrada. */
export class SessionLookupError extends Error {
  constructor() {
    super('Não foi possível conferir a sua sessão agora. Tente de novo em instantes.');
    this.name = 'SessionLookupError';
  }
}

/** Erro do Better Auth que SIGNIFICA sessão inválida (ex.: sessão apagada no meio da renovação: UNAUTHORIZED / FAILED_TO_GET_SESSION). */
function isNoSessionError(e: unknown): boolean {
  const x = e as { status?: unknown; statusCode?: unknown; body?: { code?: unknown } } | null;
  const code = x?.body?.code;
  return x?.status === 'UNAUTHORIZED' || x?.statusCode === 401 || code === 'UNAUTHORIZED' || code === 'FAILED_TO_GET_SESSION';
}

/**
 * Sessão válida a partir dos cabeçalhos (cookie). Sessão revogada, expirada, usuário banido ou
 * papel desconhecido: null. Sem cookie cache: a revogação vale na requisição seguinte.
 * Falha de banco/conexão: lança SessionLookupError (com log sem segredo). Antes ela virava null e a pessoa era mandada à
 * entrada como se tivesse sido deslogada, sem rastro (bug do staging int/024).
 */
export async function sessionFromHeaders(auth: Auth, headers: Headers, log: (line: string) => void = (l) => console.error(l)): Promise<FullSession | null> {
  let res;
  try {
    res = await auth.api.getSession({ headers });
  } catch (e) {
    if (isNoSessionError(e)) return null;
    const se = safeErr(e); // só classe e código: a mensagem de driver/rede pode trazer host ou URL
    log(`[auth] falha ao ler a sessão: ${se.name}${se.code ? ` [${se.code}]` : ''}`);
    throw new SessionLookupError();
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
export async function authorize(auth: Auth, headers: Headers, resource: Resource, action: Action): Promise<FullSession> {
  const session = await sessionFromHeaders(auth, headers);
  if (!session) throw new AccessDeniedError('NO_SESSION');
  if (!session.mfa) throw new AccessDeniedError('NO_MFA');
  if (!can(session.role, resource, action)) throw new AccessDeniedError('FORBIDDEN');
  return session;
}

/** Exige sessão com MFA e um dos papéis. */
export async function requireRoleWith(auth: Auth, headers: Headers, allowed: readonly Role[]): Promise<FullSession> {
  const session = await sessionFromHeaders(auth, headers);
  if (!session) throw new AccessDeniedError('NO_SESSION');
  if (!session.mfa) throw new AccessDeniedError('NO_MFA');
  if (!allowed.includes(session.role)) throw new AccessDeniedError('FORBIDDEN');
  return session;
}
