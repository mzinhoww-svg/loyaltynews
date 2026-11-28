// Coleta contínua no worker sobre o PostgreSQL de teste, só com as migrações que já existem (prova de "sem migração nova"). Dados MOCK.
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { createTestDb, isRealTestDb } from '@ln/db/testing';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { COLLECTOR_ALERT_ACTION, COLLECTOR_ROUND_ACTION, Collector, SourceRegistry, reviewSource, setSourceEnabled, type AuditItem, type InboxRound, type Source } from '@ln/editorial';
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

  describe('aviso de rodada boa (5 h)', () => {
    const MIN = 60_000;
    function relogio() {
      let t = NOW.getTime();
      return { now: () => new Date(t), passa: (ms: number) => { t += ms; } };
    }
    function loja(inicial: AuditItem[] = []) {
      const log = [...inicial];
      let fora = false;
      const store = {
        listAudit: async () => { if (fora) throw new Error('MOCK banco fora'); return [...log]; },
        appendAudit: async (a: AuditItem) => { if (fora) throw new Error('MOCK banco fora'); log.push(a); },
        listSourceStates: async () => { throw new Error('MOCK sem rodada'); },
      } as unknown as NonNullable<EditorialCollectorOptions['store']>;
      return { store, log, cai: () => { fora = true; }, avisos: () => log.filter((x) => x.action === COLLECTOR_ALERT_ACTION) };
    }
    const rodada = (at: Date, detail: string): AuditItem => ({ at: at.toISOString(), userId: null, action: COLLECTOR_ROUND_ACTION, target: 'collector', detail });
    const horasAntes = (h: number) => new Date(NOW.getTime() - h * HORA);
    const vigia = (store: NonNullable<EditorialCollectorOptions['store']>, now: () => Date, avisos: string[]) =>
      start({} as Db, [], [], { store, now, onAlert: (l) => avisos.push(l), watchIntervalMs: HORA })!;

    it('avisa só depois de 5 h, uma vez; repete a cada 5 h enquanto persistir', async () => {
      const r = relogio(); const l = loja(); const avisos: string[] = [];
      const c = vigia(l.store, r.now, avisos);
      r.passa(5 * HORA); await c.check();
      expect(avisos).toEqual([]);
      r.passa(MIN); await c.check(); await c.check();
      expect(avisos).toEqual(['sem rodada boa há mais de 5 h (prazo 5 h); última boa: nenhuma registrada']);
      expect(l.avisos()).toMatchObject([{ userId: null, target: 'collector', detail: avisos[0] }]);
      r.passa(5 * HORA); await c.check();
      expect(avisos).toHaveLength(2);
      c.stop();
    });

    it('conta da última rodada BOA gravada; rodada sem item não conta e reinício não repete o aviso recente', async () => {
      const r = relogio(); const avisos: string[] = [];
      const l = loja([rodada(horasAntes(6), 'rodada boa; fontes 1'), rodada(horasAntes(1), 'rodada sem item; fontes 1')]);
      const c = vigia(l.store, r.now, avisos);
      await c.check();
      expect(avisos).toEqual([`sem rodada boa há mais de 6 h (prazo 5 h); última boa: ${horasAntes(6).toISOString()}`]);
      c.stop();
      const outro = vigia(l.store, r.now, avisos); // processo novo: o aviso recente já está na trilha
      r.passa(MIN); await outro.check();
      expect(avisos).toHaveLength(1);
      outro.stop();
    });

    it('rodada boa deste processo zera o prazo', async () => {
      const { db, client } = await freshDb();
      const r = relogio(); const avisos: string[] = [];
      try {
        const store = await enable(db);
        await store.appendAudit(rodada(horasAntes(9), 'rodada boa; fontes 1'));
        const c = start(db, [], [], { now: r.now, onAlert: (x) => avisos.push(x) })!;
        await c.check();
        expect(avisos).toHaveLength(1);
        await c.tick(); // rodada boa agora
        r.passa(5 * HORA); await c.check();
        expect(avisos).toHaveLength(1);
        r.passa(60_000); await c.check();
        expect(avisos[1]).toContain(`última boa: ${NOW.toISOString()}`);
        c.stop();
      } finally { await client.close(); }
    });

    it('com o banco fora, o aviso ainda sai no log', async () => {
      const r = relogio(); const l = loja(); const avisos: string[] = []; const errors: unknown[] = [];
      l.cai();
      const c = start({} as Db, [], errors, { store: l.store, now: r.now, onAlert: (x) => avisos.push(x), watchIntervalMs: HORA })!;
      r.passa(5 * HORA + MIN); await c.check();
      expect(avisos).toHaveLength(1);
      expect(errors.length).toBeGreaterThan(0);
      c.stop();
    });

    it('o temporizador do vigia roda sozinho, mesmo com a rodada travada, e para com o coletor', async () => {
      const r = relogio(); const avisos: string[] = [];
      const l = loja([rodada(horasAntes(6), 'rodada boa; fontes 1')]);
      (l.store as unknown as { listSourceStates: () => Promise<never> }).listSourceStates = () => new Promise<never>(() => {});
      const c = start({} as Db, [], [], { store: l.store, now: r.now, onAlert: (x) => avisos.push(x), firstDelayMs: 1, intervalMs: HORA, watchIntervalMs: 10 })!;
      await new Promise((ok) => setTimeout(ok, 80));
      expect(avisos).toHaveLength(1);
      c.stop();
      r.passa(6 * HORA);
      await new Promise((ok) => setTimeout(ok, 40));
      expect(avisos).toHaveLength(1);
    });
  });

  it('linha de log sem fonte habilitada', () => {
    expect(roundLogLine({ startedAt: '', finishedAt: '', saved: [], duplicates: 0, sources: [] })).toBe('nenhuma fonte habilitada');
  });
});
