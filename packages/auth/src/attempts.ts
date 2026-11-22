// Limite de tentativas de login (ADR-011, valores propostos): 5 falhas em 15 min bloqueiam por 15 min,
// por conta (e-mail) e por IP. Estado no PostgreSQL (tabela auth_attempt), sem Redis no caminho do login.
import { and, eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from './types';

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

export type AttemptKind = 'conta' | 'ip';

const where = (kind: AttemptKind, subject: string) =>
  and(eq(schema.authAttempt.kind, kind), eq(schema.authAttempt.subject, subject));

/** Data até quando o sujeito está bloqueado, ou null se livre. */
export async function blockedUntil(db: Db, kind: AttemptKind, subject: string, now = new Date()): Promise<Date | null> {
  const [row] = await db.select().from(schema.authAttempt).where(where(kind, subject));
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}

/** Registra uma falha. Falhas durante o bloqueio não o estendem. */
export async function recordFailure(db: Db, kind: AttemptKind, subject: string, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.authAttempt)
      .values({ kind, subject, failures: 0, windowStart: now })
      .onConflictDoNothing();
    const [row] = await tx.select().from(schema.authAttempt).where(where(kind, subject)).for('update');
    if (!row) return;
    if (row.lockedUntil && row.lockedUntil > now) return;
    const expired =
      now.getTime() - row.windowStart.getTime() > WINDOW_MS || (row.lockedUntil !== null && row.lockedUntil <= now);
    const failures = expired ? 1 : row.failures + 1;
    await tx
      .update(schema.authAttempt)
      .set({
        failures,
        windowStart: expired ? now : row.windowStart,
        lockedUntil: failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS) : null,
      })
      .where(where(kind, subject));
  });
}

/** Login bem-sucedido zera o contador da conta (o do IP segue a janela dele). */
export async function resetAccount(db: Db, email: string): Promise<void> {
  await db.delete(schema.authAttempt).where(where('conta', email));
}
