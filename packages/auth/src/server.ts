// Better Auth configurado para o LN Studio (ADR-011). Escolha e justificativa: packages/auth/DECISAO.md.
// Requisitos: MFA TOTP obrigatório (a sessão só vale com 2º fator ativo, ver guard.ts), sessão revogável
// no servidor (tabela auth_session; sem cookie cache), sem cadastro público, RBAC, auditoria, limite de tentativas.
import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor } from 'better-auth/plugins';
import { schema } from '@ln/db';
import { isRole, type Role } from './rbac';
import type { Db } from './types';

export interface CreateAuthOptions {
  db: Db;
  secret: string;
  baseURL: string;
  /** Sessão máxima em segundos (padrão 12 h). */
  sessionSeconds?: number;
}

export function createAuth(opts: CreateAuthOptions) {
  if (opts.secret.length < 32) throw new Error('BETTER_AUTH_SECRET precisa de ao menos 32 caracteres');
  return betterAuth({
    appName: 'Loyalty News — LN Studio',
    baseURL: opts.baseURL,
    secret: opts.secret,
    database: drizzleAdapter(opts.db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true, // sem cadastro público; usuários só nascem por createStaffUser
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
    },
    user: {
      additionalFields: {
        role: { type: 'string', required: false, defaultValue: 'leitor', input: false },
        banned: { type: 'boolean', required: false, defaultValue: false, input: false },
      },
    },
    session: {
      expiresIn: opts.sessionSeconds ?? 12 * 3600,
      updateAge: 3600,
      cookieCache: { enabled: false }, // revogação vale na próxima requisição (ADR-011: até 1 minuto)
    },
    plugins: [twoFactor({ issuer: 'Loyalty News' })],
    advanced: {
      // PRIVACIDADE (LGPD, decisão do PM 25/11): o Better Auth NÃO grava o IP na sessão (auth_session.ip_address ficava cru) nem o usa no limite embutido dele (em memória,
      // ~1000/h, por IP resolvido de um cabeçalho que o cliente pode forjar). Contrapartida registrada no README: o limite por IP e por conta é do PRÓPRIO app
      // (attempts.ts, HMAC no banco) e cobre toda rota de /api/auth que adivinha credencial (handler.ts: AUTH_ROUTE_POLICY, com teste).
      ipAddress: { disableIpTracking: true },
      database: { generateId: () => randomUUID() },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

export interface NewStaffUser {
  email: string;
  name: string;
  password: string;
  role: Role;
}

/**
 * Única porta de criação de usuário (sem cadastro público). Uso: seed de bootstrap e rota /api/usuarios (admin).
 * O usuário nasce sem 2º fator; até ativar o TOTP, a guarda nega tudo menos a ativação.
 */
export async function createStaffUser(auth: Auth, input: NewStaffUser): Promise<{ id: string }> {
  if (!isRole(input.role)) throw new Error(`papel inválido: ${String(input.role)}`);
  const ctx = await auth.$context;
  if (input.password.length < 12) throw new Error('senha com menos de 12 caracteres');
  const email = input.email.trim().toLowerCase();
  if (await ctx.internalAdapter.findUserByEmail(email)) throw new Error('e-mail já cadastrado');
  const hash = await ctx.password.hash(input.password);
  const created = await ctx.internalAdapter.createUser({ email, name: input.name, emailVerified: true, role: input.role }, { method: 'admin' });
  await ctx.internalAdapter.linkAccount({ userId: created.id, providerId: 'credential', accountId: created.id, password: hash });
  return { id: created.id };
}
