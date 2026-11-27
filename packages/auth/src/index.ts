// @ln/auth — autenticação do LN Studio (ADR-011). Dono: Frente 02 — LN Backend Engineer.
// Better Auth (ver DECISAO.md). API compatível com o stub do scaffold: getSession / requireRole / AccessDeniedError.
import { AccessDeniedError, requireRoleWith, sessionFromHeaders, type Session } from './guard';
import { getRuntime } from './runtime';
import type { Role } from './rbac';

export * from './rbac';
export * from './guard';
export * from './attempts';
export { audit, redact, sanitizeAuditRow, EMAIL_REMOVIDO, CONTATO_REMOVIDO, VALOR_INVALIDO, type AuditEntry, type AuditRow } from './audit';
export { createAuth, createStaffUser, type Auth, type CreateAuthOptions, type NewStaffUser } from './server';
export { createAuthHandler } from './handler';
export { changeOwnPassword, validarNovaSenha, SENHA_MIN, SENHA_MAX, CHANGE_PASSWORD_ACTION, type ChangeOwnPasswordInput, type ChangeOwnPasswordDeps, type ChangeOwnPasswordResult, type ChangeOwnPasswordCode } from './change-password';
export { clientIp, normalizeIp, trustedProxyHops } from './client-ip';
export type { Db } from './types';

async function headersOf(request?: Request): Promise<Headers | null> {
  if (request) return request.headers;
  try {
    // Server Components e route handlers do Next: cabeçalhos da requisição corrente.
    const { headers } = await import('next/headers');
    return await headers();
  } catch {
    return null;
  }
}

/** Sessão corrente (cookie) ou null. Sem configuração de ambiente, sempre null. */
export async function getSession(request?: Request): Promise<Session | null> {
  const rt = getRuntime();
  const h = await headersOf(request);
  if (!rt || !h) return null;
  return sessionFromHeaders(rt.auth, h);
}

/** Exige sessão com MFA e um dos papéis; nega por padrão. */
export async function requireRole(allowed: readonly Role[], request?: Request): Promise<Session> {
  const rt = getRuntime();
  const h = await headersOf(request);
  if (!rt || !h) throw new AccessDeniedError('NO_SESSION');
  return requireRoleWith(rt.auth, h, allowed);
}
export { bootstrapStagingAdmin, assertStagingEmail, STAGING_ADMIN_DEFAULT_EMAIL, type StagingAdminResult, type StagingAdminDeps, type StagingAdminOptions } from './staging-admin';
export { bootstrapProductionAdmin, revokeProductionAdmin, revokeIncompleteMessage, validateProdEmail, PROD_ADMIN_REVOKE_PHRASE, PROD_ADMIN_CONFIRM_PHRASE, PROD_ADMIN_SAVED_WORD, PROD_ADMIN_MIN_PASSWORD, PROD_ADMIN_MAX_TRIES, type ProdAdminIO, type ProdAdminDeps, type ProdAdminResult, type ProdAdminRevokeResult } from './prod-admin';
