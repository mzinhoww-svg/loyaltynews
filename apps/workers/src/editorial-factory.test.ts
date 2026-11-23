// Composição da Fábrica editorial (apps/workers): flags restritas, transporte sobre @ln/modelops (simulado), dry-run seguro
// e modo simulado contra o PostgreSQL de teste. Nenhuma chamada real de modelo ou de rede.
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '@ln/db/testing';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { Collector, FlagDisabled, SourceRegistry, reviewSource, setSourceEnabled, type ChatRequest, type Source } from '@ln/editorial';
import { BudgetGate, MemoryLedgerStore, SimulatedOpenRouterClient, gateConfigFromPolicy, loadPolicyFile, type ModelPolicy } from '@ln/modelops';
import { PgEditorialStore } from './editorial-store';
import { createModelopsTransport, parseFactoryFlags, runEditorialFactory, type ModelopsTransportOptions } from './editorial-factory';
import { COLLECT_ON, FakeResolver, MOCK_ARTICLE_ALFA, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher } from '../../../packages/editorial/fixtures/mock-web.mock';

let template: Blob | File | undefined;
async function freshDb(): Promise<{ db: Db; client: PGlite }> {
  if (!template) {
    const base = await createTestDb();
    template = await base.client.dumpDataDir('none');
    await base.close();
  }
  const client = new PGlite({ loadDataDir: template });
  await client.waitReady;
  return { db: drizzle(client, { schema }) as unknown as Db, client };
}

const POLICY = loadPolicyFile(fileURLToPath(new URL('../../../packages/modelops/fixtures/model.policy.proposto-DP02-v5.json', import.meta.url))).policy as ModelPolicy;
const NOW = new Date('2026-11-25T12:00:00-03:00');
const QUALIFIED = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'openai-text-review', 'openai-text-review-alt'];
// ZDR confirmado para os candidatos (pré-requisito do staging: trabalho editorial NÃO publicado só roda em modelo com ZDR verificado)
const ZDR = QUALIFIED;

function opts(over: Partial<ModelopsTransportOptions> = {}): ModelopsTransportOptions & { client: SimulatedOpenRouterClient } {
  const client = new SimulatedOpenRouterClient();
  return { deps: { policy: POLICY, gate: new BudgetGate(gateConfigFromPolicy(POLICY), new MemoryLedgerStore()), client }, mode: 'simulation', qualifiedModelIds: QUALIFIED, zdrVerifiedModelIds: ZDR, now: () => NOW, client, ...over };
}
const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  taskClass: 'draft', route: 'review', workflow: 'WF02', idempotencyKey: 'k', promptVersion: 'p', excludeProviders: [],
  messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], estimate: { promptTokens: 1000, maxOutputTokens: 500 }, ...over,
});

describe('flags da fábrica', () => {
  it('só aceita a lista restrita; vazio = tudo desligado; nome estranho é erro', () => {
    expect(parseFactoryFlags(undefined)).toEqual({});
    expect(parseFactoryFlags('')).toEqual({});
    expect(parseFactoryFlags(' editorialCollector , editorialPipeline ')).toEqual({ editorialCollector: true, editorialPipeline: true });
    expect(() => parseFactoryFlags('instagram')).toThrow(/fora da lista/);
    expect(() => parseFactoryFlags('editorialCollector,rituais')).toThrow(/rituais/);
  });
});

describe('transporte sobre @ln/modelops', () => {
  it('mapeia tarefas do pipeline para o catálogo do gateway e responde pelo cliente SIMULADO (nunca dado real)', async () => {
    const o = opts();
    const t = createModelopsTransport(o);
    const r = await t.chat(req({ taskClass: 'draft' }));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.text).toBe('SIMULADO'); expect(r.provider).toBe(r.model.split('/')[0]); }
    expect(o.client.calls).toHaveLength(1);
    expect(o.client.calls[0]?.provider.data_collection).toBe('deny');
  });

  it('checagem independente: o provedor excluído (redator) não responde', async () => {
    const o = opts();
    const t = createModelopsTransport(o);
    const draft = await t.chat(req({ taskClass: 'draft' }));
    expect(draft.ok).toBe(true);
    const author = draft.ok ? draft.provider : '';
    const fc = await t.chat(req({ taskClass: 'factcheck', excludeProviders: [author] }));
    expect(fc.ok).toBe(true);
    if (fc.ok) expect(fc.provider).not.toBe(author);
  });

  it('sem ZDR verificado, trabalho editorial não publicado é BLOQUEADO (nenhuma chamada sai) — pré-requisito do staging', async () => {
    const o = opts({ zdrVerifiedModelIds: [] });
    const r = await createModelopsTransport(o).chat(req({ taskClass: 'draft' }));
    expect(r).toMatchObject({ ok: false, refusal: 'model_disabled' });
    expect(JSON.stringify(r)).toContain('no_eligible_candidate');
    expect(o.client.calls).toHaveLength(0);
  });

  it('social_pack não tem rota de modelo (composição determinística) e chamada de PRODUÇÃO com flag desligada é recusada sem sair nada', async () => {
    const o = opts();
    const t = createModelopsTransport(o);
    expect(await t.chat(req({ taskClass: 'social_pack' }))).toMatchObject({ ok: false, refusal: 'model_disabled' });
    const prod = createModelopsTransport({ ...o, mode: 'production' });
    expect(await prod.chat(req({ taskClass: 'draft' }))).toMatchObject({ ok: false, refusal: 'model_disabled' });
    expect(o.client.calls).toHaveLength(0);
  });
});

