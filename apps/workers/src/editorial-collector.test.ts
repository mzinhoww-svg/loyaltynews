// Coleta contínua no worker sobre o PostgreSQL de teste, só com as migrações que já existem (prova de "sem migração nova"). Dados MOCK.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { createTestDb, isRealTestDb } from '@ln/db/testing';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { COLLECTOR_ROUND_ACTION, Collector, SourceRegistry, reviewSource, setSourceEnabled, type InboxRound, type Source } from '@ln/editorial';
import { COLLECT_ON, FakeResolver, MOCK_ARTICLE_ALFA, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher } from '../../../packages/editorial/fixtures/mock-web.mock';
import { roundLogLine, startEditorialCollector, type EditorialCollectorOptions } from './editorial-collector';
import { PgEditorialStore } from './editorial-store';

let template: Blob | File | undefined;
async function freshDb(): Promise<{ db: Db; client: PGlite }> {
  if (isRealTestDb()) {
    const t = await createTestDb();
    return { db: t.db as unknown as Db, client: t.client as unknown as PGlite };
  }
  if (!template) {
    const base = await createTestDb();
    template = await base.client.dumpDataDir('none');
    await base.close();
  }
  const client = new PGlite({ loadDataDir: template });
  await client.waitReady;
  return { db: drizzle(client, { schema }) as unknown as Db, client };
}

const NOW = new Date('2026-11-25T12:00:00-03:00');
const SRC: Source = {
  ...MOCK_SOURCE, enabled: false, termsStatus: 'pending', urlVerified: false,
  verification: { level: 'lido', researchedBy: 'ln-editorial-engineer', robots: 'permitido', robotsNote: 'MOCK', termsExcerpt: null, termsFetchedAt: null, consultedAt: null, imageRightsNote: 'não informado', notes: 'MOCK' },
};
const registry = () => new SourceRegistry([SRC]);
const collector = () => new Collector(
  new MockFetcher({ 'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow:', 'https://ri.mock.example/feed.xml': '<rss><channel><item><title>MOCK</title><link>https://ri.mock.example/noticias/alfa-parceria</link></item></channel></rss>', 'https://ri.mock.example/noticias/alfa-parceria': MOCK_ARTICLE_ALFA }),
  { minSpacingMs: 0, now: () => NOW, resolver: new FakeResolver({ 'ri.mock.example': [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON },
);
const on = () => true;

async function enable(db: Db) {
  const store = new PgEditorialStore(db);
  const ctx = (userId: string, role: string) => ({ actor: { userId, roles: [role], mfa: true }, store, sources: registry(), now: () => NOW, newId: () => 'id' });
  expect((await reviewSource(ctx('maria-chefe', 'editor_chefe'), { sourceId: 'mock-ri', termsStatus: 'approved', termsNote: 'Termos oficiais lidos pelo revisor responsável.', urlVerified: true, robotsChecked: true, paywall: 'none' })).status).toBe(200);
  expect((await setSourceEnabled(ctx('joao-admin', 'admin'), { sourceId: 'mock-ri', enabled: true })).status).toBe(200);
  return store;
}

const HORA = 3_600_000;
const start = (db: Db, results: InboxRound[], errors: unknown[], over: Partial<EditorialCollectorOptions> = {}) =>
  startEditorialCollector({ db, flags: on, firstDelayMs: HORA, registry: registry(), collector: collector(), now: () => NOW, onResult: (r) => results.push(r), onError: (e) => errors.push(e), ...over });

describe('coleta contínua no worker', () => {
  it('sem a flag editorialCollector não agenda nada (padrão)', async () => {
    const asked: string[] = [];
    expect(startEditorialCollector({ db: {} as Db, flags: (f) => { asked.push(f); return false; } })).toBeNull();
    expect(asked).toEqual(['editorialCollector']);
  });

  it('grava na loja PostgreSQL e, depois de reiniciar, não repete (deduplicação lida do banco, sem tabela nova)', async () => {
    const { db, client } = await freshDb();
    const results: InboxRound[] = [];
    const errors: unknown[] = [];
    try {
      const store = await enable(db);
      const first = start(db, results, errors)!;
      await first.tick();
      first.stop();
      const second = start(db, results, errors)!; // processo novo: coletor novo, mesmo banco
      await second.tick();
      second.stop();
      expect(errors).toEqual([]);
      expect(results.map((r) => r.saved.length)).toEqual([1, 0]);
      expect(results[1]!.duplicates).toBe(1);
      const all = await store.listArticles();
      expect(all).toHaveLength(1);
      expect(all[0]!.status).toBe('rascunho');
      expect(all[0]!.draft).toBeUndefined();
      expect((await store.listAudit()).filter((x) => x.action === COLLECTOR_ROUND_ACTION)).toHaveLength(2);
      expect(await store.listOutbox()).toEqual([]); // nada vai para fila nenhuma
    } finally { await client.close(); }
  });

  it('não sobrepõe rodadas e não roda depois de parado', async () => {
    const { db, client } = await freshDb();
    const results: InboxRound[] = [];
    const errors: unknown[] = [];
    try {
      await enable(db);
      const c = start(db, results, errors)!;
      await Promise.all([c.tick(), c.tick()]);
      expect(results).toHaveLength(1);
      c.stop();
      await c.tick();
      expect(results).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally { await client.close(); }
  });

  it('o temporizador dispara a primeira rodada depois da espera e a falha de uma rodada não derruba o processo', async () => {
    const results: InboxRound[] = [];
    const errors: unknown[] = [];
    const quebrada = { listSourceStates: async () => { throw new Error('MOCK banco fora'); } } as unknown as NonNullable<EditorialCollectorOptions['store']>;
    const c = start({} as Db, results, errors, { store: quebrada, firstDelayMs: 5, intervalMs: 5 })!;
    await new Promise((r) => setTimeout(r, 80));
    c.stop();
    const vistos = errors.length;
    expect(vistos).toBeGreaterThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 30));
    expect(errors.length).toBe(vistos);
    expect(results).toEqual([]);
  });

  it('linha de log sem fonte habilitada', () => {
    expect(roundLogLine({ startedAt: '', finishedAt: '', saved: [], duplicates: 0, sources: [] })).toBe('nenhuma fonte habilitada');
  });
});
