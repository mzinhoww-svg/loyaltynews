// RODADA SIMULADA LOCAL (Frente 06): primeira matéria a partir de Agência Senado e Câmara dos Deputados, ponta a ponta, num
// PostgreSQL REAL local (não PGlite): fonte habilitada → coleta real (leitura pública, 1 requisição por URL, robots respeitado) →
// rascunho de MODELO SIMULADO → checagem simulada em "provedor" distinto → aprovada → RECIBO pela rota oficial.
// NÃO chama modelo real, NÃO publica (publicacaoPortal desligada e o conteúdo SIMULADO é recusado por regra).
// Só roda com LN_LOCAL_PG_URL, e só para banco LOCAL e DESCARTÁVEL (host localhost/127.0.0.1/::1, nome com prefixo de teste: ver fixtures/local-pg-guard.mock.ts);
// recria o banco a cada execução (DROP DATABASE).
// Saída: packages/editorial/docs/rodada-simulada/*.json (pacote por matéria + dados da rodada).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { base32 } from '@better-auth/utils/base32';
import { createOTP } from '@better-auth/utils/otp';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EDITORIAS, FLAG_DEFAULTS } from '@ln/contracts';
import { createAuth, createAuthHandler, createStaffUser, type Db, type Role } from '@ln/auth';
import { schema } from '@ln/db';
import { runMigrations } from '@ln/db/migrate';
import {
  Collector, InMemoryAuditLog, SourceRegistry, SEED_SOURCES, USER_AGENT, createHttpPublishingPort, createLlmGateway, createNodeFetcher,
  draftContentSha256, isAllowedByRobots, parseRobots, publishApproved, runDeterministicChecks, runFactory, systemResolver,
  type HttpTransport,
} from '@ln/editorial';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { call } from '../_lib/testkit';
import { setDepsForTest, type Deps } from '../_lib/deps';
import * as recibosRoute from '../materias/[id]/recibos/route';
import * as pubOne from '../publico/materias/[slug]/route';
import { dispatchEditorial as d, setStoreFactoryForTest } from '../_lib/editorial';
import { assertLocalDisposablePg } from '../../../../../packages/editorial/fixtures/local-pg-guard.mock';
import { SimulatedEditorialModel } from '../../../../../packages/editorial/fixtures/simulated-model.mock';

const URL_LOCAL = process.env['LN_LOCAL_PG_URL'];
const OUT = fileURLToPath(new URL('../../../../../packages/editorial/docs/rodada-simulada/', import.meta.url));
const STU = '/api/studio/editorial';
const SITE = 'https://loyaltynews.example';
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'senha-longa-de-teste-1';
const FLAGS = { editorialCollector: true, editorialPipeline: true } as const;
const SOURCES = ['senado-noticias', 'camara-noticias'] as const;
const AI_AGENTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'CCBot', 'Bytespider', 'Omgilibot', 'FacebookBot'];
const NOTA = 'ENSAIO LOCAL (simulado): revisão registrada pelo roteiro de ensaio; NÃO é a revisão real do proprietário. Termos conforme docs/termos-fontes.md, classe A.';