describe('execução da fábrica (PostgreSQL de teste)', () => {
  const SRC: Source = {
    ...MOCK_SOURCE, enabled: false, termsStatus: 'pending', urlVerified: false,
    verification: { level: 'lido', researchedBy: 'ln-editorial-engineer', robots: 'permitido', robotsNote: 'MOCK', termsExcerpt: null, termsFetchedAt: null, consultedAt: null, imageRightsNote: 'não informado', notes: 'MOCK' },
  };
  const registry = () => new SourceRegistry([SRC]);
  const collector = () => new Collector(
    new MockFetcher({ 'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow:', 'https://ri.mock.example/feed.xml': '<rss><channel><item><title>MOCK</title><link>https://ri.mock.example/noticias/alfa-parceria</link></item></channel></rss>', 'https://ri.mock.example/noticias/alfa-parceria': MOCK_ARTICLE_ALFA }),
    { now: () => NOW, resolver: new FakeResolver({ 'ri.mock.example': [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON },
  );
  async function enable(db: Db) {
    const store = new PgEditorialStore(db);
    const ctx = (userId: string, role: string) => ({ actor: { userId, roles: [role], mfa: true }, store, sources: registry(), now: () => NOW, newId: () => 'id' });
    expect((await reviewSource(ctx('maria-chefe', 'editor_chefe'), { sourceId: 'mock-ri', termsStatus: 'approved', termsNote: 'Termos oficiais lidos pelo revisor responsável.', urlVerified: true, robotsChecked: true, paywall: 'none' })).status).toBe(200);
    expect((await setSourceEnabled(ctx('joao-admin', 'admin'), { sourceId: 'mock-ri', enabled: true })).status).toBe(200);
    return store;
  }

  it('flags desligadas (padrão): a fábrica não roda nem em dry-run', async () => {
    const { db, client } = await freshDb();
    try { await expect(runEditorialFactory({ db, registry: registry(), collector: collector() })).rejects.toThrow(FlagDisabled); } finally { await client.close(); }
  });

  it('dry-run (padrão): coleta e relata sem modelo e sem gravar matéria', async () => {
    const { db, client } = await freshDb();
    try {
      const store = await enable(db);
      const r = await runEditorialFactory({ db, flags: { editorialCollector: true }, registry: registry(), collector: collector(), now: () => NOW });
      expect(r.dryRun).toBe(true);
      expect(r.articles.map((a) => a.status)).toEqual(['coletado (dry-run)']);
      expect(await store.listArticles()).toHaveLength(0);
    } finally { await client.close(); }
  });

  it('modo simulado: o texto SIMULADO nunca vira matéria (estágio recusa) e nada é publicado', async () => {
    const { db, client } = await freshDb();
    try {
      const store = await enable(db);
      const r = await runEditorialFactory({
        db, dryRun: false, flags: { editorialCollector: true, editorialPipeline: true }, registry: registry(), collector: collector(), now: () => NOW, gateway: opts(),
      });
      expect(r.articles).toHaveLength(1);
      expect(r.articles[0]).toMatchObject({ status: 'bloqueado', stages: ['triage'] });
      expect(r.articles[0]?.blockers).toContain('invalid_model_output');
      const rec = (await store.listArticles())[0]!;
      expect(rec.status).toBe('bloqueado');
      expect(rec.draft).toBeUndefined();
    } finally { await client.close(); }
  });

  it('recusas de segurança: modelo real sem ledger persistente e execução sem gateway', async () => {
    const { db, client } = await freshDb();
    try {
      await expect(runEditorialFactory({ db, dryRun: false, flags: { editorialCollector: true, editorialPipeline: true, modelosHabilitados: true }, gateway: opts() })).rejects.toThrow(/ledger/);
      await expect(runEditorialFactory({ db, dryRun: false, flags: { editorialCollector: true, editorialPipeline: true } })).rejects.toThrow(/gateway/);
    } finally { await client.close(); }
  });
});
