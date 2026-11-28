// Shadow ao vivo do roteador de scraping no worker da fábrica (só medição): desligado por padrão, observa leituras diretas e via provedor,
// nunca altera o resultado do coletor nem grava nada no banco de matérias, e o job espera a fila da sombra. Sem rede real, sem custo.
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { createTestDb, isRealTestDb } from '@ln/db/testing';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { SourceRegistry, reviewSource, setSourceEnabled, shadowReader, type ReaderPort, type ShadowPort, type Source } from '@ln/editorial';
import { BudgetGate, MemoryLedgerStore, SimulatedOpenRouterClient, gateConfigFromPolicy, loadPolicyFile, type ModelPolicy } from '@ln/modelops';
import { PgEditorialStore } from './editorial-store';
import { loadShadow, runEditorialFactory, type ModelopsTransportOptions } from './editorial-factory';
import { FakeResolver, MOCK_ARTICLE_ALFA, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher } from '../../../packages/editorial/fixtures/mock-web.mock';

let template: Blob | File | undefined;
async function freshDb(): Promise<{ db: Db; client: PGlite }> {
  if (isRealTestDb()) {
    const t = await createTestDb(); // PostgreSQL real: banco clonado do modelo; client.close() apaga o banco
    return { db: t.db as unknown as Db, client: t.client as unknown as PGlite };
  }
  if (!template) { const base = await createTestDb(); template = await base.client.dumpDataDir('none'); await base.close(); }
  const client = new PGlite({ loadDataDir: template });
  await client.waitReady;
  return { db: drizzle(client, { schema }) as unknown as Db, client };
}
const POLICY = loadPolicyFile(fileURLToPath(new URL('../../../packages/modelops/fixtures/model.policy.proposto-DP02-v5.json', import.meta.url))).policy as ModelPolicy;
const NOW = new Date('2026-11-25T12:00:00-03:00');
const gateway = (): ModelopsTransportOptions => ({ deps: { policy: POLICY, gate: new BudgetGate(gateConfigFromPolicy(POLICY), new MemoryLedgerStore()), client: new SimulatedOpenRouterClient() }, mode: 'simulation', qualifiedModelIds: [], zdrVerifiedModelIds: [] } as unknown as ModelopsTransportOptions);

const SRC: Source = {
  ...MOCK_SOURCE, enabled: false, termsStatus: 'pending', urlVerified: false,
  verification: { level: 'lido', researchedBy: 'ln-editorial-engineer', robots: 'permitido', robotsNote: 'MOCK', termsExcerpt: null, termsFetchedAt: null, consultedAt: null, imageRightsNote: 'x', notes: 'x' },
};
const registry = () => new SourceRegistry([SRC]);
const web = () => new MockFetcher({
  'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow:',
  'https://ri.mock.example/feed.xml': '<rss><channel><item><title>MOCK</title><link>https://ri.mock.example/noticias/alfa-parceria</link></item></channel></rss>',
  'https://ri.mock.example/noticias/alfa-parceria': MOCK_ARTICLE_ALFA,
});
async function enable(db: Db): Promise<PgEditorialStore> {
  const store = new PgEditorialStore(db);
  const ctx = (userId: string, role: string) => ({ actor: { userId, roles: [role], mfa: true }, store, sources: registry(), now: () => NOW, newId: () => 'id' });
  expect((await reviewSource(ctx('maria-chefe', 'editor_chefe'), { sourceId: 'mock-ri', termsStatus: 'approved', termsNote: 'Termos oficiais lidos pelo revisor responsável.', urlVerified: true, robotsChecked: true, paywall: 'none' })).status).toBe(200);
  expect((await setSourceEnabled(ctx('joao-admin', 'admin'), { sourceId: 'mock-ri', enabled: true })).status).toBe(200);
  return store;
}
const base = (db: Db, over: Record<string, unknown> = {}) => ({
  db, dryRun: false, flags: { editorialCollector: true, editorialPipeline: true }, registry: registry(), fetcher: web(), resolver: new FakeResolver({ 'ri.mock.example': [[MOCK_PUBLIC_IP]] }),
  collectorOptions: { minSpacingMs: 0 }, collectorGuards: {}, now: () => NOW, gateway: gateway(), ...over,
});

class FakeShadow implements ShadowPort {
  seen: Array<{ url: string; name: string; status: number; bodyLen: number; ms: number }> = [];
  drained = false; pending = 0;
  constructor(private readonly throwOnObserve = false) {}
  observe(url: string, o: { name: string; status: number; body?: string; ms: number }): void {
    if (this.throwOnObserve) throw new Error('sombra quebrada');
    this.seen.push({ url, name: o.name, status: o.status, bodyLen: o.body?.length ?? 0, ms: o.ms });
    this.pending++;
  }
  async drain(): Promise<void> { await new Promise((r) => setTimeout(r, 20)); this.pending = 0; this.drained = true; }
}

