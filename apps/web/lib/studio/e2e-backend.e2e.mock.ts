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
import { DEFAULT_CONFIG, addEvidence, addOrgRelation, processObservation, upsertOrganization, type Db as IntelDb } from '@ln/intelligence';
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
      // ADR-019: o caso de correção só abre sobre matéria JÁ PUBLICADA em `articles` (a Fábrica é a origem quando há registro editorial
      // com o mesmo id). Só para o e2e dos casos: a linha publicada é fictícia (MOCK), no banco de e2e.
      await db
        .insert(schema.articles)
        .values({ id: articleId, slug: 'programa-alfa-altera-regra-de-pontos-fabrica', titulo: 'Programa Alfa altera regra de pontos (Fábrica)', editoria: 'pontos', corpo: 'O Programa Alfa alterou a regra de pontos.', resumo: 'O Programa Alfa alterou a regra de pontos.', status: 'publicado', versao: 3, publicadoEm: new Date('2026-11-20T10:00:00Z') } as typeof schema.articles.$inferInsert)
        .onConflictDoNothing();
      return { articleId };
    },
    async seedIntelligence() {
      const idb = (await criarClientePglite()) as unknown as IntelDb;
      const cfg = { ...DEFAULT_CONFIG, personIngestion: true };
      const ALFA = 'MOCK Alfa Fidelidade S.A.';
      const BETA = 'MOCK Beta Cartões Ltda';
      const existente = await idb.query<{ id: string }>("SELECT id FROM intelligence.organization WHERE legal_name = $1", [ALFA]);
      const ev = (slug: string, nome: string, quando: string) => addEvidence(idb, { sourceUrl: `https://mock.invalid/${slug}`, sourceName: nome, retrievedAt: quando, isMock: true });
      if (!existente.rows[0]) {
        const d1 = '2026-10-01T12:00:00Z';
        const d2 = '2026-11-05T12:00:00Z';
        const e1 = await ev('ri-alfa-1', 'MOCK RI Alfa (oficial)', d1);
        const e2 = await ev('ri-alfa-2', 'MOCK RI Alfa (oficial, nova leitura)', d2);
        const e3 = await ev('linkedin-alfa', 'MOCK LinkedIn (secundária)', d2);
        const obs = (personName: string, title: string, evidenceId: string, observedAt: string, sourceLevel: 'oficial' | 'secundaria') => ({
          personName, publicProfileUrl: `https://mock.invalid/in/${personName.toLowerCase().replace(/[^a-z]+/g, '-')}`, orgName: ALFA, title, kind: 'present' as const, evidenceId, observedAt, sourceLevel,
        });
        await processObservation(idb, obs('MOCK Ana Souza', 'Diretora de Marketing', e1, d1, 'oficial'), cfg);
        await processObservation(idb, obs('MOCK Ana Souza', 'Diretora de CRM', e2, d2, 'oficial'), cfg); // title_change: Move detectado com antes e depois
        await processObservation(idb, obs('MOCK Bruno Lima', 'Diretor Financeiro', e1, d1, 'oficial'), cfg);
        await processObservation(idb, obs('MOCK Carla Dias', 'Gerente de Dados', e3, d2, 'secundaria'), cfg); // a confirmar
        await processObservation(idb, obs('MOCK Eva Rocha', 'Gerente de Parcerias', e3, d2, 'secundaria'), cfg); // a confirmar (será descartada no teste)
        const alfa = await upsertOrganization(idb, { legalName: ALFA, evidenceId: e1, observedAt: d1 });
        const beta = await upsertOrganization(idb, { legalName: BETA, evidenceId: e1, observedAt: d1 });
        await addOrgRelation(idb, { fromOrgId: alfa, toOrgId: beta, type: 'partner_of', validFrom: '2026-01-01', evidenceId: e1, observedAt: d1 });
      }
      const alfa = (await idb.query<{ id: string }>("SELECT id FROM intelligence.organization WHERE legal_name = $1", [ALFA])).rows[0]!.id;
      const beta = (await idb.query<{ id: string }>("SELECT id FROM intelligence.organization WHERE legal_name = $1", [BETA])).rows[0]!.id;
      // as pessoas são achadas pelo perfil público (estável): o nome muda quando um pedido do titular o corrige, e a pessoa removida continua com o mesmo perfil
      const idDe = async (slug: string) => (await idb.query<{ id: string }>('SELECT id FROM intelligence.person WHERE public_profile_url = $1', [`https://mock.invalid/in/${slug}`])).rows[0]!.id;
      return { alfa, beta, pessoa: await idDe('mock-ana-souza'), bruno: await idDe('mock-bruno-lima'), carla: await idDe('mock-carla-dias') };
    },
    async seedPautasProcessadas() {
      const store = new PgEditorialStore(db);
      const agora = new Date().toISOString();
      const existentes = new Set((await store.listAudit()).map((a) => a.target));
      const pauta = (id: string, titulo: string) => ({ id, titulo, angulo: 'Ângulo de teste (MOCK) com mais de vinte caracteres.', formato: 'analise', editoria: 'pontos', ancoras: ['https://exemplo.com.br/a', 'https://exemplo.com.br/b'] });
      const grava = async (id: string, titulo: string, resultado: Record<string, unknown>) => {
        if (existentes.has(id)) return;
        await store.appendAudit({ at: agora, userId: 'redacao-e2e', action: 'pauta.submitted', target: id, detail: JSON.stringify({ pauta: pauta(id, titulo) }) });
        await store.appendAudit({ at: agora, userId: null, action: 'pauta.processed', target: id, detail: JSON.stringify(resultado) });
      };
      await grava('pauta-e2e-aprovada', 'Pauta de teste aprovada (MOCK)', { status: 'aprovado', articleId: 'aut_e2e_aprovada', blockers: [], findings: [] });
      await grava('pauta-e2e-bloqueada', 'Pauta de teste bloqueada (MOCK)', { status: 'bloqueado', articleId: null, blockers: ['autoral_needs_anchors'], findings: ['âncora sem evidência coletada'] });
      return { aprovada: 'pauta-e2e-aprovada', bloqueada: 'pauta-e2e-bloqueada' };
    },
    async seedEditorialAprovada() {
      const articleId = 'fabrica-e2e-2';
      const dia = new Date().toISOString().slice(0, 10);
      const agora = new Date().toISOString();
      const evidencia = { id: 'ev-fabrica-2', sourceId: 'fonte-e2e', url: 'https://exemplo.com.br/fonte-oficial-2', canonicalUrl: 'https://exemplo.com.br/fonte-oficial-2', fetchedAt: agora, contentSha256: 'b'.repeat(64), title: 'Comunicado oficial 2', text: 'Comunicado ao mercado: a instituição informa novo valor de tarifa recorrente para a linha de plásticos, conforme tabela publicada em seu site institucional e válida a partir do ciclo seguinte.', publishedAt: null, suspicious: false, suspiciousReasons: [] };
      const draft = { id: 'rascunho-fabrica-2', editoria: 'pontos', headline: 'Banco Gama reduz anuidade do cartão (Fábrica)', slug: 'banco-gama-reduz-anuidade-fabrica', resumo: 'O Banco Gama reduziu a anuidade do cartão.', tipoConteudo: 'noticia', classeDeDado: 'public', patrocinado: false, body: `O Banco Gama reduziu a anuidade do cartão.

Fontes:
- Comunicado oficial 2: ${evidencia.url} (acessado em ${dia})`, claims: [{ id: 'c1', text: 'O Banco Gama reduziu a anuidade do cartão.', kind: 'fact', evidenceIds: [evidencia.id] }], evidenceIds: [evidencia.id], signature: 'Redação Loyalty News', image: { mode: 'none', reason: 'sem imagem' }, modelProvider: 'openai', promptVersion: 'e2e' };
      await new PgEditorialStore(db).putArticle({
        articleId,
        editoria: 'pontos',
        status: 'aprovado',
        draft,
        evidences: [evidencia],
        factcheck: { provider: 'anthropic', model: 'e2e', verdicts: [{ claimId: 'c1', verdict: 'pass' }] },
        blockers: [],
        findings: [],
        reviews: [],
        recheckCount: 0,
        updatedAt: agora,
      } as Parameters<PgEditorialStore['putArticle']>[0]);
      return { articleId, draft };
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

/** As mesmas flags de teste que as rotas enxergam (setFlag); o Studio as soma ao resolvedor de runtime SÓ no build de e2e. */
export const flagsE2e: (() => Record<string, boolean>) | null = () => ({ ...flagsGlobais() });

const KEY = Symbol.for('ln.studio.e2e.backend');
type G = typeof globalThis & { [KEY]?: Promise<E2eBackend> };

export const e2eBackend: (() => Promise<E2eBackend>) | null = () => {
  const g = globalThis as G;
  g[KEY] ??= montar();
  return g[KEY];
};
