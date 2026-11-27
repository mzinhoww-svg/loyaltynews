// Bootstrap do PRIMEIRO administrador de STAGING (nada disto vale para produção: o 1º admin de produção é cerimônia à parte, do Security).
// Cria UM administrador com e-mail de teste (domínio `.invalid`), senha inicial aleatória e TOTP já enrolado, passando pelo próprio Better Auth
// (mesmo caminho do testkit: criar → entrar → ativar o 2º fator → confirmar o código → conferir que o login completo funciona).
// Quem chama (CLI de staging) entrega o segredo SÓ no terminal de quem roda, uma vez. Esta função NUNCA grava a senha, o segredo do TOTP nem os
// códigos de recuperação em log, arquivo ou auditoria: eles só existem no objeto devolvido.
import { randomBytes } from 'node:crypto';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { eq } from 'drizzle-orm';
import { schema } from '@ln/db';
import { audit } from './audit';
import { createStaffUser, type Auth } from './server';
import type { Db } from './types';

export const STAGING_ADMIN_DEFAULT_EMAIL = 'admin.staging@loyaltynews.invalid';

export type StagingAdminResult =
  | { status: 'created'; email: string; password: string; totpSecret: string; totpUri: string; backupCodes: string[] }
  | { status: 'exists'; email: string }
  | { status: 'refused'; reason: string };

export interface StagingAdminDeps {
  db: Db;
  auth: Auth;
  handle: (request: Request) => Promise<Response>;
  /** Origem do Studio (BETTER_AUTH_URL): o handler confere o cabeçalho `origin`. */
  baseURL: string;
}

export interface StagingAdminOptions {
  email?: string;
  /** Vai para a auditoria (sem segredo): como o segredo foi entregue e o commit da CLI. */
  entrega?: 'tty' | 'arquivo';
  commit?: string | null;
  /** Apaga o administrador de staging existente (só ele) e cria de novo, com segredos novos. */
  recreate?: boolean;
  /** Só testes. */
  generatePassword?: () => string;
}

const randomPassword = () => randomBytes(24).toString('base64url'); // 32 caracteres, mínimo do Better Auth é 12

/** Só e-mail de teste: domínio `.invalid` (reservado pela RFC 2606, nunca entrega mensagem). Formato fixo da decisão de segurança (L3). */
export function assertStagingEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+\.invalid$/.test(e)) throw new Error('e-mail do administrador de staging precisa ser de domínio .invalid');
  return e;
}

export async function bootstrapStagingAdmin(deps: StagingAdminDeps, opts: StagingAdminOptions = {}): Promise<StagingAdminResult> {
  const email = assertStagingEmail(opts.email ?? STAGING_ADMIN_DEFAULT_EMAIL);
  const { db, auth, handle } = deps;
  const origin = new URL(deps.baseURL).origin;
  const ctx = await auth.$context;

  const existing = await ctx.internalAdapter.findUserByEmail(email);
  if (existing && !opts.recreate) return { status: 'exists', email };
  if (!existing) {
    // Outro administrador já existe: o bootstrap não cria um segundo (o primeiro é o único que o bootstrap serve).
    const outros = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.role, 'admin')).limit(1);
    if (outros.length > 0) return { status: 'refused', reason: 'já existe um administrador diferente deste e-mail; o bootstrap só cria o primeiro' };
  }
  if (existing) await removeUser(db, existing.user.id);

  const password = (opts.generatePassword ?? randomPassword)();
  const { id } = await createStaffUser(auth, { email, name: 'Admin de staging', password, role: 'admin' });
  try {
    const req = (path: string, body: unknown, cookie?: string) =>
      new Request(`${origin}/api/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, 'x-forwarded-for': '127.0.0.1', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    const cookieOf = (r: Response) =>
      r.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .filter((c) => c && !c.endsWith('='))
        .join('; ');

    const first = await handle(req('/sign-in/email', { email, password }));
    if (!first.ok) throw new Error(`entrada inicial recusada (HTTP ${first.status})`);
    const c0 = cookieOf(first);
    const en = await handle(req('/two-factor/enable', { password }, c0));
    if (!en.ok) throw new Error(`ativação do 2º fator recusada (HTTP ${en.status})`);
    const { totpURI, backupCodes } = (await en.json()) as { totpURI: string; backupCodes?: string[] };
    const secret = new URL(totpURI).searchParams.get('secret');
    if (!secret) throw new Error('o Better Auth não devolveu o segredo do TOTP');
    const totp = () => createOTP(base32.decode(secret.toUpperCase())).totp();
    const confirm = await handle(req('/two-factor/verify-totp', { code: await totp() }, c0));
    if (!confirm.ok) throw new Error(`confirmação do TOTP recusada (HTTP ${confirm.status})`);

    // O login COMPLETO precisa funcionar de verdade (senha + código) antes de entregar o segredo a alguém.
    const login = await handle(req('/sign-in/email', { email, password }));
    const final = await handle(req('/two-factor/verify-totp', { code: await totp() }, cookieOf(login)));
    if (!login.ok || !final.ok) throw new Error('o login completo (senha + TOTP) não funcionou depois do enrolamento');
    // sessões do bootstrap não ficam abertas
    await db.delete(schema.session).where(eq(schema.session.userId, id));

    // Auditoria SEM segredo e sem e-mail em claro: o usuário vai pelo id (resourceId) e, como na produção, só o domínio.
    await audit(db, {
      actorId: null,
      actorRole: 'cli',
      action: 'bootstrap_admin_staging',
      resource: 'usuarios',
      resourceId: id,
      detalhe: { emailDominio: email.slice(email.lastIndexOf('@') + 1), recreate: Boolean(existing), entrega: opts.entrega ?? null, commit: opts.commit ?? null },
    });
    return { status: 'created', email, password, totpSecret: secret, totpUri: totpURI, backupCodes: backupCodes ?? [] };
  } catch (e) {
    await removeUser(db, id); // nada de administrador pela metade: se o enrolamento falhou, o usuário some
    throw e;
  }
}

async function removeUser(db: Db, userId: string): Promise<void> {
  await db.delete(schema.session).where(eq(schema.session.userId, userId));
  await db.delete(schema.twoFactor).where(eq(schema.twoFactor.userId, userId));
  await db.delete(schema.account).where(eq(schema.account.userId, userId));
  await db.delete(schema.user).where(eq(schema.user.id, userId));
}
