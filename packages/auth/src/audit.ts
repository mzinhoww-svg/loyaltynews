import { randomUUID } from 'node:crypto';
import { schema } from '@ln/db';
import { auditIp } from './attempts';
import type { Db } from './types';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  ip?: string | null;
  detalhe?: unknown;
  at?: Date;
}

const SECRET_KEY = /pass|senha|secret|segredo|token|code|codigo|totp|cookie|authorization|backup/i;

/** Remove qualquer chave com cara de segredo, em qualquer profundidade (a auditoria nunca guarda segredo). */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[profundo]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[removido]' : redact(v, depth + 1)]),
    );
  }
  return value;
}

// Comprimentos limitados (RFC 5321) para a busca ficar linear mesmo com texto grande e hostil.
const EMAIL = /[\p{L}\p{N}._%+'-]{1,64}@(?:[\p{L}\p{N}-]{1,63}\.){1,8}\p{L}{2,63}/gu;
export const EMAIL_REMOVIDO = '[e-mail removido]';

/** Segunda barreira (LGPD): qualquer endereço de e-mail em texto, chave ou valor, em qualquer profundidade, sai antes de gravar. */
export function stripEmails(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.replace(EMAIL, EMAIL_REMOVIDO);
  if (depth > 6) return '[profundo]';
  if (Array.isArray(value)) return value.map((v) => stripEmails(v, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.replace(EMAIL, EMAIL_REMOVIDO), stripEmails(v, depth + 1)]));
  }
  return value;
}

const texto = (v: string | null | undefined): string | null => (v == null ? null : (stripEmails(v) as string));

export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    at: e.at ?? new Date(),
    actorId: texto(e.actorId),
    actorRole: e.actorRole ?? null,
    action: e.action,
    resource: e.resource,
    resourceId: texto(e.resourceId),
    ip: auditIp(e.ip), // LGPD: só o HMAC do IP (h1:<hex>); o log é append-only e o IP cru nunca entra
    detalhe: e.detalhe === undefined ? null : stripEmails(redact(e.detalhe)),
  });
}
