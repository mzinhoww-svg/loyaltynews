import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import { createAuth, createAuthHandler, createStaffUser } from './index';
import { ALLOWED, AUTH_ROUTE_POLICY } from './handler';

// Decisão do PM (25/11): o Better Auth NÃO grava IP na sessão nem limita por IP (disableIpTracking). Condição do QA 6: o limite do PRÓPRIO app cobre toda rota de /api/auth
// que adivinha credencial, com teste. Este arquivo prova (1) que toda rota liberada tem política declarada, (2) que as de credencial bloqueiam de fato com o Better Auth sem
// rastreio de IP e (3) que a sessão não guarda IP.
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'senha-longa-de-teste-1';
let t: Awaited<ReturnType<typeof createTestDb>>;
let auth: ReturnType<typeof createAuth>;
let handle: (r: Request) => Promise<Response>;
let clock = new Date('2026-11-25T12:00:00Z');
let seq = 0;

beforeAll(async () => {
  t = await createTestDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = t.db as any;
  auth = createAuth({ db, secret: 'x'.repeat(40), baseURL: ORIGIN });
  handle = createAuthHandler({ auth, db, now: () => clock, trustedProxyHops: 1 });
}, 120_000);
afterAll(async () => t.close());

const req = (path: string, init: { body?: unknown; cookie?: string; ip?: string; method?: string } = {}) =>
  new Request(`${ORIGIN}/api/auth${path}`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': init.ip ?? '10.0.0.1', ...(init.cookie ? { cookie: init.cookie } : {}) },
    body: init.method === 'GET' ? undefined : JSON.stringify(init.body ?? {}),
  });
const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c && !c.endsWith('=')).join('; ');
async function newUser() {
  const email = `cob${++seq}@ln.test`;
  const { id } = await createStaffUser(auth, { email, name: `Usuário ${seq}`, password: PASSWORD, role: 'editor' });
  return { id, email };
}

describe('toda rota liberada de /api/auth tem política de limite declarada', () => {
  it('AUTH_ROUTE_POLICY cobre exatamente as rotas de ALLOWED (rota nova sem decisão faz este teste falhar)', () => {
    expect(Object.keys(AUTH_ROUTE_POLICY).sort()).toEqual(ALLOWED.map((r) => r.path).sort());
    expect(new Set(Object.values(AUTH_ROUTE_POLICY))).toEqual(new Set(['login', '2fa', 'senha', 'sessao']));
  });

  it('as rotas de credencial (login, 2fa, senha) são exatamente as que o handler limita; as de sessão não recebem credencial para adivinhar', () => {
    const por = (k: string) => Object.entries(AUTH_ROUTE_POLICY).filter(([, v]) => v === k).map(([p]) => p).sort();
    expect(por('login')).toEqual(['/sign-in/email']);
    expect(por('2fa')).toEqual(['/two-factor/verify-backup-code', '/two-factor/verify-totp']);
    expect(por('senha')).toEqual(['/two-factor/disable', '/two-factor/enable', '/two-factor/generate-backup-codes', '/two-factor/get-totp-uri']);
    expect(por('sessao')).toEqual(['/get-session', '/list-sessions', '/revoke-other-sessions', '/revoke-session', '/revoke-sessions', '/sign-out']);
    // o código do handler declara as mesmas famílias (as constantes que ele usa para limitar)
    const fonte = readFileSync(new URL('./handler.ts', import.meta.url), 'utf8');
    for (const p of [...por('2fa'), ...por('senha')]) expect(fonte, p).toContain(`'${p}'`);
    expect(fonte).toContain("path === '/sign-in/email'");
  });

  it('o bloqueio de cada rota de senha está provado em change-password.test.ts (uma por rota) e o de login e 2º fator em auth.test.ts', () => {
    const cp = readFileSync(new URL('./change-password.test.ts', import.meta.url), 'utf8');
    for (const p of Object.entries(AUTH_ROUTE_POLICY).filter(([, v]) => v === 'senha').map(([k]) => k)) expect(cp, p).toContain(`'${p}'`);
    const at = readFileSync(new URL('./auth.test.ts', import.meta.url), 'utf8');
    expect(at).toContain("'/sign-in/email'");
    expect(at).toContain("'/two-factor/verify-totp'");
    expect(at).toContain("'/two-factor/verify-backup-code'");
  });
});

