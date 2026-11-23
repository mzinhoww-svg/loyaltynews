import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { createAuth, createAuthHandler, createStaffUser, type Db } from '@ln/auth';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import { run } from './staging-admin';

// Bootstrap do primeiro administrador de STAGING: só staging, só terminal, segredo uma vez, idempotente, sem vazar.
const STG = { APP_ENV: 'staging' };
const ORIGIN = 'http://localhost:3000';
const EMAIL = 'admin.staging@loyaltynews.invalid';

async function mk() {
  const t = await createTestDb();
  const db = t.db as unknown as Db;
  const auth = createAuth({ db, secret: 'k'.repeat(40), baseURL: ORIGIN });
  const handle = createAuthHandler({ auth, db });
  return { t, db, deps: { db, auth, handle, baseURL: ORIGIN } };
}
const exec = async (deps: Awaited<ReturnType<typeof mk>>['deps'], argv: string[] = [], env: Record<string, string | undefined> = STG, tty = true) => {
  const out: string[] = [];
  const code = await run(argv, env, (s) => out.push(s), deps, tty);
  return { code, text: out.join('\n'), out };
};
const field = (text: string, label: string) => text.split('\n').find((l) => l.startsWith(label))!.slice(label.length).trim();

describe('staging-admin', () => {
  it('só staging: produção, vazio e outros valores recusam (2) sem tocar no banco', async () => {
    const { t, db, deps } = await mk();
    try {
      for (const env of [{ APP_ENV: 'production' }, {}, { APP_ENV: 'dev' }, { APP_ENV: 'Staging' }]) {
        const r = await exec(deps, [], env);
        expect(r.code, JSON.stringify(env)).toBe(2);
        expect(r.text).toMatch(/só vale em staging/);
      }
      expect(await db.select().from(schema.user)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it('recusa e-mail que não seja .invalid e argumento desconhecido; recusa saída que não é terminal ANTES de criar o usuário', async () => {
    const { t, db, deps } = await mk();
    try {
      expect((await exec(deps, ['--email', 'alguem@gmail.com'])).code).toBe(2);
      expect((await exec(deps, ['--email', 'x@loyaltynews.invalid.com'])).code).toBe(2);
      expect((await exec(deps, ['--senha', 'x'])).code).toBe(2);
      const notty = await exec(deps, [], STG, false);
      expect(notty.code).toBe(2);
      expect(notty.text).toMatch(/não é um terminal interativo/);
      expect(await db.select().from(schema.user)).toHaveLength(0); // nada foi criado, então nenhum segredo se perdeu
    } finally {
      await t.close();
    }
  });

  it('cria o administrador com TOTP enrolado: a senha e o segredo mostrados fazem o login completo; só admin; sem sessão aberta', async () => {
    const { t, db, deps } = await mk();
    try {
      const r = await exec(deps);
      expect(r.code).toBe(0);
      const senha = field(r.text, 'senha inicial:');
      const secret = field(r.text, 'segredo do TOTP:');
      expect(senha.length).toBeGreaterThanOrEqual(32);
      expect(secret.length).toBeGreaterThan(10);
      expect(field(r.text, 'e-mail:')).toBe(EMAIL);
      expect(field(r.text, 'URI (autenticador):')).toMatch(/^otpauth:\/\/totp\//);
      const [u] = await db.select().from(schema.user).where(eq(schema.user.email, EMAIL));
      expect(u).toMatchObject({ role: 'admin', emailVerified: true, twoFactorEnabled: true });
      expect(await db.select().from(schema.session)).toHaveLength(0);
      // login real com o que foi mostrado
      const post = (path: string, body: unknown, cookie?: string) =>
        deps.handle(new Request(`${ORIGIN}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '10.1.1.1', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
      const cookie = (r2: Response) => r2.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c && !c.endsWith('=')).join('; ');
      const login = await post('/sign-in/email', { email: EMAIL, password: senha });
      expect(login.ok).toBe(true);
      const code = await createOTP(base32.decode(secret.toUpperCase())).totp();
      expect((await post('/two-factor/verify-totp', { code }, cookie(login))).ok).toBe(true);
    } finally {
      await t.close();
    }
  });

  it('idempotente: repetir não muda nada e NÃO reexibe segredo; --recreate gera segredos novos e os antigos deixam de valer', async () => {
    const { t, db, deps } = await mk();
    try {
      const a = await exec(deps);
      const senhaA = field(a.text, 'senha inicial:');
      const b = await exec(deps);
      expect(b.code).toBe(0);
      expect(b.text).toMatch(/já existe/);
      expect(b.text).not.toContain(senhaA);
      expect(b.text).not.toMatch(/senha inicial|segredo do TOTP|otpauth/);
      expect(await db.select().from(schema.user)).toHaveLength(1);
      const c = await exec(deps, ['--recreate']);
      expect(c.code).toBe(0);
      const senhaC = field(c.text, 'senha inicial:');
      expect(senhaC).not.toBe(senhaA);
      expect(await db.select().from(schema.user)).toHaveLength(1);
      const r = await deps.handle(new Request(`${ORIGIN}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '10.1.1.2' }, body: JSON.stringify({ email: EMAIL, password: senhaA }) }));
      expect(r.ok).toBe(false); // a senha antiga morreu
    } finally {
      await t.close();
    }
  });

  it('não cria um segundo administrador quando já existe outro; --recreate só mexe no administrador de staging', async () => {
    const { t, db, deps } = await mk();
    try {
      await createStaffUser(deps.auth, { email: 'real@loyaltynews.example', name: 'Real', password: 'senha-real-bem-longa-1', role: 'admin' });
      const r = await exec(deps);
      expect(r.code).toBe(1);
      expect(r.text).toMatch(/já existe um administrador diferente/);
      expect(await db.select().from(schema.user)).toHaveLength(1);
      const rc = await exec(deps, ['--recreate']);
      expect(rc.code).toBe(1); // o outro admin não é o de staging: nada é apagado
      expect((await db.select().from(schema.user))[0]!.email).toBe('real@loyaltynews.example');
    } finally {
      await t.close();
    }
  });

  it('não grava o segredo em lugar nenhum: auditoria só com o e-mail de teste; nada de senha/segredo no banco além do hash e do TOTP do Better Auth', async () => {
    const { t, db, deps } = await mk();
    try {
      const r = await exec(deps);
      const senha = field(r.text, 'senha inicial:');
      const secret = field(r.text, 'segredo do TOTP:');
      const logs = await db.select().from(schema.auditLog);
      const boot = logs.filter((l) => l.action === 'staging.admin_bootstrap');
      expect(boot).toHaveLength(1);
      expect(JSON.stringify(logs)).not.toContain(senha);
      expect(JSON.stringify(logs)).not.toContain(secret);
      expect(boot[0]!.detalhe).toEqual({ email: EMAIL, recreate: false });
      const contas = await db.select().from(schema.account);
      expect(JSON.stringify(contas)).not.toContain(senha); // só o hash
    } finally {
      await t.close();
    }
  });

  it('sem banco/auth configurados (sem dependências injetadas): variáveis ausentes saem com 2 e nomeiam só as variáveis', async () => {
    const out: string[] = [];
    const code = await run([], { APP_ENV: 'staging', BETTER_AUTH_SECRET: 'curto' }, (s) => out.push(s), undefined, true);
    expect(code).toBe(2);
    expect(out.join('')).toMatch(/DATABASE_URL/);
    expect(out.join('')).not.toContain('curto');
  });
});
