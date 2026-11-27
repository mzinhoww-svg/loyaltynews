// Kit de teste das rotas: PGlite com migrações, Better Auth real e sessões com MFA por papel.
// Só para testes (não é importado por rota alguma).
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { vi } from 'vitest';
import { EDITORIAS, FLAG_DEFAULTS, type FlagState } from '@ln/contracts';
import { createAuth, createAuthHandler, createStaffUser, type Db, type Role } from '@ln/auth';
import { schema } from '@ln/db';
import { createTestDb } from '@ln/db/testing';
import type { BlobObject, BlobStore } from './blob';
import { setDepsForTest, type Deps } from './deps';

/** Armazenamento de arquivos em memória: SÓ para testes (produção usa S3BlobStore; sem configuração, 503). */
export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, BlobObject>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'senha-longa-de-teste-1';

export interface Actor {
  id: string;
  email: string;
  cookie: string;
}

export async function makeApp(flags: Partial<FlagState> = {}) {
  const t = await createTestDb();
  const db = t.db as unknown as Db;
  const auth = createAuth({ db, secret: 'k'.repeat(40), baseURL: ORIGIN });
  const handle = createAuthHandler({ auth, db });
  const clock = { now: new Date('2026-11-22T12:00:00Z') };
  const deps: Deps = { db, auth, now: () => clock.now, flags: { ...FLAG_DEFAULTS, ...flags } };
  setDepsForTest(deps);
  await db.insert(schema.editorias).values(EDITORIAS.map((e) => ({ slug: e.slug, nome: e.nome })));

  const authReq = (path: string, body: unknown, cookie?: string) =>
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '10.9.0.1', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const cookieOf = (r: Response) =>
    r.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .filter((c) => c && !c.endsWith('='))
      .join('; ');

  const cache = new Map<string, Actor>();
  let seq = 0;

  /**
   * Gera o código TOTP e o verifica no MESMO instante: o relógio (só `Date`) fica parado entre gerar e verificar, então o código nunca cai
   * na virada da janela de 30 s, por mais carregada que esteja a máquina. Sem retry. Se o teste já usa relógio falso, não mexe nele.
   */
  async function verifyTotp(raw: Uint8Array, cookie: string): Promise<Response> {
    const freeze = !vi.isFakeTimers();
    if (freeze) vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    try {
      return await handle(authReq('/two-factor/verify-totp', { code: await createOTP(raw).totp() }, cookie));
    } finally {
      if (freeze) vi.useRealTimers();
    }
  }

  /** Usuário do papel, com TOTP ativo e login completo (senha + código). Cache por chave. */
  async function actor(role: Role, key = role): Promise<Actor> {
    const hit = cache.get(key);
    if (hit) return hit;
    const email = `${key}-${++seq}@ln.test`;
    const { id } = await createStaffUser(auth, { email, name: `Teste ${key}`, password: PASSWORD, role });
    const first = await handle(authReq('/sign-in/email', { email, password: PASSWORD }));
    const c0 = cookieOf(first);
    const en = await handle(authReq('/two-factor/enable', { password: PASSWORD }, c0));
    const { totpURI } = (await en.json()) as { totpURI: string };
    const raw = base32.decode(new URL(totpURI).searchParams.get('secret')!.toUpperCase());
    await verifyTotp(raw, c0);
    const login = await handle(authReq('/sign-in/email', { email, password: PASSWORD }));
    const v = await verifyTotp(raw, cookieOf(login));
    const a = { id, email, cookie: cookieOf(v) };
    cache.set(key, a);
    return a;
  }

  /** Sessão só de senha, sem 2º fator ativo. */
  async function passwordOnly(role: Role): Promise<Actor> {
    const email = `solo-${++seq}@ln.test`;
    const { id } = await createStaffUser(auth, { email, name: 'Solo', password: PASSWORD, role });
    const r = await handle(authReq('/sign-in/email', { email, password: PASSWORD }));
    return { id, email, cookie: cookieOf(r) };
  }

  return { t, db, auth, deps, clock, actor, passwordOnly, close: async () => { setDepsForTest(null); await t.close(); } };
}

type Handler = (req: Request, ctx?: { params?: Promise<Record<string, string>> }) => Promise<Response>;

/** Chama um handler de rota como o Next chamaria. */
export async function call(
  handler: Handler,
  method: string,
  opts: { path?: string; body?: unknown; as?: Actor | null; params?: Record<string, string>; query?: Record<string, string>; ip?: string } = {},
): Promise<{ status: number; body: any; headers: Headers }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const url = new URL(`http://localhost:3000${opts.path ?? '/api/x'}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const res = await handler(
    new Request(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-forwarded-for': opts.ip ?? '10.9.0.2', ...(opts.as ? { cookie: opts.as.cookie } : {}) },
      body: opts.body === undefined || method === 'GET' ? undefined : JSON.stringify(opts.body),
    }),
    { params: Promise.resolve(opts.params ?? {}) },
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

/** Fonte + evidência prontas para citar numa matéria. */
export async function seedEvidence(db: Db, n = 1): Promise<string[]> {
  await db.insert(schema.sources).values({ id: 'src-1', nome: 'Fonte', url: 'https://example.org', tipo: 'site' }).onConflictDoNothing();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = `ev-${Math.random().toString(36).slice(2, 10)}`;
    await db.insert(schema.evidences).values({
      id,
      sourceId: 'src-1',
      url: `https://example.org/${id}`,
      capturadoEm: new Date('2026-11-20T10:00:00Z'),
      sha256: 'c'.repeat(64),
    });
    ids.push(id);
  }
  return ids;
}
