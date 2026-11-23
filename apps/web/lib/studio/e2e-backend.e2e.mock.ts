// MOCK — backend de e2e: PGlite em memória com as migrações oficiais, Better Auth REAL e sessões com TOTP por papel.
// Só entra no build de e2e (LN_E2E_BUILD=1, alias `@ln-studio/e2e-backend`); o build de produção usa e2e-backend.prod.ts
// (nulo) e nunca contém este código (scripts/verify-no-mock.mjs prova). Mesmo no build de e2e só vale com
// LN_STUDIO_TEST_SESSION=1 (rota /api/e2e/login). O Studio e as rotas do Backend rodam sobre este banco como em produção.
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { drizzle } from 'drizzle-orm/pglite';
import { EDITORIAS, FLAG_DEFAULTS, type FlagState } from '@ln/contracts';
import { setDepsForTest } from '@/app/api/_lib/deps';
import { createAuth, createAuthHandler, createStaffUser, isRole, type Db, type Role } from '@ln/auth';
import { getRuntime, setRuntimeForTest } from '@ln/auth/runtime';
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

  // Flags de e2e ficam numa global compartilhada: o Next carrega uma instância de deps.ts por rota/página, então cada
  // camada sincroniza a sua a partir daqui (sincronizar()), chamado na leitura da sessão do Studio e ao ligar uma flag.
  const aplicar = () => setDepsForTest({ db, auth, now: () => new Date(), flags: { ...FLAG_DEFAULTS, ...flagsGlobais() } as FlagState });

  const backend: E2eBackend = {
    setFlag(nome, ligada) {
      if (!(nome in FLAG_DEFAULTS)) throw new Error(`flag desconhecida: ${nome}`);
      flagsGlobais()[nome] = ligada;
      aplicar();
    },
    async seedEditorial() {
      const articleId = 'fabrica-e2e-1';
      const agora = new Date().toISOString();
      const evidencia = { id: 'ev-fabrica-1', sourceId: 'fonte-e2e', url: 'https://exemplo.com.br/fonte-oficial', canonicalUrl: 'https://exemplo.com.br/fonte-oficial', fetchedAt: agora, contentSha256: 'a'.repeat(64), title: 'Comunicado oficial', text: 'O Programa Alfa alterou a regra de pontos.', publishedAt: null, suspicious: false, suspiciousReasons: [] };
      await new PgEditorialStore(db).putArticle({
        articleId,
        editoria: 'pontos',
        status: 'em_checagem',
        draft: { id: 'rascunho-fabrica-1', editoria: 'pontos', headline: 'Programa Alfa altera regra de pontos (Fábrica)', slug: 'programa-alfa-altera-regra-de-pontos-fabrica', resumo: 'O Programa Alfa alterou a regra de pontos.', tipoConteudo: 'noticia', classeDeDado: 'public', patrocinado: false, body: 'O Programa Alfa alterou a regra de pontos.', claims: [{ id: 'c1', text: 'O Programa Alfa alterou a regra de pontos.', kind: 'fact', evidenceIds: [evidencia.id] }], evidenceIds: [evidencia.id], signature: 'Redação Loyalty News', image: { mode: 'none', reason: 'sem imagem' }, modelProvider: 'openai', promptVersion: 'e2e' },
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
const FLAGS_KEY = Symbol.for('ln.studio.e2e.flags');
const flagsGlobais = (): Record<string, boolean> => {
  const g = globalThis as unknown as Record<symbol, Record<string, boolean> | undefined>;
  return (g[FLAGS_KEY] ??= {});
};

/**
 * Aplica as flags de e2e à instância de deps DESTA camada do bundle (a função roda no módulo da camada que a chama; o runtime
 * de auth/banco vem da global compartilhada). No-op enquanto nenhuma flag foi alterada.
 */
export const sincronizarFlagsE2e: (() => void) | null = () => {
  const flags = flagsGlobais();
  const rt = getRuntime();
  if (!rt || Object.keys(flags).length === 0) return;
  setDepsForTest({ db: rt.db, auth: rt.auth, now: () => new Date(), flags: { ...FLAG_DEFAULTS, ...flags } as FlagState });
};

const KEY = Symbol.for('ln.studio.e2e.backend');
type G = typeof globalThis & { [KEY]?: Promise<E2eBackend> };

export const e2eBackend: (() => Promise<E2eBackend>) | null = () => {
  const g = globalThis as G;
  g[KEY] ??= montar();
  return g[KEY];
};