describe.skipIf(!URL_LOCAL)('rodada simulada local (PostgreSQL real, modelo simulado, sem publicar)', () => {
  let pool: pg.Pool; let db: Db; let store: PgEditorialStore;
  let chefe: { id: string; cookie: string }; let admin: { id: string; cookie: string };
  const dados: Record<string, unknown> = { geradoEm: new Date().toISOString(), aviso: 'SIMULADO — ensaio local; nada foi publicado; nenhum modelo real foi chamado.' };
  const sim = new SimulatedEditorialModel('regulacao');
  const registry = new SourceRegistry(SEED_SOURCES);

  beforeAll(async () => {
    // Recusa, ANTES de conectar, qualquer destino que não seja local e descartável (a seguir há DROP DATABASE).
    const alvo = assertLocalDisposablePg(URL_LOCAL);
    const url = new URL(alvo.url);
    const dbName = alvo.dbName;
    const admUrl = new URL(URL_LOCAL!); admUrl.pathname = '/postgres';
    const adm = new pg.Client({ connectionString: admUrl.toString() });
    await adm.connect();
    await adm.query(`drop database if exists ${dbName} with (force)`);
    await adm.query(`create database ${dbName}`);
    const v = await adm.query('select version() as v');
    dados['postgres'] = { versao: String(v.rows[0].v).slice(0, 60), host: `${url.hostname}:${url.port}`, banco: dbName };
    await adm.end();
    await runMigrations({ DATABASE_URL: URL_LOCAL, CI: 'true', DB_SSL_MODE: 'disable' });
    pool = new pg.Pool({ connectionString: URL_LOCAL, max: 6 });
    db = drizzle(pool, { schema }) as unknown as Db;
    store = new PgEditorialStore(db);
    const auth = createAuth({ db, secret: 'k'.repeat(40), baseURL: ORIGIN });
    const handle = createAuthHandler({ auth, db });
    const deps: Deps = { db, auth, now: () => new Date(), flags: { ...FLAG_DEFAULTS } }; // TODAS as flags de publicação desligadas
    setDepsForTest(deps);
    await db.insert(schema.editorias).values(EDITORIAS.map((e) => ({ slug: e.slug, nome: e.nome })));
    const authReq = (path: string, body: unknown, cookie?: string) => new Request(`${ORIGIN}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '10.9.0.1', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    const cookieOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c && !c.endsWith('=')).join('; ');
    let seq = 0;
    const actor = async (role: Role) => {
      const email = `ensaio-${role}-${++seq}@ln.test`;
      const { id } = await createStaffUser(auth, { email, name: `Ensaio ${role}`, password: PASSWORD, role });
      const c0 = cookieOf(await handle(authReq('/sign-in/email', { email, password: PASSWORD })));
      const { totpURI } = (await (await handle(authReq('/two-factor/enable', { password: PASSWORD }, c0))).json()) as { totpURI: string };
      const raw = base32.decode(new URL(totpURI).searchParams.get('secret')!.toUpperCase());
      await handle(authReq('/two-factor/verify-totp', { code: await createOTP(raw).totp() }, c0));
      const login = await handle(authReq('/sign-in/email', { email, password: PASSWORD }));
      const v2 = await handle(authReq('/two-factor/verify-totp', { code: await createOTP(raw).totp() }, cookieOf(login)));
      return { id, cookie: cookieOf(v2) };
    };
    chefe = await actor('editor_chefe'); admin = await actor('admin');
  }, 180_000);
  afterAll(async () => { setStoreFactoryForTest(null); setDepsForTest(null); await pool?.end(); });

  it('1. banco real migrado e fontes do cadastro nascem desabilitadas', async () => {
    const n = ((await pool.query('select count(*)::int as n from information_schema.tables where table_schema = $1', ['public'])).rows as Array<{ n: number }>)[0]!.n;
    expect(n).toBeGreaterThan(20);
    dados['tabelas'] = n;
    expect((await store.listSourceStates())).toHaveLength(0);
    expect(registry.all().every((s) => !s.enabled)).toBe(true);
  });

  it('2. robots.txt reais (Senado e Câmara) lidos com o User-Agent da fábrica; agentes de IA analisados', async () => {
    const rows: Record<string, unknown>[] = [];
    for (const id of SOURCES) {
      const s = registry.get(id)!;
      const res = await fetch(`https://${s.host}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(25_000) });
      const txt = await res.text();
      const feedPath = new URL(s.feedUrl!).pathname;
      const agents = Object.fromEntries(AI_AGENTS.map((ua) => {
        const r = parseRobots(txt, ua);
        return [ua, { regrasEspecificas: r.ruleCount, feedPermitido: isAllowedByRobots(r, feedPath), listagemPermitida: isAllowedByRobots(r, new URL(s.listingUrl!).pathname) }];
      }));
      const ours = parseRobots(txt, USER_AGENT);
      rows.push({
        fonte: id, host: s.host, status: res.status, bytes: txt.length, crawlDelaySeg: ours.crawlDelaySec,
        fabrica: { feedPermitido: isAllowedByRobots(ours, feedPath), listagemPermitida: isAllowedByRobots(ours, new URL(s.listingUrl!).pathname), regrasDoGrupoNosso: ours.ruleCount },
        agentesDeIA: agents,
      });
      expect(res.status).toBe(200);
      expect(isAllowedByRobots(ours, feedPath)).toBe(true);
    }
    dados['robots'] = rows;
  }, 60_000);

  it('3. fonte habilitada pelas rotas oficiais do Studio (revisão e habilitação, gravadas no PostgreSQL)', async () => {
    for (const id of SOURCES) {
      const body = { termsStatus: 'approved', termsNote: NOTA, urlVerified: true, robotsChecked: true, paywall: 'none' };
      expect((await call(d, 'POST', { path: `${STU}/sources/${id}/review`, body, as: chefe as never })).status).toBe(200);
      const en = await call(d, 'POST', { path: `${STU}/sources/${id}/enabled`, body: { enabled: true }, as: admin as never });
      expect(en.status).toBe(200);
      expect((await store.getSourceState(id))?.enabled).toBe(true);
    }
    dados['fontesHabilitadas'] = (await store.listSourceStates()).map((s) => ({ id: s.sourceId, habilitada: s.enabled, revisor: s.review?.reviewer, em: s.review?.at }));
  });

  it('4. coleta REAL (1 requisição por URL, Crawl-delay, anti-SSRF) → redação simulada → checagem simulada → aprovada', async () => {
    const reports: unknown[] = [];
    for (const id of SOURCES) {
      const collector = new Collector(createNodeFetcher(), { minSpacingMs: 0, resolver: systemResolver, flags: FLAGS });
      const r = await runFactory({ store, registry, collector, gateway: createLlmGateway(sim), audit: new InMemoryAuditLog(), flags: FLAGS }, { onlySourceIds: [id], limitPerSource: 3, maxArticles: 1 });
      reports.push({ fonte: id, ...r });
    }
    dados['rodadas'] = reports;
    const todos = await store.listArticles();
    dados['resumo'] = { artigos: todos.length, aprovados: todos.filter((a) => a.status === 'aprovado').length, bloqueados: todos.filter((a) => a.status === 'bloqueado').length };
    expect(todos.length).toBeGreaterThan(0);
    expect(todos.some((a) => a.status === 'aprovado'), JSON.stringify(reports).slice(0, 1500)).toBe(true);
    for (const a of todos.filter((x) => x.status === 'aprovado')) {
      expect(a.draft!.modelProvider).not.toBe(a.factcheck!.provider);
      expect(a.draft!.headline.startsWith('SIMULADO: ')).toBe(true);
      expect(a.evidences[0]!.contentSha256).toMatch(/^[0-9a-f]{64}$/);
    }
  }, 180_000);

  it('5. RECIBO pela rota oficial (articles recebe o conteúdo aprovado); nada é publicado', async () => {
    const aprovados = (await store.listArticles()).filter((a) => a.status === 'aprovado');
    const pacotes: unknown[] = [];
    for (const a of aprovados) {
      const rc = await call(recibosRoute.POST, 'POST', { params: { id: a.articleId }, body: { checagens: [{ tipo: 'fatos', resultado: 'aprovado', autorModelo: a.factcheck!.provider }, { tipo: 'direitos', resultado: 'aprovado' }, { tipo: 'editor', resultado: 'aprovado' }] }, as: chefe as never });
      expect(rc.status, JSON.stringify(rc.body)).toBe(201);
      const sha = draftContentSha256(a);
      expect(rc.body.data.conteudoSha256).toBe(sha);
      const [art] = await db.select().from(schema.articles).where(eq(schema.articles.id, a.articleId));
      expect(art?.status).toBe('aprovado');
      const gate = runDeterministicChecks(a.draft!, a.evidences, { notices: [] });
      const src = registry.get(a.evidences[0]!.sourceId)!;
      const links = await db.select().from(schema.articleSources).where(eq(schema.articleSources.articleId, a.articleId));
      pacotes.push({
        AVISO: 'SIMULADO — ensaio local. Conteúdo gerado por modelo simulado; NÃO é matéria; NÃO publicar. A publicação é recusada por regra (simulated_content).',
        fonte: { id: src.id, nome: src.name, host: src.host, feedUrl: src.feedUrl, termos: 'docs/termos-fontes.md (classe A: reuso autorizado no texto, com atribuição)', habilitacao: 'revisão e habilitação registradas pelo roteiro de ensaio (simulado)' },
        evidencia: { id: a.evidences[0]!.id, url: a.evidences[0]!.url, canonicalUrl: a.evidences[0]!.canonicalUrl, capturadaEm: a.evidences[0]!.fetchedAt, sha256: a.evidences[0]!.contentSha256, titulo: a.evidences[0]!.title, textoInicio: a.evidences[0]!.text.slice(0, 600), caracteresDoTexto: a.evidences[0]!.text.length, suspeita: a.evidences[0]!.suspicious },
        rascunho: { slug: a.draft!.slug, titulo: a.draft!.headline, resumo: a.draft!.resumo, corpo: a.draft!.body, assinatura: a.draft!.signature, editoria: a.draft!.editoria, claims: a.draft!.claims, imagem: a.draft!.image, provedorDoRedator: a.draft!.modelProvider },
        checagem: { provedor: a.factcheck!.provider, modelo: a.factcheck!.model, veredictos: a.factcheck!.verdicts, independente: a.factcheck!.provider !== a.draft!.modelProvider },
        gate: { passou: gate.verdict === 'pass', achados: gate.findings },
        recibo: { id: rc.body.data.id, versao: rc.body.data.versao, conteudoSha256: rc.body.data.conteudoSha256, identidadeDePublicacao: rc.body.data.identidadePublicacao, igualAoHashDoRascunho: rc.body.data.conteudoSha256 === sha },
        articles: { id: art!.id, status: art!.status, slug: art!.slug, fontesLigadas: links.length },
        publicacao: { realizada: false, motivo: 'flag publicacaoPortal desligada; conteúdo SIMULADO é recusado por regra' },
      });
    }
    dados['pacotes'] = pacotes.length;
    mkdirSync(OUT, { recursive: true });
    pacotes.forEach((p, i) => writeFileSync(`${OUT}pacote-${(p as { fonte: { id: string } }).fonte.id}-${i + 1}.json`, JSON.stringify(p, null, 2) + '\n'));
    expect(pacotes.length).toBeGreaterThan(0);
  }, 120_000);

  it('6. publicação continua IMPOSSÍVEL: orquestrador recusa conteúdo simulado antes de qualquer chamada; Portal público não mostra nada', async () => {
    const transportCalls: string[] = [];
    const transport: HttpTransport = async (r) => { transportCalls.push(r.path); return { status: 500, body: null }; };
    const rep = await publishApproved({ store, port: createHttpPublishingPort(transport), siteBaseUrl: SITE, flags: { publicacaoPortal: true }, trigger: 'studio' });
    expect(rep.rows.length).toBeGreaterThan(0);
    expect(rep.rows.every((r) => r.outcome === 'failed' && r.code === 'simulated_content')).toBe(true);
    expect(transportCalls).toEqual([]);
    const off = await publishApproved({ store, port: createHttpPublishingPort(transport), siteBaseUrl: SITE, flags: {}, trigger: 'studio' });
    expect(off.rows.every((r) => r.outcome === 'waiting_flag')).toBe(true);
    for (const a of await store.listArticles()) {
      expect((await store.getArticle(a.articleId))?.status).not.toBe('publicado');
      expect((await call(pubOne.GET, 'GET', { params: { slug: a.draft?.slug ?? 'x' } })).status).toBe(404);
    }
    expect((await store.listOutbox())).toHaveLength(0);
    dados['publicacao'] = { orquestradorSemFlag: off.rows.map((r) => r.outcome), orquestradorComFlag: rep.rows.map((r) => r.code), chamadasHttp: transportCalls.length, outbox: 0 };
  });

  it('7. dados da rodada: tokens medidos nos prompts reais e custo projetado (limite superior, tarifas do contrato)', async () => {
    const policy = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../contracts/model.policy.json', import.meta.url)), 'utf8')) as { models: Array<{ id: string; input_peak: number | null; output_peak: number | null }> };
    const rate = (id: string) => { const m = policy.models.find((x) => x.id === id)!; return { in: m.input_peak ?? 0, out: m.output_peak ?? 0 }; };
    const por = sim.calls.map((c) => ({ estagio: c.taskClass, rota: c.route, tokensDeEntrada: c.estimate.promptTokens, tokensDeSaidaMax: c.estimate.maxOutputTokens, excluiProvedores: c.excludeProviders }));
    const cenario = (nome: string, map: Record<string, string>, tentativasDraft = 1) => {
      const itens = por.map((p) => ({ ...p, modelo: map[p.estagio] ?? map['*']!, mult: p.estagio === 'draft' ? tentativasDraft : 1 }));
      const usd = itens.reduce((s, p) => { const r = rate(p.modelo); return s + p.mult * ((p.tokensDeEntrada * r.in + p.tokensDeSaidaMax * r.out) / 1e6); }, 0);
      return { nome, modelos: map, usdPorMateriaLimiteSuperior: Number(usd.toFixed(4)), tentativasDeRedacao: tentativasDraft };
    };
    const n = (await store.listArticles()).length || 1;
    dados['custo'] = {
      premissas: 'tokens de ENTRADA medidos nos prompts reais com a evidência real (≈3,5 caracteres/token); tokens de SAÍDA = teto por estágio (limite superior); tarifas de contracts/model.policy.json (pico); inclui só as chamadas feitas nesta rodada (sem social/cargos); NÃO inclui cache nem reservas do gateway',
      estagios: por, materias: n,
      cenarios: [
        cenario('econômico (deepseek-flash; checagem em claude-haiku-5-5)', { '*': 'deepseek-flash', factcheck: 'claude-haiku-5-5' }),
        cenario('conservador (redação e revisão em claude-sonnet-5-5; checagem em deepseek-v4-pro)', { '*': 'deepseek-flash', draft: 'claude-sonnet-5-5', review: 'claude-sonnet-5-5', factcheck: 'deepseek-v4-pro' }),
        cenario('pior caso: conservador com 3 tentativas de redação', { '*': 'deepseek-flash', draft: 'claude-sonnet-5-5', review: 'claude-sonnet-5-5', factcheck: 'deepseek-v4-pro' }, 3),
      ],
    };
    writeFileSync(`${OUT}dados-da-rodada.json`, JSON.stringify(dados, null, 2) + '\n');
  });
});