describe('shadow ao vivo no worker (só medição)', () => {
  it('ligado: observa a leitura direta da matéria (não robots nem feed), o job espera o drain e o resultado é IGUAL ao de sem sombra', async () => {
    const a = await freshDb(); const b = await freshDb();
    try {
      await enable(a.db); await enable(b.db);
      const shadow = new FakeShadow();
      const withShadow = await runEditorialFactory({ ...base(a.db), shadow });
      const without = await runEditorialFactory({ ...base(b.db) });
      expect(shadow.seen.map((s) => s.url)).toEqual(['https://ri.mock.example/noticias/alfa-parceria']);
      expect(shadow.seen[0]).toMatchObject({ name: 'direct', status: 200 });
      expect(shadow.seen[0]!.bodyLen).toBeGreaterThan(100);
      expect(shadow.drained).toBe(true); expect(shadow.pending).toBe(0);
      const strip = (r: typeof withShadow) => ({ ...r, startedAt: '', articles: r.articles.map((x) => ({ ...x, articleId: x.articleId })) });
      expect(strip(withShadow)).toEqual(strip(without));
      // nada da sombra foi para o banco de matérias: mesmas matérias e mesma trilha de auditoria
      const sa = new PgEditorialStore(a.db); const sb = new PgEditorialStore(b.db);
      expect((await sa.listArticles()).map((x) => x.status)).toEqual((await sb.listArticles()).map((x) => x.status));
      expect((await sa.listAudit()).map((x) => x.action).sort()).toEqual((await sb.listAudit()).map((x) => x.action).sort());
    } finally { await a.client.close(); await b.client.close(); }
  });

  it('sombra que lança em observe e em drain nunca derruba o job nem muda o resultado', async () => {
    const { db, client } = await freshDb();
    try {
      await enable(db);
      const bad: ShadowPort = { observe: () => { throw new Error('x'); }, drain: async () => { throw new Error('y'); } };
      const r = await runEditorialFactory({ ...base(db), shadow: bad });
      expect(r.articles).toHaveLength(1);
      expect(r.haltedBy).toBe('model_disabled'); // igual ao baseline sem sombra: o gateway simulado recusa; a sombra não muda nada
    } finally { await client.close(); }
  });

  it('desligado (sem sombra): nenhum efeito; dry-run também espera o drain quando há sombra', async () => {
    const { db, client } = await freshDb();
    try {
      await enable(db);
      const shadow = new FakeShadow();
      const r = await runEditorialFactory({ ...base(db, { dryRun: true }), shadow });
      expect(r.dryRun).toBe(true); expect(shadow.drained).toBe(true); expect(shadow.seen).toHaveLength(1);
      const off = await runEditorialFactory({ ...base(db, { dryRun: true }) });
      expect(off.articles.map((x) => x.status)).toEqual(r.articles.map((x) => x.status));
    } finally { await client.close(); }
  });
});

describe('shadowReader (leitura via provedor DP-31/DP-32)', () => {
  it('devolve EXATAMENTE o resultado do leitor atual, preserva discover, observa uma vez e engole erro da sombra', async () => {
    const calls: string[] = [];
    const primary: ReaderPort = { name: 'tavily', unlocks: false, read: async (u) => { calls.push(u); return { status: 200, body: 'corpo', format: 'text' }; }, discover: async () => [{ url: 'https://x.example/a' }] };
    const shadow = new FakeShadow();
    const r = shadowReader(primary, shadow)!;
    expect(await r.read('https://x.example/a')).toEqual({ status: 200, body: 'corpo', format: 'text' });
    expect(calls).toEqual(['https://x.example/a']);
    expect(shadow.seen).toMatchObject([{ url: 'https://x.example/a', name: 'tavily', status: 200, bodyLen: 5 }]);
    expect(await r.discover!({} as Source, 3)).toEqual([{ url: 'https://x.example/a' }]);
    expect(r.name).toBe('tavily'); expect(r.unlocks).toBe(false);
    const quebrada = shadowReader(primary, new FakeShadow(true))!;
    expect(await quebrada.read('https://x.example/b')).toEqual({ status: 200, body: 'corpo', format: 'text' });
    // exceção do leitor ATUAL é repassada UMA vez, sem segunda leitura
    let n = 0;
    const falha: ReaderPort = { name: 'f', read: async () => { n++; throw new Error('rede'); } };
    await expect(shadowReader(falha, shadow)!.read('https://x.example/c')).rejects.toThrow('rede');
    expect(n).toBe(1);
    expect(shadowReader(primary, undefined)).toBe(primary); expect(shadowReader(undefined, shadow)).toBeUndefined();
  });
});

describe('loadShadow (SCRAPING_SHADOW_MODE)', () => {
  it('desligado por padrão: não carrega o pacote; ligado sem o pacote/fábrica recusa começar; ligado com a fábrica devolve a porta', async () => {
    let imports = 0;
    const importer = async () => { imports++; return { createLiveShadowFromEnv: (env: Record<string, string | undefined>) => ({ observe: () => {}, drain: async () => {}, env }) }; };
    expect(await loadShadow({}, importer)).toBeUndefined();
    expect(await loadShadow({ SCRAPING_SHADOW_MODE: 'false' }, importer)).toBeUndefined();
    expect(await loadShadow({ SCRAPING_SHADOW_MODE: 'TRUE' }, importer)).toBeUndefined(); // só a string exata "true"
    expect(imports).toBe(0);
    await expect(loadShadow({ SCRAPING_SHADOW_MODE: 'true' }, async () => { throw new Error('não existe'); })).rejects.toThrow(/não está disponível/);
    await expect(loadShadow({ SCRAPING_SHADOW_MODE: 'true' }, async () => ({}))).rejects.toThrow(/createLiveShadowFromEnv/);
    const port = await loadShadow({ SCRAPING_SHADOW_MODE: 'true', SCRAPING_SHADOW_SINK: '/tmp/x.jsonl' }, importer);
    expect(imports).toBe(1); expect((port as unknown as { env: Record<string, string> }).env['SCRAPING_SHADOW_SINK']).toBe('/tmp/x.jsonl');
  });
});
