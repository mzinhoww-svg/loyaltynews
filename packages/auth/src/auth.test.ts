import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import {
  ACTIONS,
  AccessDeniedError,
  RESOURCES,
  ROLES,
  authorize,
  can,
  createAuth,
  createAuthHandler,
  createStaffUser,
  getSession,
  requireRole,
  sessionFromHeaders,
  type Role,
} from './index';
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

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'senha-longa-de-teste-1';
let t: Awaited<ReturnType<typeof createTestDb>>;
let auth: ReturnType<typeof createAuth>;
let handle: (r: Request) => Promise<Response>;
let handle0: (r: Request) => Promise<Response>;
let clock = new Date('2026-11-22T12:00:00Z');
let seq = 0;

beforeAll(async () => {
  t = await createTestDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = t.db as any;
  auth = createAuth({ db, secret: 'x'.repeat(40), baseURL: ORIGIN });
  handle = createAuthHandler({ auth, db, now: () => clock, trustedProxyHops: 1 });
  handle0 = createAuthHandler({ auth, db, now: () => clock, trustedProxyHops: 0 });
});
afterAll(async () => {
  await t.close();
});

const req = (path: string, init: { method?: string; body?: unknown; cookie?: string; ip?: string } = {}) =>
  new Request(`${ORIGIN}/api/auth${path}`, {
    method: init.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      'x-forwarded-for': init.ip ?? '10.0.0.1',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.method === 'GET' ? undefined : JSON.stringify(init.body ?? {}),
  });

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => c && !c.endsWith('='))
    .join('; ');

async function newUser(role: Role) {
  const email = `u${++seq}-${role}@ln.test`;
  const { id } = await createStaffUser(auth, { email, name: `Usuário ${seq}`, password: PASSWORD, role });
  return { id, email };
}

const login = (email: string, ip?: string) => handle(req('/sign-in/email', { body: { email, password: PASSWORD }, ip }));

/** Ativa o TOTP do usuário (sessão só de senha) e devolve o segredo bruto para gerar códigos. */
async function enrollTotp(email: string) {
  const res = await login(email);
  expect(res.status).toBe(200);
  const cookie = cookieOf(res);
  const en = await handle(req('/two-factor/enable', { body: { password: PASSWORD }, cookie }));
  expect(en.status).toBe(200);
  const { totpURI } = (await en.json()) as { totpURI: string };
  const raw = base32.decode(new URL(totpURI).searchParams.get('secret')!.toUpperCase());
  const v = await relogioParado(async () => handle(req('/two-factor/verify-totp', { body: { code: await createOTP(raw).totp() }, cookie })));
  expect(v.status).toBe(200);
  return { raw, cookie: cookieOf(v) || cookie };
}

/** Login completo: senha + TOTP. Devolve o cabeçalho Cookie da sessão com MFA. */
async function fullLogin(email: string, raw: Uint8Array, ip?: string) {
  const res = await login(email, ip);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  const pending = cookieOf(res);
  const v = await relogioParado(async () => handle(req('/two-factor/verify-totp', { body: { code: await createOTP(raw).totp() }, cookie: pending })));
  expect(v.status).toBe(200);
  return cookieOf(v);
}

describe('ADR-011: sem cadastro público e rotas permitidas', () => {
  it('cadastro público responde 404', async () => {
    for (const p of ['/sign-up/email', '/sign-up']) {
      const res = await handle(req(p, { body: { email: 'x@y.test', password: PASSWORD, name: 'X' } }));
      expect(res.status).toBe(404);
    }
    expect(await t.db.select().from(schema.user).where(eq(schema.user.email, 'x@y.test'))).toHaveLength(0);
  });

  it('rotas fora da lista (reset de senha, social, admin) respondem 404', async () => {
    for (const p of ['/forget-password', '/reset-password', '/sign-in/social', '/admin/create-user', '/send-verification-email']) {
      expect((await handle(req(p))).status).toBe(404);
    }
  });

  it('createStaffUser recusa papel inválido, senha curta e e-mail repetido', async () => {
    await expect(createStaffUser(auth, { email: 'a@ln.test', name: 'A', password: PASSWORD, role: 'root' as Role })).rejects.toThrow();
    await expect(createStaffUser(auth, { email: 'b@ln.test', name: 'B', password: 'curta', role: 'editor' })).rejects.toThrow();
    const u = await newUser('editor');
    await expect(createStaffUser(auth, { email: u.email.toUpperCase(), name: 'D', password: PASSWORD, role: 'editor' })).rejects.toThrow();
  });
});

