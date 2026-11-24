// Envelope HTTP da troca da própria senha (POST /api/studio/conta/senha): origem, corpo, cookies da sessão nova, 401/400/429.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { createAuth, createAuthHandler, createStaffUser, sessionFromHeaders, type Db } from '@ln/auth';
import { createTestDb } from '@ln/db/testing';
import { mesmaOrigem, trocarSenhaHandler } from './conta-senha';

const ORIGIN = 'http://localhost:3000';
const SENHA = 'senha-longa-de-teste-1';
const NOVA = 'nova-senha-muito-longa-9';
let t: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let auth: ReturnType<typeof createAuth>;
let handle: (r: Request) => Promise<Response>;
let seq = 0;
const clock = { now: new Date('2026-11-24T12:00:00Z') };

beforeAll(async () => {
  t = await createTestDb();
  db = t.db as unknown as Db;
  auth = createAuth({ db, secret: 'k'.repeat(40), baseURL: ORIGIN });
  handle = createAuthHandler({ auth, db });
});
afterAll(async () => {
  await t.close();
});

const cookieOf = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter((c) => c && !c.endsWith('='))
    .join('; ');
const authReq = (path: string, body: unknown, cookie?: string) =>
  new Request(`${ORIGIN}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
async function totpAgora(raw: Uint8Array, cookie: string) {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
  try {
    return await handle(authReq('/two-factor/verify-totp', { code: await createOTP(raw).totp() }, cookie));
  } finally {
    vi.useRealTimers();
  }
}

async function sessaoMfa(): Promise<string> {
  const email = `conta${++seq}@ln.test`;
  await createStaffUser(auth, { email, name: 'Conta', password: SENHA, role: 'leitor' });
  const c0 = cookieOf(await handle(authReq('/sign-in/email', { email, password: SENHA })));
  const { totpURI } = (await (await handle(authReq('/two-factor/enable', { password: SENHA }, c0))).json()) as { totpURI: string };
  const raw = base32.decode(new URL(totpURI).searchParams.get('secret')!.toUpperCase());
  await totpAgora(raw, c0);
  const login = await handle(authReq('/sign-in/email', { email, password: SENHA }));
  return cookieOf(await totpAgora(raw, cookieOf(login)));
}

const post = (body: unknown, cookie?: string, extra: Record<string, string> = { origin: ORIGIN, host: 'localhost:3000' }) =>
  trocarSenhaHandler(
    new Request(`${ORIGIN}/api/studio/conta/senha`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra, ...(cookie ? { cookie } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) }),
    { auth, db, now: () => clock.now, trustedProxyHops: 0 },
  );

describe('mesmaOrigem', () => {
  it('aceita Origin com o host da requisição ou do proxy; recusa ausente, outro host e lixo', () => {
    expect(mesmaOrigem(new Headers({ origin: 'https://studio.ln.test', host: 'studio.ln.test' }))).toBe(true);
    expect(mesmaOrigem(new Headers({ origin: 'https://studio.ln.test', host: 'app:3000', 'x-forwarded-host': 'studio.ln.test' }))).toBe(true);
    expect(mesmaOrigem(new Headers({ host: 'studio.ln.test' }))).toBe(false);
    expect(mesmaOrigem(new Headers({ origin: 'https://mal.example', host: 'studio.ln.test' }))).toBe(false);
    expect(mesmaOrigem(new Headers({ origin: 'null', host: 'studio.ln.test' }))).toBe(false);
  });
});

describe('POST /api/studio/conta/senha', () => {
  it('sucesso: 200 em pt-BR, sem cache, devolve o cookie da sessão nova (a antiga cai)', async () => {
    const cookie = await sessaoMfa();
    const r = await post({ senhaAtual: SENHA, novaSenha: NOVA, confirmacao: NOVA }, cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: true, mensagem: 'Senha trocada. As outras sessões foram encerradas.' });
    expect(await sessionFromHeaders(auth, new Headers({ cookie }))).toBeNull();
    expect(await sessionFromHeaders(auth, new Headers({ cookie: cookieOf(r) }))).not.toBeNull();
  });

  it('senha atual errada: 400 INVALID_CURRENT_PASSWORD; política: 400 VALIDATION_ERROR com a lista', async () => {
    const cookie = await sessaoMfa();
    const r = await post({ senhaAtual: 'errada-errada-errada', novaSenha: NOVA, confirmacao: NOVA }, cookie);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string; message: string } }).error).toMatchObject({ code: 'INVALID_CURRENT_PASSWORD', message: 'A senha atual está incorreta.' });
    const p = await post({ senhaAtual: SENHA, novaSenha: 'curta', confirmacao: 'curta' }, cookie);
    expect(p.status).toBe(400);
    expect(((await p.json()) as { error: { code: string; details: string[] } }).error).toMatchObject({ code: 'VALIDATION_ERROR', details: ['A nova senha precisa ter pelo menos 12 caracteres.'] });
  });

  it('5 erradas: 429 com Retry-After', async () => {
    const cookie = await sessaoMfa();
    for (let i = 0; i < 5; i++) await post({ senhaAtual: `errada-${i}-errada-xx`, novaSenha: NOVA, confirmacao: NOVA }, cookie);
    const r = await post({ senhaAtual: SENHA, novaSenha: NOVA, confirmacao: NOVA }, cookie);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('900');
  });

  it('sem sessão: 401; outra origem: 403; JSON inválido: 400; corpo grande: 413', async () => {
    expect((await post({ senhaAtual: SENHA, novaSenha: NOVA, confirmacao: NOVA })).status).toBe(401);
    const cookie = await sessaoMfa();
    expect((await post({ senhaAtual: SENHA, novaSenha: NOVA, confirmacao: NOVA }, cookie, { origin: 'https://mal.example', host: 'localhost:3000' })).status).toBe(403);
    expect((await post({ senhaAtual: SENHA, novaSenha: NOVA, confirmacao: NOVA }, cookie, { host: 'localhost:3000' })).status).toBe(403);
    expect((await post('{nao-json', cookie)).status).toBe(400);
    expect((await post({ senhaAtual: 'x'.repeat(5000) }, cookie)).status).toBe(413);
  });
});
