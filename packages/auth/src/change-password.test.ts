// Troca da própria senha (changeOwnPassword): Better Auth real sobre PGlite, sessões com TOTP.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import { CHANGE_PASSWORD_ACTION, changeOwnPassword, createAuth, createAuthHandler, createStaffUser, sessionFromHeaders, validarNovaSenha } from './index';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'senha-longa-de-teste-1';
const NOVA = 'outra-senha-bem-longa-2';
let t: Awaited<ReturnType<typeof createTestDb>>;
let auth: ReturnType<typeof createAuth>;
let handle: (r: Request) => Promise<Response>;
let db: Parameters<typeof createAuthHandler>[0]['db'];
let clock = new Date('2026-11-24T12:00:00Z');
let seq = 0;

const relogioParado = async <T>(fn: () => Promise<T>): Promise<T> => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
};

beforeAll(async () => {
  t = await createTestDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db = t.db as any;
  auth = createAuth({ db, secret: 'x'.repeat(40), baseURL: ORIGIN });
  handle = createAuthHandler({ auth, db, now: () => clock, trustedProxyHops: 1 });
});
afterAll(async () => {
  await t.close();
});

const req = (path: string, body: unknown, cookie?: string, ip = `10.1.${seq}.1`) =>
  new Request(`${ORIGIN}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const cookieOf = (setCookies: string[]) =>
  setCookies
    .map((c) => c.split(';')[0])
    .filter((c) => c && !c.endsWith('='))
    .join('; ');
const hdr = (cookie: string) => new Headers({ cookie });

async function signIn(email: string, password: string, raw: Uint8Array | null): Promise<{ status: number; cookie: string }> {
  const r = await handle(req('/sign-in/email', { email, password }));
  if (r.status !== 200 || !raw) return { status: r.status, cookie: cookieOf(r.headers.getSetCookie()) };
  const v = await relogioParado(async () => handle(req('/two-factor/verify-totp', { code: await createOTP(raw).totp() }, cookieOf(r.headers.getSetCookie()))));
  return { status: v.status, cookie: cookieOf(v.headers.getSetCookie()) };
}

/** Usuário com TOTP ativo e uma sessão completa (senha + código). */
async function usuarioMfa() {
  const email = `troca${++seq}@ln.test`;
  const { id } = await createStaffUser(auth, { email, name: `Troca ${seq}`, password: PASSWORD, role: 'editor' });
  const r = await handle(req('/sign-in/email', { email, password: PASSWORD }));
  const c0 = cookieOf(r.headers.getSetCookie());
  const en = await handle(req('/two-factor/enable', { password: PASSWORD }, c0));
  const { totpURI } = (await en.json()) as { totpURI: string };
  const raw = base32.decode(new URL(totpURI).searchParams.get('secret')!.toUpperCase());
  await relogioParado(async () => handle(req('/two-factor/verify-totp', { code: await createOTP(raw).totp() }, c0)));
  const s = await signIn(email, PASSWORD, raw);
  expect(s.status).toBe(200);
  return { id, email, raw, cookie: s.cookie };
}

const trocar = (cookie: string, atual: string, nova: string, confirmacao = nova, ip: string | null = '10.200.0.1') =>
  changeOwnPassword({ auth, db, headers: hdr(cookie), ip, now: () => clock }, { atual, nova, confirmacao });

const auditoria = async (userId: string) =>
  (await t.db.select().from(schema.auditLog)).filter((r) => r.action === CHANGE_PASSWORD_ACTION && r.actorId === userId);

describe('validarNovaSenha (política)', () => {
  it('aceita 12+ caracteres, igual à confirmação e diferente da atual', () => {
    expect(validarNovaSenha('atual-qualquer', 'abcdefghijkl', 'abcdefghijkl')).toEqual([]);
  });
  it('recusa curta, longa demais, confirmação diferente, igual à atual e campos vazios, em pt-BR', () => {
    expect(validarNovaSenha('x', 'abcdefghijk', 'abcdefghijk')).toEqual(['A nova senha precisa ter pelo menos 12 caracteres.']);
    expect(validarNovaSenha('x', 'a'.repeat(129), 'a'.repeat(129))).toEqual(['A nova senha pode ter no máximo 128 caracteres.']);
    expect(validarNovaSenha('x', 'abcdefghijkl', 'abcdefghijkX')).toEqual(['A confirmação não é igual à nova senha.']);
    expect(validarNovaSenha('abcdefghijkl', 'abcdefghijkl', 'abcdefghijkl')).toEqual(['A nova senha precisa ser diferente da atual.']);
    expect(validarNovaSenha('', '', '')).toEqual(['Informe a senha atual.', 'Informe a nova senha.']);
  });
});

describe('changeOwnPassword', () => {
  it('troca com sucesso: grava pelo Better Auth, revoga as outras sessões, mantém quem trocou e a nova senha entra', async () => {
    const u = await usuarioMfa();
    const outra = await signIn(u.email, PASSWORD, u.raw); // segunda sessão (outro aparelho)
    const r = await trocar(u.cookie, PASSWORD, NOVA);
    expect(r).toMatchObject({ ok: true, status: 200 });
    if (!r.ok) throw new Error('falhou');
    // a sessão antiga e a outra caíram; o cookie novo devolvido vale
    expect(await sessionFromHeaders(auth, hdr(u.cookie))).toBeNull();
    expect(await sessionFromHeaders(auth, hdr(outra.cookie))).toBeNull();
    const nova = await sessionFromHeaders(auth, hdr(cookieOf(r.setCookies)));
    expect(nova).toMatchObject({ userId: u.id, mfa: true });
    // login: a antiga é recusada, a nova entra (com o 2º fator)
    expect((await signIn(u.email, PASSWORD, null)).status).toBe(401);
    expect((await signIn(u.email, NOVA, u.raw)).status).toBe(200);
    // auditoria change_password sem senha
    const a = await auditoria(u.id);
    expect(a.map((x) => (x.detalhe as { resultado: string }).resultado)).toEqual(['ok']);
    const tudo = JSON.stringify(await t.db.select().from(schema.auditLog));
    expect(tudo).not.toContain(NOVA);
    expect(tudo).not.toContain(PASSWORD);
  });

  it('senha atual errada: recusada em pt-BR, nada muda, auditada sem senha', async () => {
    const u = await usuarioMfa();
    const r = await trocar(u.cookie, 'senha-atual-errada-123', NOVA);
    expect(r).toMatchObject({ ok: false, status: 400, code: 'INVALID_CURRENT_PASSWORD', mensagem: 'A senha atual está incorreta.' });
    expect(await sessionFromHeaders(auth, hdr(u.cookie))).not.toBeNull();
    expect((await signIn(u.email, PASSWORD, u.raw)).status).toBe(200);
    expect((await auditoria(u.id)).map((x) => (x.detalhe as { resultado: string }).resultado)).toEqual(['senha_atual_incorreta']);
    expect(JSON.stringify(await auditoria(u.id))).not.toContain('senha-atual-errada-123');
  });

  it('política: curta, igual à atual e confirmação diferente não chegam ao banco nem gastam tentativa', async () => {
    const u = await usuarioMfa();
    expect(await trocar(u.cookie, PASSWORD, 'curta-11chr')).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(await trocar(u.cookie, PASSWORD, PASSWORD)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', erros: ['A nova senha precisa ser diferente da atual.'] });
    expect(await trocar(u.cookie, PASSWORD, NOVA, NOVA + 'x')).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect((await signIn(u.email, PASSWORD, u.raw)).status).toBe(200);
    const rows = await t.db.select().from(schema.authAttempt);
    expect(rows.find((x) => x.subject === `senha:${u.id}`)).toBeUndefined();
  });

  it('limite: 5 senhas atuais erradas bloqueiam 15 min (até a certa), por usuário; depois da janela volta', async () => {
    const u = await usuarioMfa();
    clock = new Date('2026-11-24T13:00:00Z');
    for (let i = 0; i < 5; i++) expect(await trocar(u.cookie, `errada-numero-${i}-xx`, NOVA, NOVA, `10.50.${seq}.${i}`)).toMatchObject({ code: 'INVALID_CURRENT_PASSWORD' });
    const b = await trocar(u.cookie, PASSWORD, NOVA, NOVA, '10.60.0.1');
    expect(b).toMatchObject({ ok: false, status: 429, code: 'TOO_MANY_ATTEMPTS' });
    if (b.ok) throw new Error('não bloqueou');
    expect(b.retryAfter).toBe(900);
    expect(b.mensagem).toContain('Tente de novo em 15 min');
    expect((await auditoria(u.id)).some((x) => (x.detalhe as { resultado: string }).resultado === 'bloqueada')).toBe(true);
    clock = new Date('2026-11-24T13:16:00Z');
    expect(await trocar(u.cookie, PASSWORD, NOVA, NOVA, '10.60.0.2')).toMatchObject({ ok: true });
  });

  it('limite por IP: 5 erradas do mesmo IP bloqueiam outra conta nesse IP', async () => {
    clock = new Date('2026-11-24T15:00:00Z');
    const ip = '10.77.7.7';
    const a = await usuarioMfa();
    const b = await usuarioMfa();
    for (let i = 0; i < 5; i++) await trocar(a.cookie, `errada-numero-${i}-xx`, NOVA, NOVA, ip);
    expect(await trocar(b.cookie, PASSWORD, NOVA, NOVA, ip)).toMatchObject({ status: 429 });
    expect(await trocar(b.cookie, PASSWORD, NOVA, NOVA, '10.77.7.8')).toMatchObject({ ok: true });
  });

  it('sem sessão: 401; sessão só com senha (sem 2º fator): 403, nada muda', async () => {
    expect(await trocar('', PASSWORD, NOVA)).toMatchObject({ ok: false, status: 401, code: 'UNAUTHENTICATED' });
    const email = `semmfa${++seq}@ln.test`;
    await createStaffUser(auth, { email, name: 'Sem MFA', password: PASSWORD, role: 'editor' });
    const s = await signIn(email, PASSWORD, null);
    expect(s.status).toBe(200);
    expect(await trocar(s.cookie, PASSWORD, NOVA)).toMatchObject({ ok: false, status: 403, code: 'MFA_REQUIRED' });
    expect((await signIn(email, PASSWORD, null)).status).toBe(200);
  });

  it('a rota direta /api/auth/change-password do Better Auth não existe (404): não há como contornar limite e política', async () => {
    const u = await usuarioMfa();
    const r = await handle(req('/change-password', { currentPassword: PASSWORD, newPassword: NOVA, revokeOtherSessions: false }, u.cookie));
    expect(r.status).toBe(404);
    expect((await signIn(u.email, PASSWORD, u.raw)).status).toBe(200);
  });
});

describe('rotas do 2º fator que conferem a senha: mesmo contador da troca (senha:<userId> e IP)', () => {
  const ROTAS = ['/two-factor/enable', '/two-factor/disable', '/two-factor/get-totp-uri', '/two-factor/generate-backup-codes'] as const;
  const bloqueios = async () => (await t.db.select().from(schema.auditLog)).filter((r) => r.action === 'senha.verificacao_bloqueada');

  for (const [i, rota] of ROTAS.entries()) {
    it(`${rota}: 5 senhas erradas bloqueiam a rota (429 + Retry-After, mesmo com a certa) e também a troca de senha`, async () => {
      clock = new Date(`2026-11-25T0${i}:00:00Z`);
      const u = await usuarioMfa();
      for (let n = 0; n < 5; n++) {
        const r = await handle(req(rota, { password: `errada-${n}-errada-xx` }, u.cookie, `10.90.${i}.${n}`));
        expect(r.status).toBe(400);
      }
      const b = await handle(req(rota, { password: PASSWORD }, u.cookie, `10.91.${i}.1`));
      expect(b.status).toBe(429);
      expect(b.headers.get('retry-after')).toBe('900');
      expect(((await b.json()) as { error: { code: string } }).error.code).toBe('TOO_MANY_ATTEMPTS');
      expect(await trocar(u.cookie, PASSWORD, NOVA, NOVA, `10.92.${i}.1`)).toMatchObject({ status: 429 });
      const a = (await bloqueios()).filter((x) => x.actorId === u.id);
      expect(a.length).toBe(1);
      expect(JSON.stringify(await t.db.select().from(schema.auditLog))).not.toContain('errada-0-errada-xx');
      // passada a janela, a senha certa volta a valer na rota e zera o contador
      clock = new Date(`2026-11-25T0${i}:16:00Z`);
      expect((await handle(req('/two-factor/get-totp-uri', { password: PASSWORD }, u.cookie, `10.93.${i}.1`))).status).toBe(200);
    });
  }

  it('erros somam entre a troca e as rotas do 2º fator (3 na troca + 2 em rotas = bloqueio)', async () => {
    clock = new Date('2026-11-25T08:00:00Z');
    const u = await usuarioMfa();
    for (let n = 0; n < 3; n++) await trocar(u.cookie, `errada-${n}-errada-xx`, NOVA, NOVA, `10.94.0.${n}`);
    expect((await handle(req('/two-factor/get-totp-uri', { password: 'errada-x-errada-xx' }, u.cookie, '10.94.1.1'))).status).toBe(400);
    expect((await handle(req('/two-factor/generate-backup-codes', { password: 'errada-y-errada-xx' }, u.cookie, '10.94.1.2'))).status).toBe(400);
    expect((await handle(req('/two-factor/enable', { password: PASSWORD }, u.cookie, '10.94.1.3'))).status).toBe(429);
  });

  it('por IP: 5 erradas de um IP nas rotas bloqueiam outra conta nesse IP; senha certa não gasta tentativa', async () => {
    clock = new Date('2026-11-25T09:00:00Z');
    const a = await usuarioMfa();
    const b = await usuarioMfa();
    const ip = '10.95.5.5';
    for (let n = 0; n < 10; n++) expect((await handle(req('/two-factor/get-totp-uri', { password: PASSWORD }, a.cookie, ip))).status).toBe(200);
    for (let n = 0; n < 5; n++) await handle(req('/two-factor/get-totp-uri', { password: `errada-${n}-errada-xx` }, a.cookie, ip));
    expect((await handle(req('/two-factor/get-totp-uri', { password: PASSWORD }, b.cookie, ip))).status).toBe(429);
    expect((await handle(req('/two-factor/get-totp-uri', { password: PASSWORD }, b.cookie, '10.95.5.6'))).status).toBe(200);
  });
});