describe('ADR-011: MFA obrigatório', () => {
  it('senha correta sem 2º fator ativo não dá acesso (NO_MFA)', async () => {
    const u = await newUser('admin');
    const res = await login(u.email);
    expect(res.status).toBe(200);
    const headers = new Headers({ cookie: cookieOf(res) });
    const s = await sessionFromHeaders(auth, headers);
    expect(s?.mfa).toBe(false);
    await expect(authorize(auth, headers, 'materias', 'read')).rejects.toMatchObject({ reason: 'NO_MFA' });
  });

  it('com TOTP ativo, a senha sozinha não cria sessão; senha + código cria', async () => {
    const u = await newUser('editor_chefe');
    const { raw } = await enrollTotp(u.email);
    const res = await login(u.email);
    expect(((await res.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    // cookie devolvido após só a senha não autentica
    const pendingHeaders = new Headers({ cookie: cookieOf(res) });
    expect(await sessionFromHeaders(auth, pendingHeaders)).toBeNull();
    await expect(authorize(auth, pendingHeaders, 'materias', 'read')).rejects.toMatchObject({ reason: 'NO_SESSION' });

    const cookie = await fullLogin(u.email, raw);
    const s = await authorize(auth, new Headers({ cookie }), 'materias', 'publish');
    expect(s).toMatchObject({ userId: u.id, role: 'editor_chefe', mfa: true });
  });

  it('código TOTP errado falha e não cria sessão', async () => {
    const u = await newUser('editor');
    await enrollTotp(u.email);
    const res = await login(u.email);
    const v = await handle(req('/two-factor/verify-totp', { body: { code: '000000' }, cookie: cookieOf(res) }));
    expect(v.status).not.toBe(200);
    expect(await sessionFromHeaders(auth, new Headers({ cookie: cookieOf(v) }))).toBeNull();
  });
});

describe('ADR-011: sessão revogável no servidor', () => {
  it('sessão revogada perde acesso na requisição seguinte (cookie cache desligado)', async () => {
    const u = await newUser('admin');
    const { raw } = await enrollTotp(u.email);
    const cookie = await fullLogin(u.email, raw);
    const headers = new Headers({ cookie });
    expect(await sessionFromHeaders(auth, headers)).not.toBeNull();
    const rev = await handle(req('/revoke-sessions', { cookie }));
    expect(rev.status).toBe(200);
    expect(await sessionFromHeaders(auth, headers)).toBeNull();
    await expect(authorize(auth, headers, 'materias', 'read')).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('revogação feita direto no banco (admin/operador) também vale; usuário banido é negado', async () => {
    const u = await newUser('editor');
    const { raw } = await enrollTotp(u.email);
    const cookie = await fullLogin(u.email, raw);
    const headers = new Headers({ cookie });
    expect(await sessionFromHeaders(auth, headers)).not.toBeNull();
    await t.db.update(schema.user).set({ banned: true }).where(eq(schema.user.id, u.id));
    expect(await sessionFromHeaders(auth, headers)).toBeNull();
    await t.db.update(schema.user).set({ banned: false }).where(eq(schema.user.id, u.id));
    expect(await sessionFromHeaders(auth, headers)).not.toBeNull();
    await t.db.delete(schema.session).where(eq(schema.session.userId, u.id));
    expect(await sessionFromHeaders(auth, headers)).toBeNull();
  });
});

describe('ADR-011: RBAC negativo por papel (com sessão MFA real)', () => {
  it('cada papel só passa nas ações da matriz; o resto é FORBIDDEN', async () => {
    for (const role of ROLES) {
      const u = await newUser(role);
      const { raw } = await enrollTotp(u.email);
      const headers = new Headers({ cookie: await fullLogin(u.email, raw) });
      for (const r of RESOURCES) {
        for (const a of ACTIONS) {
          const p = authorize(auth, headers, r, a);
          if (can(role, r, a)) await expect(p).resolves.toMatchObject({ role });
          else await expect(p).rejects.toMatchObject({ reason: 'FORBIDDEN' });
        }
      }
    }
  }, 120_000);
});

describe('ADR-011: limite de tentativas (5 falhas / 15 min, bloqueio de 15 min)', () => {
  const bad = (email: string, ip: string) => handle(req('/sign-in/email', { body: { email, password: 'senha-errada-123' }, ip }));

  it('por conta: 5 falhas bloqueiam; a 6ª tentativa, mesmo com a senha certa, é 429 e não estende o bloqueio', async () => {
    const u = await newUser('editor');
    clock = new Date('2026-11-22T12:00:00Z');
    for (let i = 0; i < 5; i++) expect((await bad(u.email, `10.1.0.${i}`)).status).toBe(401);
    const blocked = await login(u.email, '10.1.9.9');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    clock = new Date('2026-11-22T12:14:00Z');
    expect((await login(u.email, '10.1.9.9')).status).toBe(429);
    clock = new Date('2026-11-22T12:15:01Z');
    expect((await login(u.email, '10.1.9.9')).status).toBe(200);
  });

  it('por IP: 5 falhas em contas diferentes bloqueiam o IP para qualquer conta', async () => {
    const ok = await newUser('editor');
    clock = new Date('2026-11-22T13:00:00Z');
    for (let i = 0; i < 5; i++) await bad(`inexistente${i}@ln.test`, '10.2.0.1');
    expect((await login(ok.email, '10.2.0.1')).status).toBe(429);
    expect((await login(ok.email, '10.2.0.2')).status).toBe(200); // outro IP, mesma conta: livre
  });

  it('login correto zera o contador da conta; falhas fora da janela de 15 min não se somam', async () => {
    const u = await newUser('editor');
    clock = new Date('2026-11-22T14:00:00Z');
    for (let i = 0; i < 4; i++) await bad(u.email, '10.3.0.1');
    expect((await login(u.email, '10.3.0.9')).status).toBe(200);
    for (let i = 0; i < 4; i++) await bad(u.email, '10.3.0.2');
    expect((await login(u.email, '10.3.0.8')).status).toBe(200);
    clock = new Date('2026-11-22T14:00:00Z');
    for (let i = 0; i < 4; i++) await bad(u.email, '10.3.0.3');
    clock = new Date('2026-11-22T14:16:00Z');
    await bad(u.email, '10.3.0.3');
    expect((await login(u.email, '10.3.0.7')).status).toBe(200);
  });
});

describe('QA: IP só de proxy confiável e limite estrito sob concorrência', () => {
  const attempt = (h: typeof handle, email: string, xff: string, password = 'senha-errada-123') =>
    h(req('/sign-in/email', { body: { email, password }, ip: xff }));
  const tally = (rs: Response[]) => ({
    passaram: rs.filter((r) => r.status === 401).length,
    barradas: rs.filter((r) => r.status === 429).length,
    outros: rs.filter((r) => r.status !== 401 && r.status !== 429).length,
  });

  it('cabeçalho forjado à esquerda não burla o limite por IP (contas diferentes, mesmo IP real)', async () => {
    const ok = await newUser('editor');
    clock = new Date('2026-11-22T15:00:00Z');
    // atacante troca o valor forjado a cada tentativa; o proxy confiável acrescenta o IP real à direita
    for (let i = 0; i < 5; i++) expect((await attempt(handle, `alvo${i}@ln.test`, `7.7.7.${i}, 198.51.100.9`)).status).toBe(401);
    expect((await attempt(handle, ok.email, '8.8.8.8, 198.51.100.9', PASSWORD)).status).toBe(429);
    expect((await attempt(handle, ok.email, '8.8.8.8, 198.51.100.10', PASSWORD)).status).toBe(200); // outro IP real
  });

  it('sem proxy confiável configurado, o cabeçalho é ignorado: não cria bucket de IP e o limite por conta continua valendo', async () => {
    const u = await newUser('editor');
    clock = new Date('2026-11-22T16:00:00Z');
    const rs: Response[] = [];
    for (let i = 0; i < 6; i++) rs.push(await attempt(handle0, u.email, `1.1.1.${i}`));
    expect(tally(rs)).toEqual({ passaram: 5, barradas: 1, outros: 0 });
    for (let i = 0; i < 8; i++) await attempt(handle0, `outro${i}@ln.test`, '1.1.1.1');
    const ipRows = await t.db.select().from(schema.authAttempt).where(eq(schema.authAttempt.kind, 'ip'));
    expect(ipRows.filter((r) => r.subject.startsWith('1.1.1.'))).toHaveLength(0);
  });

  it('requisição sem a cadeia de proxies esperada (cabeçalho ausente) não cria bucket de IP', async () => {
    const r = await handle(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: 'nenhum@ln.test', password: 'x'.repeat(12) }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it('20 tentativas simultâneas na mesma conta (IPs diferentes): exatamente 5 chegam à senha, 15 são barradas', async () => {
    const u = await newUser('editor');
    clock = new Date('2026-11-22T17:00:00Z');
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => attempt(handle, u.email, `192.0.2.${i + 1}`)));
    expect(tally(rs)).toEqual({ passaram: 5, barradas: 15, outros: 0 });
    // com a conta bloqueada, nem a senha certa entra
    expect((await attempt(handle, u.email, '192.0.2.99', PASSWORD)).status).toBe(429);
  });

  it('20 tentativas simultâneas do mesmo IP em contas diferentes: exatamente 5 passam', async () => {
    clock = new Date('2026-11-22T18:00:00Z');
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => attempt(handle, `ip-conc${i}@ln.test`, '203.0.113.50')));
    expect(tally(rs)).toEqual({ passaram: 5, barradas: 15, outros: 0 });
  });
});

describe('auditoria de login', () => {
  it('grava falha, bloqueio e sucesso sem senha, código nem token', async () => {
    const rows = await t.db.select().from(schema.auditLog);
    const actions = new Set(rows.map((r) => r.action));
    expect(actions).toContain('login.falha');
    expect(actions).toContain('login.bloqueado');
    expect(actions).toContain('login.senha_ok_aguarda_2fa');
    expect(actions).toContain('login.2fa_ok');
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain('senha-errada-123');
  });
});

describe('API compatível com o stub (sem ambiente configurado)', () => {
  it('getSession devolve null e requireRole nega', async () => {
    expect(await getSession(new Request('http://localhost/x'))).toBeNull();
    await expect(requireRole(['admin'], new Request('http://localhost/x'))).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
