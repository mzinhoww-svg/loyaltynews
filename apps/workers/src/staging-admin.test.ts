import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { authorize, createAuth, createAuthHandler, createStaffUser, type Db } from '@ln/auth';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import { assertStagingBound, run, type BindingsFile } from './staging-admin';

/** TOTP gerado e verificado com o relógio (só Date) parado entre os dois passos: nunca na virada da janela de 30 s sob carga. Sem retry.
 *  Não toca no relógio injetado dos handlers (janela de bloqueio de tentativas). Se o teste já usa relógio falso, não mexe. */
const relogioParado = async <T>(fn: () => Promise<T>): Promise<T> => {
  const congelar = !vi.isFakeTimers();
  if (congelar) vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
  try {
    return await fn();
  } finally {
    if (congelar) vi.useRealTimers();
  }
};

// Bootstrap do primeiro administrador de STAGING (decisão de segurança 14): ambiente + vínculo do banco, confirmação explícita, entrega só
// por terminal (--tty) ou arquivo exclusivo fora do repositório (--secret-file), idempotência, segundo admin recusado, nada de segredo em stdout/auditoria.
const DB_URL = 'postgres:' + '//app:SENHA-DO-BANCO@staging-db.vertra.invalid:5432/ln_staging';
const STG = { APP_ENV: 'staging', DATABASE_URL: DB_URL };
const BINDINGS: BindingsFile = { ambientes: { staging: { dbHost: 'staging-db.vertra.invalid', dbName: 'ln_staging' }, production: { dbHost: null, dbName: null } } };
const ORIGIN = 'http://localhost:3000';
const EMAIL = 'admin.staging@loyaltynews.invalid';
const OK = ['--confirm-staging-bootstrap'];
const dirs: string[] = [];
const outside = () => {
  const d = mkdtempSync(join(tmpdir(), 'ln-seg-'));
  dirs.push(d);
  return d;
};
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function mk() {
  const t = await createTestDb();
  const db = t.db as unknown as Db;
  const auth = createAuth({ db, secret: 'k'.repeat(40), baseURL: ORIGIN });
  const handle = createAuthHandler({ auth, db });
  return { t, db, deps: { db, auth, handle, baseURL: ORIGIN } };
}
type Deps = Awaited<ReturnType<typeof mk>>['deps'];
const exec = async (deps: Deps, argv: string[], env: Record<string, string | undefined> = STG, ctx: Parameters<typeof run>[4] = {}) => {
  const out: string[] = [];
  const code = await run(argv, env, (s) => out.push(s), deps, { bindings: BINDINGS, tty: true, ...ctx });
  return { code, text: out.join('\n') };
};
const tty = (deps: Deps, extra: string[] = [], env = STG) => exec(deps, [...OK, '--tty', ...extra], env);
const field = (text: string, label: string) => text.split('\n').find((l) => l.startsWith(label))!.slice(label.length).trim();
const post = (deps: Deps, path: string, body: unknown, cookie?: string) =>
  deps.handle(new Request(`${ORIGIN}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '10.1.1.1', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const cookieOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c && !c.endsWith('=')).join('; ');
const totp = (secret: string) => createOTP(base32.decode(secret.toUpperCase())).totp();

describe('L1 ambiente e vínculo do banco', () => {
  it('APP_ENV diferente de staging (production, producao, homologacao, vazio, caixa) recusa com 2 sem tocar no banco', async () => {
    const { t, db, deps } = await mk();
    try {
      for (const APP_ENV of ['production', 'producao', 'homologacao', '', 'Staging', ' staging']) {
        const r = await tty(deps, [], { APP_ENV, DATABASE_URL: DB_URL });
        expect(r.code, APP_ENV).toBe(2);
        expect(r.text).toMatch(/só vale em staging/);
      }
      expect((await tty(deps, [], { DATABASE_URL: DB_URL } as never)).code).toBe(2);
      expect(await db.select().from(schema.user)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it('DATABASE_URL de outro banco (inclusive o de produção), host ou nome diferentes, ausente ou inválida: recusa SEM tocar no banco e sem repetir a URL', async () => {
    const { t, db, deps } = await mk();
    try {
      for (const url of [
        'postgres:' + '//app:SENHA-PROD@prod-db.vertra.invalid:5432/ln_prod',
        'postgres:' + '//app:SENHA-X@staging-db.vertra.invalid:5432/ln_prod', // host certo, banco errado
        'postgres:' + '//app:SENHA-X@prod-db.vertra.invalid:5432/ln_staging', // banco certo, host errado
        'mysql://x@staging-db.vertra.invalid/ln_staging',
        'isto não é url',
        '',
      ]) {
        const r = await tty(deps, [], { APP_ENV: 'staging', DATABASE_URL: url });
        expect(r.code, url).toBe(2);
        expect(r.text).not.toContain('SENHA-');
        expect(r.text).not.toContain('prod-db');
      }
      const semVinculo = await exec(deps, [...OK, '--tty'], STG, { bindings: { ambientes: { staging: { dbHost: null, dbName: null } } } });
      expect(semVinculo).toMatchObject({ code: 2 });
      expect(semVinculo.text).toMatch(/sem vínculo/);
      expect(await db.select().from(schema.user)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it('o vínculo é conferido pelo host (caixa e porta não enganam) e pelo nome; o arquivo real de vínculos traz staging preenchido e produção vazia', () => {
    expect(() => assertStagingBound('postgres:' + '//u:p@STAGING-DB.vertra.invalid:6543/ln_staging', BINDINGS)).not.toThrow();
    expect(() => assertStagingBound('postgres:' + '//u:p@staging-db.vertra.invalid:5432/ln_staging?sslmode=require', BINDINGS)).not.toThrow();
    expect(() => assertStagingBound('postgres:' + '//u:p@staging-db.vertra.invalid.evil.example/ln_staging', BINDINGS)).toThrow();
    expect(() => assertStagingBound(DB_URL)).toThrow(/NÃO aponta para o banco de staging/); // contra o bindings.json REAL embutido
  });
});

describe('L2 confirmação explícita', () => {
  it('sem --confirm-staging-bootstrap recusa (também no --recreate); nada é criado', async () => {
    const { t, db, deps } = await mk();
    try {
      for (const argv of [['--tty'], ['--tty', '--recreate'], ['--secret-file', join(outside(), 's.json')]]) {
        const r = await exec(deps, argv);
        expect(r.code, argv.join(' ')).toBe(2);
        expect(r.text).toMatch(/--confirm-staging-bootstrap/);
      }
      expect(await db.select().from(schema.user)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });
});

describe('L3 e-mail e argumentos', () => {
  it('só e-mail .invalid no formato fixo; argumento desconhecido ou posicional recusa; escolher os dois modos de entrega (ou nenhum) recusa', async () => {
    const { t, db, deps } = await mk();
    try {
      for (const e of ['alguem@gmail.com', 'x@loyaltynews.invalid.com', 'Ana Souza@x.invalid', 'a+b@x.invalid']) expect((await tty(deps, ['--email', e])).code, e).toBe(2);
      expect((await exec(deps, [...OK, '--tty', '--senha', 'x'])).code).toBe(2);
      expect((await exec(deps, [...OK, '--tty', 'solto'])).code).toBe(2);
      expect((await exec(deps, [...OK])).code).toBe(2); // nenhum modo
      expect((await exec(deps, [...OK, '--tty', '--secret-file', join(outside(), 'a.json')])).code).toBe(2); // os dois
      expect(await db.select().from(schema.user)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });
});

describe('L7 entrega: --tty', () => {
  it('--tty sem terminal (stdout ou stdin) recusa ANTES de criar o usuário', async () => {
    const { t, db, deps } = await mk();
    try {
      const r = await exec(deps, [...OK, '--tty'], STG, { tty: false });
      expect(r.code).toBe(2);
      expect(r.text).toMatch(/terminal interativo/);
      expect(await db.select().from(schema.user)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it('cria o admin com MFA: só senha = sessão pendente (authorize nega), senha + TOTP = sessão completa e authorize em recurso de admin passa; sem sessão aberta e nome fixo', async () => {
    const { t, db, deps } = await mk();
    try {
      const r = await tty(deps);
      expect(r.code).toBe(0);
      const senha = field(r.text, 'senha inicial:');
      const secret = field(r.text, 'segredo do TOTP:');
      expect(senha.length).toBeGreaterThanOrEqual(32);
      expect(field(r.text, 'e-mail:')).toBe(EMAIL);
      expect(field(r.text, 'URI (autenticador):')).toMatch(/^otpauth:\/\/totp\//);
      const [u] = await db.select().from(schema.user).where(eq(schema.user.email, EMAIL));
      expect(u).toMatchObject({ role: 'admin', name: 'Admin de staging', emailVerified: true, twoFactorEnabled: true });
      expect(await db.select().from(schema.session)).toHaveLength(0);
      const login = await post(deps, '/sign-in/email', { email: EMAIL, password: senha });
      expect(login.ok).toBe(true);
      const pendente = cookieOf(login);
      const req = (cookie: string) => new Request(`${ORIGIN}/api/usuarios`, { headers: { cookie } });
      await expect(authorize(deps.auth, req(pendente).headers, 'usuarios', 'read')).rejects.toBeDefined(); // senha só: sessão pendente
      const full = await relogioParado(async () => post(deps, '/two-factor/verify-totp', { code: await totp(secret) }, pendente));
      expect(full.ok).toBe(true);
      const session = await authorize(deps.auth, req(cookieOf(full)).headers, 'usuarios', 'read');
      expect(session).toMatchObject({ role: 'admin' });
    } finally {
      await t.close();
    }
  });
});

describe('L7 entrega: --secret-file', () => {
  it('recusa dentro do repositório, caminho que já existe e pasta inexistente: tudo ANTES de criar o usuário', async () => {
    const { t, db, deps } = await mk();
    try {
      const fora = outside();
      const roots = [fora];
      expect((await exec(deps, [...OK, '--secret-file', join(fora, 'dentro.json')], STG, { checkoutRoots: roots })).text).toMatch(/dentro do repositório/);
      const repo = process.cwd();
      const dentro = await exec(deps, [...OK, '--secret-file', join(repo, 'segredo-teste.json')]);
      expect([dentro.code, dentro.text]).toEqual([2, expect.stringMatching(/dentro do repositório/)]);
      expect(existsSync(join(repo, 'segredo-teste.json'))).toBe(false);
      const existente = join(outside(), 'ja-existe.json');
      writeFileSync(existente, 'conteúdo antigo');
      const ja = await exec(deps, [...OK, '--secret-file', existente]);
      expect([ja.code, ja.text]).toEqual([2, expect.stringMatching(/já existe/)]);
      expect(readFileSync(existente, 'utf8')).toBe('conteúdo antigo'); // não sobrescreve
      const semPasta = await exec(deps, [...OK, '--secret-file', join(outside(), 'nao', 'existe', 's.json')]);
      expect([semPasta.code, semPasta.text]).toEqual([2, expect.stringMatching(/exclusiva e restrita/)]);
      expect(await db.select().from(schema.user)).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it('com --secret-file: stdout SEM segredo; o arquivo (modo restrito) tem o login funcional; o administrador é criado uma vez', async () => {
    const { t, db, deps } = await mk();
    try {
      const alvo = join(outside(), 'staging-admin.json');
      const r = await exec(deps, [...OK, '--secret-file', alvo]);
      expect(r.code).toBe(0);
      const arq = JSON.parse(readFileSync(alvo, 'utf8')) as { email: string; password: string; totpSecret: string; totpUri: string; backupCodes: string[] };
      expect(arq.email).toBe(EMAIL);
      for (const segredo of [arq.password, arq.totpSecret, arq.totpUri, ...arq.backupCodes]) expect(r.text).not.toContain(segredo);
      expect(r.text).toContain(alvo); // diz ONDE está, nunca o conteúdo
      if (process.platform !== 'win32') expect(statSync(alvo).mode & 0o077).toBe(0);
      // o que está no arquivo faz o login completo
      const login = await post(deps, '/sign-in/email', { email: arq.email, password: arq.password });
      expect(login.ok).toBe(true);
      expect((await relogioParado(async () => post(deps, '/two-factor/verify-totp', { code: await totp(arq.totpSecret) }, cookieOf(login)))).ok).toBe(true);
      expect(await db.select().from(schema.user)).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it('se o administrador já existe ou outro admin existe, o arquivo vazio criado na checagem é apagado e nada é gravado', async () => {
    const { t, deps } = await mk();
    try {
      await exec(deps, [...OK, '--secret-file', join(outside(), 'a.json')]);
      const b = join(outside(), 'b.json');
      const r = await exec(deps, [...OK, '--secret-file', b]);
      expect(r.code).toBe(0);
      expect(r.text).toMatch(/já existe/);
      expect(existsSync(b)).toBe(false);
    } finally {
      await t.close();
    }
  });
});

describe('L4 idempotência e L9 auditoria', () => {
  it('repetir não muda nada nem reexibe segredo; --recreate (com --confirm) gera segredos novos e a senha antiga morre', async () => {
    const { t, db, deps } = await mk();
    try {
      const a = await tty(deps);
      const senhaA = field(a.text, 'senha inicial:');
      const b = await tty(deps);
      expect([b.code, b.text]).toEqual([0, expect.stringMatching(/já existe/)]);
      expect(b.text).not.toMatch(/senha inicial|segredo do TOTP|otpauth/);
      const semConfirm = await exec(deps, ['--tty', '--recreate']);
      expect(semConfirm.code).toBe(2);
      const c = await tty(deps, ['--recreate']);
      expect(c.code).toBe(0);
      expect(field(c.text, 'senha inicial:')).not.toBe(senhaA);
      expect(await db.select().from(schema.user)).toHaveLength(1);
      expect((await post(deps, '/sign-in/email', { email: EMAIL, password: senhaA })).ok).toBe(false);
    } finally {
      await t.close();
    }
  });

  it('não cria um segundo administrador quando já existe outro; --recreate não apaga o admin real', async () => {
    const { t, db, deps } = await mk();
    try {
      await createStaffUser(deps.auth, { email: 'real@loyaltynews.example', name: 'Real', password: 'senha-real-bem-longa-1', role: 'admin' });
      const r = await tty(deps);
      expect([r.code, r.text]).toEqual([1, expect.stringMatching(/já existe um administrador diferente/)]);
      expect((await tty(deps, ['--recreate'])).code).toBe(1);
      expect((await db.select().from(schema.user)).map((u) => u.email)).toEqual(['real@loyaltynews.example']);
    } finally {
      await t.close();
    }
  });

  it('auditoria `bootstrap_admin_staging`: id, e-mail .invalid, entrega e commit, sem senha nem segredo; stdout/stderr dos casos de recusa também sem segredo', async () => {
    const { t, db, deps } = await mk();
    try {
      const alvo = join(outside(), 'a.json');
      const r = await exec(deps, [...OK, '--secret-file', alvo], { ...STG, LN_COMMIT_SHA: 'abc1234' });
      const arq = JSON.parse(readFileSync(alvo, 'utf8')) as { password: string; totpSecret: string };
      const logs = await db.select().from(schema.auditLog);
      const boot = logs.filter((l) => l.action === 'bootstrap_admin_staging');
      expect(boot).toHaveLength(1);
      expect(boot[0]!.detalhe).toEqual({ email: EMAIL, recreate: false, entrega: 'arquivo', commit: 'abc1234' });
      expect(boot[0]!.resourceId).toBeTruthy();
      expect(JSON.stringify(logs)).not.toContain(arq.password);
      expect(JSON.stringify(logs)).not.toContain(arq.totpSecret);
      expect(JSON.stringify((await db.select().from(schema.account)))).not.toContain(arq.password);
      expect(r.text).not.toContain(arq.password);
    } finally {
      await t.close();
    }
  });
});

describe('ambiente sem dependências injetadas', () => {
  it('variáveis ausentes saem com 2, nomeiam só as variáveis e apagam o arquivo de segredo já reservado', async () => {
    const alvo = join(outside(), 'seg.json');
    const out: string[] = [];
    const code = await run([...OK, '--secret-file', alvo], { APP_ENV: 'staging', DATABASE_URL: DB_URL, BETTER_AUTH_SECRET: 'curto' }, (s) => out.push(s), undefined, { bindings: BINDINGS });
    expect(code).toBe(2);
    expect(out.join('')).toMatch(/BETTER_AUTH_SECRET/);
    expect(out.join('')).not.toContain('SENHA-DO-BANCO');
    expect(existsSync(alvo)).toBe(false);
  });
});
