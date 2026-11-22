// Limite de tentativas de login (ADR-011, valores propostos): até 5 tentativas por janela de 15 min;
// a 5ª dispara bloqueio de 15 min, por conta (e-mail) e por IP. Estado no PostgreSQL (tabela auth_attempt).
//
// ATOMICIDADE: a tentativa é "pré-cobrada" ANTES de verificar a senha, dentro de uma transação com
// SELECT ... FOR UPDATE na linha do sujeito. N requisições simultâneas se serializam: só as 5 primeiras
// passam, as demais recebem bloqueio. Login correto devolve a cobrança (IP) ou zera a conta.
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from './types';

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

export type AttemptKind = 'conta' | 'ip' | 'form';
export type Acquire = { allowed: true } | { allowed: false; until: Date };

const where = (kind: AttemptKind, subject: string) =>
  and(eq(schema.authAttempt.kind, kind), eq(schema.authAttempt.subject, subject));

/** Reserva uma tentativa. Bloqueado: não consome nem estende o bloqueio. */
export async function acquireAttempt(db: Db, kind: AttemptKind, subject: string, now = new Date()): Promise<Acquire> {
  return db.transaction(async (tx) => {
    await tx.insert(schema.authAttempt).values({ kind, subject, failures: 0, windowStart: now }).onConflictDoNothing();
    const [row] = await tx.select().from(schema.authAttempt).where(where(kind, subject)).for('update');
    if (!row) throw new Error('auth_attempt ausente após upsert');
    if (row.lockedUntil && row.lockedUntil > now) return { allowed: false as const, until: row.lockedUntil };
    const fresh = row.lockedUntil !== null || now.getTime() - row.windowStart.getTime() > WINDOW_MS;
    const failures = (fresh ? 0 : row.failures) + 1;
    await tx
      .update(schema.authAttempt)
      .set({
        failures,
        windowStart: fresh ? now : row.windowStart,
        lockedUntil: failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS) : null,
      })
      .where(where(kind, subject));
    return { allowed: true as const };
  });
}

/** Devolve uma tentativa reservada (login correto no IP, ou requisição barrada pelo outro limite). Não desfaz bloqueio. */
export async function releaseAttempt(db: Db, kind: AttemptKind, subject: string): Promise<void> {
  await db
    .update(schema.authAttempt)
    .set({ failures: sql`GREATEST(${schema.authAttempt.failures} - 1, 0)` })
    .where(and(where(kind, subject), sql`${schema.authAttempt.lockedUntil} IS NULL`));
}

/** Login correto zera o contador da conta. */
export async function resetAccount(db: Db, email: string): Promise<void> {
  await db.delete(schema.authAttempt).where(where('conta', email));
}

/** Diagnóstico/testes: até quando o sujeito está bloqueado (sem reservar tentativa). */
export async function blockedUntil(db: Db, kind: AttemptKind, subject: string, now = new Date()): Promise<Date | null> {
  const [row] = await db.select().from(schema.authAttempt).where(where(kind, subject));
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}
