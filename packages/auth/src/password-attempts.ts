// Contador ÚNICO de senha errada com sessão aberta (sujeitos `senha:<userId>` e `senha:<ip>`): vale para a troca da própria senha
// (change-password.ts) e para as rotas do 2º fator que conferem a senha (/two-factor/enable, /disable, /get-totp-uri,
// /generate-backup-codes, em handler.ts). Sem ele, com uma sessão roubada, essas rotas viram oráculo da senha atual (o Better Auth
// só tem limite em memória, ~1000/h). Mesmos parâmetros do sign-in: 5 erros por 15 min, bloqueio de 15 min; pré-cobrado e atômico.
import { acquireAttempt, releaseAttempt, resetAccount, type Acquire } from './attempts';
import type { Db } from './types';

export interface PasswordCharge {
  userSubject: string | null;
  ipSubject: string | null;
}

export type PasswordGate = { allowed: true; charge: PasswordCharge } | { allowed: false; until: Date; retryAfter: number };

export const passwordSubjects = (userId: string | null, ip: string | null): PasswordCharge => ({
  userSubject: userId ? `senha:${userId}` : null,
  ipSubject: ip ? `senha:${ip}` : null,
});

/** Reserva uma tentativa ANTES de conferir a senha. Bloqueado: devolve o que reservou e diz até quando. */
export async function chargePasswordAttempt(db: Db, userId: string | null, ip: string | null, t: Date): Promise<PasswordGate> {
  const charge = passwordSubjects(userId, ip);
  const byUser: Acquire = charge.userSubject ? await acquireAttempt(db, 'conta', charge.userSubject, t) : { allowed: true };
  const byIp: Acquire = charge.ipSubject ? await acquireAttempt(db, 'ip', charge.ipSubject, t) : { allowed: true };
  if (byUser.allowed && byIp.allowed) return { allowed: true, charge };
  if (byUser.allowed && charge.userSubject) await releaseAttempt(db, 'conta', charge.userSubject);
  if (byIp.allowed && charge.ipSubject) await releaseAttempt(db, 'ip', charge.ipSubject);
  const until = !byUser.allowed ? byUser.until : (byIp as { until: Date }).until;
  return { allowed: false, until, retryAfter: Math.max(1, Math.ceil((until.getTime() - t.getTime()) / 1000)) };
}

/** Senha certa: zera o usuário e devolve a reserva do IP. */
export async function passwordOk(db: Db, c: PasswordCharge): Promise<void> {
  if (c.userSubject) await resetAccount(db, c.userSubject);
  if (c.ipSubject) await releaseAttempt(db, 'ip', c.ipSubject);
}

/** Resultado que não foi senha errada (erro de outra natureza): devolve as duas reservas. */
export async function passwordNotChecked(db: Db, c: PasswordCharge): Promise<void> {
  if (c.userSubject) await releaseAttempt(db, 'conta', c.userSubject);
  if (c.ipSubject) await releaseAttempt(db, 'ip', c.ipSubject);
}