describe('o Better Auth está SEM rastreio de IP e o limite do app bloqueia sozinho', () => {
  it('a opção está ligada e a sessão nasce SEM ip_address (mesmo com X-Forwarded-For)', async () => {
    expect((auth.options as { advanced?: { ipAddress?: { disableIpTracking?: boolean } } }).advanced?.ipAddress?.disableIpTracking).toBe(true);
    const u = await newUser();
    const r = await handle(req('/sign-in/email', { body: { email: u.email, password: PASSWORD }, ip: '203.0.113.99' }));
    expect(r.status).toBe(200);
    const rows = await t.client.query<{ ip_address: string | null }>('SELECT ip_address FROM auth_session WHERE user_id = $1', [u.id]);
    expect(rows.rows.length).toBeGreaterThan(0);
    // com o rastreio desligado o Better Auth grava texto vazio (não NULL): nenhum IP
    for (const s of rows.rows) expect(s.ip_address ?? '').toBe('');
    expect(JSON.stringify((await t.client.query('SELECT * FROM auth_session WHERE user_id = $1', [u.id])).rows)).not.toContain('203.0.113.99');
  });

  it('login: 5 falhas do mesmo IP (contas diferentes) → 6ª é 429 com Retry-After (limite por IP do app, sem o do Better Auth)', async () => {
    clock = new Date('2026-11-25T12:00:00Z');
    const alvo = await newUser();
    for (let i = 0; i < 5; i++) expect((await handle(req('/sign-in/email', { body: { email: `x${i}@ln.test`, password: 'errada-errada-1' }, ip: '198.51.100.20' }))).status).toBe(401);
    const r = await handle(req('/sign-in/email', { body: { email: alvo.email, password: PASSWORD }, ip: '198.51.100.20' }));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('2º fator: 5 códigos errados do mesmo IP → 6ª é 429 (verify-totp e verify-backup-code dividem o contador)', async () => {
    clock = new Date('2026-11-25T13:00:00Z');
    for (let i = 0; i < 3; i++) await handle(req('/two-factor/verify-totp', { body: { code: '000000' }, ip: '198.51.100.30' }));
    for (let i = 0; i < 2; i++) await handle(req('/two-factor/verify-backup-code', { body: { code: 'aaaa-bbbb' }, ip: '198.51.100.30' }));
    expect((await handle(req('/two-factor/verify-totp', { body: { code: '000000' }, ip: '198.51.100.30' }))).status).toBe(429);
    expect((await handle(req('/two-factor/verify-backup-code', { body: { code: 'aaaa-bbbb' }, ip: '198.51.100.30' }))).status).toBe(429);
  });

  it('rota de senha (/two-factor/enable): 5 senhas erradas → 429 (a sessão não revela IP; o contador é por usuário)', async () => {
    clock = new Date('2026-11-25T14:00:00Z');
    const u = await newUser();
    const cookie = cookieOf(await handle(req('/sign-in/email', { body: { email: u.email, password: PASSWORD }, ip: '198.51.100.40' })));
    for (let i = 0; i < 5; i++) expect((await handle(req('/two-factor/enable', { body: { password: `errada-${i}-errada-xx` }, cookie, ip: `198.51.100.${50 + i}` }))).status).toBe(400);
    const b = await handle(req('/two-factor/enable', { body: { password: PASSWORD }, cookie, ip: '198.51.100.90' }));
    expect(b.status).toBe(429);
    expect(b.headers.get('retry-after')).toBe('900');
  });

  it('o banco só tem o HMAC (nenhum dos IPs usados aparece em auth_attempt, auth_session ou audit_log)', async () => {
    const dump = JSON.stringify([
      (await t.client.query('SELECT * FROM auth_attempt')).rows,
      (await t.client.query('SELECT * FROM auth_session')).rows,
      (await t.client.query('SELECT ip FROM audit_log')).rows,
    ]);
    for (const ip of ['203.0.113.99', '198.51.100.20', '198.51.100.30', '198.51.100.40']) expect(dump, ip).not.toContain(ip);
    void schema;
  });
});
