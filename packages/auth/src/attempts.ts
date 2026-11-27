// PRIVACIDADE (LGPD): o banco NUNCA guarda o IP nem o e-mail em claro. Toda linha é indexada por um HMAC-SHA256 de kind + NUL + sujeito (h1:<hex>), calculado AQUI,
// em um só lugar (acquire, release, reset, blockedUntil, clearAttempts): os chamadores continuam passando o valor lógico (IP, senha:<ip>, agenda:<ip>, e-mail,
// 2fa:<userId>) e nenhum caminho novo consegue gravar cru. Chave: 32 bytes derivados por HKDF-SHA256 de LN_ATTEMPT_HMAC_KEY (>= 32 bytes) ou, na falta, de
// BETTER_AUTH_SECRET (info ln:auth_attempt:v1). Sem chave em ambiente de deploy (staging/production/homologacao/producao ou NODE_ENV=production): erro (falha fechada); fora deles (teste/dev): chave aleatória do processo. SHA-256 sem
// chave não serve (o espaço IPv4 se inverte em minutos). Trocar a chave zera, na prática, os contadores em curso (sujeitos novos). Nada aqui é logado.
// Limite de tentativas de login (ADR-011, valores propostos): até 5 tentativas por janela de 15 min;
// a 5ª dispara bloqueio de 15 min, por conta (e-mail) e por IP. Estado no PostgreSQL (tabela auth_attempt).
//
// ATOMICIDADE: a tentativa é "pré-cobrada" ANTES de verificar a senha, dentro de uma transação com
// SELECT ... FOR UPDATE na linha do sujeito. N requisições simultâneas se serializam: só as 5 primeiras
// passam, as demais recebem bloqueio. Login correto devolve a cobrança (IP) ou zera a conta.
import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import { normalizeIp } from './client-ip';
import type { Db } from './types';

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

export type AttemptKind = 'conta' | 'ip' | 'form';
export type Acquire = { allowed: true } | { allowed: false; until: Date };

export const ATTEMPT_TAG = 'h1:';
const HKDF_INFO = 'ln:auth_attempt:v1';
const MIN_KEY_BYTES = 32;
const DEPLOY_ENVS: ReadonlySet<string> = new Set(['staging', 'production', 'homologacao', 'producao']);
const derived = new Map<string, Buffer>();
let ephemeral: Buffer | undefined;

/** Chave HMAC (32 bytes). Lança, sem citar valor algum, se não há segredo utilizável em ambiente de deploy ou se LN_ATTEMPT_HMAC_KEY está curta. */
export function attemptKey(env: Record<string, string | undefined> = process.env): Buffer {
  const own = env.LN_ATTEMPT_HMAC_KEY;
  if (own !== undefined && own !== '' && Buffer.byteLength(own) < MIN_KEY_BYTES) throw new Error(`LN_ATTEMPT_HMAC_KEY curta: mínimo de ${MIN_KEY_BYTES} bytes`);
  const auth = env.BETTER_AUTH_SECRET && Buffer.byteLength(env.BETTER_AUTH_SECRET) >= MIN_KEY_BYTES ? env.BETTER_AUTH_SECRET : undefined;
  const secret = own ? own : auth;
  if (secret) {
    let k = derived.get(secret);
    if (!k) {
      k = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), HKDF_INFO, 32));
      derived.set(secret, k);
    }
    return k;
  }
  // qualquer ambiente de DEPLOY (staging, produção e as grafias em português) falha fechada: um worker ou CLI sem NODE_ENV não cai numa chave efêmera por processo
  if (DEPLOY_ENVS.has((env.APP_ENV ?? '').trim().toLowerCase()) || env.NODE_ENV === 'production') {
    throw new Error('chave do limite de tentativas ausente: defina BETTER_AUTH_SECRET (>= 32 bytes) ou LN_ATTEMPT_HMAC_KEY');
  }
  ephemeral ??= randomBytes(32);
  return ephemeral;
}

/** O que vai ao banco no lugar do sujeito: HMAC de kind, NUL e sujeito (em minúsculas e sem espaços, como o e-mail sempre foi). */
export function attemptSubject(kind: AttemptKind, subject: string, env: Record<string, string | undefined> = process.env): string {
  return ATTEMPT_TAG + createHmac('sha256', attemptKey(env)).update(`${kind}\0${subject.trim().toLowerCase()}`).digest('hex');
}

