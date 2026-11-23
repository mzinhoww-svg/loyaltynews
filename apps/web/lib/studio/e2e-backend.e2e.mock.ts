// MOCK — backend de e2e: PGlite em memória com as migrações oficiais, Better Auth REAL e sessões com TOTP por papel.
// Só entra no build de e2e (LN_E2E_BUILD=1, alias `@ln-studio/e2e-backend`); o build de produção usa e2e-backend.prod.ts
// (nulo) e nunca contém este código (scripts/verify-no-mock.mjs prova). Mesmo no build de e2e só vale com
// LN_STUDIO_TEST_SESSION=1 (rota /api/e2e/login). O Studio e as rotas do Backend rodam sobre este banco como em produção.
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { drizzle } from 'drizzle-orm/pglite';
import { EDITORIAS } from '@ln/contracts';
import { createAuth, createAuthHandler, createStaffUser, isRole, type Db, type Role } from '@ln/auth';
import { setRuntimeForTest } from '@ln/auth/runtime';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { criarClientePglite } from './dev-db.e2e.mock';
import type { E2eBackend } from './e2e-backend.types';

const ORIGEM = 'http://localhost:3000';
const SENHA = 'senha-longa-de-teste-1';

async function montar() {
  const client = await criarClientePglite();
  const db = drizzle(client, { schema }) as unknown as Db;
  const auth = createAuth({ db, secret: 'k'.repeat(40), baseURL: ORIGEM });
  const handle = createAuthHandler({ auth, db });
  await db.insert(schema.editorias).values(EDITORIAS.map((e) => ({ slug: e.slug, nome: e.nome })));
  setRuntimeForTest({ db, auth, handle });

  // IP distinto por usuário de teste: o limitador do Better Auth (produção) conta por IP e rota e travaria rajadas de login.
  const req = (path: string, body: unknown, cookie: string | undefined, ip: string) =>
    new Request(`${ORIGEM}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGEM, 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const cookieDe = (r: Response) =>
    r.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .filter((c) => c && !c.endsWith('='))
      .join('; ');

  const cache = new Map<string, { setCookies: string[]; id: string }>();
  let seq = 0;

  async function criarUsuario(key: string, role: Role, comTotp: boolean) {
    const email = `${key}-${++seq}@ln.test`;
    const ip = `10.${(seq >> 8) & 255}.${seq & 255}.7`;
    const { id } = await createStaffUser(auth, { email, name: `Teste ${key}`, password: SENHA, role });
    const primeiro = await handle(req('/sign-in/email', { email, password: SENHA }, undefined, ip));
    if (!comTotp) return { id, setCookies: primeiro.headers.getSetCookie() };
    const c0 = cookieDe(primeiro);
    const en = await handle(req('/two-factor/enable', { password: SENHA }, c0, ip));
    const enTxt = await en.text();
    const totpURI = (JSON.parse(enTxt) as { totpURI?: string }).totpURI;
    if (!totpURI) throw new Error(`two-factor/enable falhou (${en.status}): ${enTxt.slice(0, 200)} | primeiro login ${primeiro.status} ${primeiro.headers.getSetCookie().length} cookies`);
    const raw = base32.decode(new URL(totpURI).searchParams.get('secret')!.toUpperCase());
    await handle(req('/two-factor/verify-totp', { code: await createOTP(raw).totp() }, c0, ip));
    const login = await handle(req('/sign-in/email', { email, password: SENHA }, undefined, ip));
    const v = await handle(req('/two-factor/verify-totp', { code: await createOTP(raw).totp() }, cookieDe(login), ip));
    return { id, setCookies: v.headers.getSetCookie() };
  }

  const backend: E2eBackend = {
    async seedEditorial() {
      const articleId = 'fabrica-e2e-1';
      const agora = new Date().toISOString();
      const evidencia = { id: 'ev-fabrica-1', sourceId: 'fonte-e2e', url: 'https://exemplo.com.br/fonte-oficial', canonicalUrl: 'https://exemplo.com.br/fonte-oficial', fetchedAt: agora, contentSha256: 'a'.repeat(64), title: 'Comunicado oficial', text: 'O Programa Alfa alterou a regra de pontos.', publishedAt: null, suspicious: false, suspiciousReasons: [] };
      await new PgEditorialStore(db).putArticle({
        articleId,
        editoria: 'pontos',
        status: 'em_checagem',
        draft: { id: 'rascunho-fabrica-1', editoria: 'pontos', headline: 'Programa Alfa altera regra de pontos (Fábrica)', body: 'O Programa Alfa alterou a regra de pontos.', claims: [{ id: 'c1', text: 'O Programa Alfa alterou a regra de pontos.', kind: 'fact', evidenceIds: [evidencia.id] }], evidenceIds: [evidencia.id], signature: 'Redação Loyalty News', image: { mode: 'none', reason: 'sem imagem' }, modelProvider: 'openai', promptVersion: 'e2e' },
        evidences: [evidencia],
        blockers: [],
        findings: [],
        reviews: [],
        recheckCount: 0,
        updatedAt: agora,
      });
      return { articleId };
    },
    async login(user, role, mfa) {
      if (!isRole(role)) throw new Error(`papel inválido: ${role}`);
      const key = `${user}:${role}:${mfa ? 'mfa' : 'nomfa'}`;
      let hit = cache.get(key);
      if (!hit) {
        hit = await criarUsuario(user, role, mfa);
        cache.set(key, hit);
      }
      return hit;
    },
  };
  return backend;
}

// Uma única montagem por processo (promessa memorizada na global: vale entre chunks do bundle).
const KEY = Symbol.for('ln.studio.e2e.backend');
type G = typeof globalThis & { [KEY]?: Promise<E2eBackend> };

export const e2eBackend: (() => Promise<E2eBackend>) | null = () => {
  const g = globalThis as G;
  g[KEY] ??= montar();
  return g[KEY];
};
