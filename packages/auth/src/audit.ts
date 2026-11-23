import { randomUUID } from 'node:crypto';
import { schema } from '@ln/db';
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

export async function audit(db: Db, e: AuditEntry): Promise<void> {
  await db.insert(schema.auditLog).values({
    id: randomUUID(),
    at: e.at ?? new Date(),
    actorId: e.actorId ?? null,
    actorRole: e.actorRole ?? null,
    action: e.action,
    resource: e.resource,
    resourceId: e.resourceId ?? null,
    ip: e.ip ?? null,
    detalhe: e.detalhe === undefined ? null : redact(e.detalhe),
  });
}