/**
 * IP de AUDITORIA pseudonimizado (audit_log é append-only: não dá para apagar depois, então o IP cru nunca entra). HMAC com a mesma chave e domínio próprio
 * ('audit-ip', diferente do limite): o mesmo IP gera sempre o mesmo código (dá para correlacionar eventos e investigar abuso), mas não se volta ao IP sem a chave.
 * Entrada que não é IP, ou sem chave utilizável: null (nunca o valor cru, e a auditoria não falha por causa disso).
 */
export function auditIp(ip: string | null | undefined, env: Record<string, string | undefined> = process.env): string | null {
  if (!ip) return null;
  const v = normalizeIp(ip);
  if (!v) return null;
  try {
    return ATTEMPT_TAG + createHmac('sha256', attemptKey(env)).update(`audit-ip\0${v}`).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Código de AUDITORIA do e-mail digitado no login (audit_log é append-only: o e-mail em claro nunca entra). Mesma chave do limite, domínio próprio ('audit-email'):
 * o mesmo endereço gera sempre o mesmo código, então dá para seguir as tentativas de uma conta a partir do e-mail, mas não voltar ao e-mail sem a chave.
 * Vale para qualquer texto digitado no campo (inclusive uma senha colada ali por engano). Vazio ou sem chave utilizável: null, nunca o valor cru.
 */
export function auditEmail(email: string | null | undefined, env: Record<string, string | undefined> = process.env): string | null {
  const v = (email ?? '').trim().toLowerCase();
  if (!v) return null;
  try {
    return ATTEMPT_TAG + createHmac('sha256', attemptKey(env)).update(`audit-email\0${v}`).digest('hex');
  } catch {
    return null;
  }
}

const where = (kind: AttemptKind, subject: string) =>
  and(eq(schema.authAttempt.kind, kind), eq(schema.authAttempt.subject, attemptSubject(kind, subject)));

/** Reserva uma tentativa. Bloqueado: não consome nem estende o bloqueio. */
export async function acquireAttempt(db: Db, kind: AttemptKind, subject: string, now = new Date(), max = MAX_FAILURES): Promise<Acquire> {
  return db.transaction(async (tx) => {
    await tx.insert(schema.authAttempt).values({ kind, subject: attemptSubject(kind, subject), failures: 0, windowStart: now }).onConflictDoNothing();
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
        lockedUntil: failures >= max ? new Date(now.getTime() + LOCK_MS) : null,
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

/**
 * Apaga as linhas (desbloqueio e limpeza de quem foi removido): o chamador passa os valores LÓGICOS (e-mail, 2fa:<userId>), nunca o hash. env permite à CLI passar
 * o ambiente dela. Sem chave, lança (a CLI decide se isso é fatal).
 */
export async function clearAttempts(db: Db, entries: ReadonlyArray<{ kind: AttemptKind; subject: string }>, env: Record<string, string | undefined> = process.env): Promise<number> {
  let n = 0;
  for (const e of entries) {
    const r = await db
      .delete(schema.authAttempt)
      .where(and(eq(schema.authAttempt.kind, e.kind), eq(schema.authAttempt.subject, attemptSubject(e.kind, e.subject, env))))
      .returning({ k: schema.authAttempt.kind });
    n += r.length;
  }
  return n;
}

/** Retenção (LGPD, minimização): janela iniciada há mais de 24 h. */
export const ATTEMPT_RETENTION_MS = 24 * 3_600_000;

/**
 * Apaga as linhas sem bloqueio vigente cuja janela começou há mais de retentionMs (24 h; o limite só precisa de 15 min). Linha com bloqueio ainda vigente
 * NUNCA é apagada aqui (não solta quem está bloqueado). Devolve quantas apagou.
 */
export async function purgeStaleAttempts(db: Db, now = new Date(), retentionMs = ATTEMPT_RETENTION_MS): Promise<number> {
  const t = schema.authAttempt;
  const r = await db
    .delete(t)
    .where(and(sql`${t.windowStart} < ${new Date(now.getTime() - retentionMs)}`, sql`(${t.lockedUntil} IS NULL OR ${t.lockedUntil} < ${now})`))
    .returning({ k: t.kind });
  return r.length;
}
