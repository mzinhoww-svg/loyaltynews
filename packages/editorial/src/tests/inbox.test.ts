// Caixa de pautas (coleta contínua sem modelo). Dados MOCK: fontes, páginas e pessoas fictícias.
import { describe, expect, it } from 'vitest';
import { COLLECT_ON, FakeResolver, MOCK_ARTICLE_ALFA, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher } from '../../fixtures/mock-web.mock';
import { listQueue, requestRecheck, submitReview } from '../api/handlers';
import { setSourceEnabled, reviewSource } from '../api/source-handlers';
import { applyPublication } from '../api/publication';
import { InMemoryEditorialStore } from '../api/store';
import { Collector } from '../collector/collector';
import type { Fetcher } from '../collector/collector';
import { articleIdFor } from '../factory/collect';
import { COLLECTOR_ROUND_ACTION, INBOX_FINDING, collectToInbox } from '../factory/inbox';
import { FlagDisabled } from '../flags';
import { SourceRegistry } from '../sources/registry';
import type { Source } from '../types';

const NOW = new Date('2026-11-25T12:00:00-03:00');
const verification = { level: 'lido' as const, researchedBy: 'ln-editorial-engineer', robots: 'permitido' as const, robotsNote: 'MOCK', termsExcerpt: null, termsFetchedAt: null, consultedAt: null, imageRightsNote: 'não informado', notes: 'MOCK' };
const A: Source = { ...MOCK_SOURCE, enabled: false, termsStatus: 'pending', urlVerified: false, verification };
const B: Source = { ...A, id: 'mock-ri-2', name: 'MOCK RI 2', host: 'ri2.mock.example', listingUrl: 'https://ri2.mock.example/', feedUrl: 'https://ri2.mock.example/feed.xml', termsUrl: null };
const BETA = '<html><head><title>MOCK Beta</title></head><body><article><h1>MOCK Beta anuncia calendário</h1><p>MOCK: a empresa fictícia Beta publicou o calendário de eventos do próximo trimestre para acionistas.</p><p>MOCK: o documento fictício lista três datas e não informa valores.</p></article></body></html>';
const feed = (url: string) => `<rss><channel><item><title>MOCK</title><link>${url}</link></item></channel></rss>`;
const PAGES = {
  'https://ri.mock.example/robots.txt': 'User-agent: *\nDisallow:',
  'https://ri.mock.example/feed.xml': feed('https://ri.mock.example/noticias/alfa-parceria'),
  'https://ri.mock.example/noticias/alfa-parceria': MOCK_ARTICLE_ALFA,
  'https://ri2.mock.example/robots.txt': 'User-agent: *\nDisallow:',
  'https://ri2.mock.example/feed.xml': feed('https://ri2.mock.example/noticias/beta'),
  'https://ri2.mock.example/noticias/beta': BETA,
};
const registry = () => new SourceRegistry([A, B]);

function setup(onGet?: (url: string, store: InMemoryEditorialStore) => Promise<void>) {
  const store = new InMemoryEditorialStore();
  const asked: string[] = [];
  const inner = new MockFetcher(PAGES);
  const fetcher: Fetcher = { async get(url, o) { asked.push(url); if (onGet) await onGet(url, store); return inner.get(url, o); } };
  const collector = () => new Collector(fetcher, { minSpacingMs: 0, now: () => NOW, resolver: new FakeResolver({ 'ri.mock.example': [[MOCK_PUBLIC_IP]], 'ri2.mock.example': [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON });
  const ctx = (userId: string, role: string) => ({ actor: { userId, roles: [role], mfa: true }, store, sources: registry(), now: () => NOW, newId: () => 'id' });
  const enable = async (id: string) => {
    expect((await reviewSource(ctx('maria-chefe', 'editor_chefe'), { sourceId: id, termsStatus: 'approved', termsNote: 'Termos oficiais lidos pelo revisor responsável.', urlVerified: true, robotsChecked: true, paywall: 'none' })).status).toBe(200);
    expect((await setSourceEnabled(ctx('joao-admin', 'admin'), { sourceId: id, enabled: true })).status).toBe(200);
  };
  const disable = async (id: string) => { expect((await setSourceEnabled(ctx('joao-admin', 'admin'), { sourceId: id, enabled: false })).status).toBe(200); };
  const run = (flags: { editorialCollector: boolean } = { editorialCollector: true }) => collectToInbox({ store, registry: registry(), collector: collector(), flags, now: () => NOW });
  const rounds = async () => (await store.listAudit()).filter((x) => x.action === COLLECTOR_ROUND_ACTION);
  return { store, asked, ctx, enable, disable, run, rounds };
}

describe('caixa de pautas', () => {
  it('flag desligada: recusa e não lê nem grava nada', async () => {
    const t = setup();
    await t.enable('mock-ri');
    await expect(t.run({ editorialCollector: false })).rejects.toThrow(FlagDisabled);
    expect(t.asked).toEqual([]);
    expect(await t.store.listArticles()).toEqual([]);
  });

  it('grava o item como rascunho SEM draft, com a evidência, registra a rodada e mostra o título na fila', async () => {
    const t = setup();
    await t.enable('mock-ri');
    const r = await t.run();
    expect(r.saved).toHaveLength(1);
    const [a] = await t.store.listArticles();
    expect(a).toMatchObject({ articleId: r.saved[0], status: 'rascunho', blockers: [], recheckCount: 0 });
    expect(a!.draft).toBeUndefined();
    expect(a!.findings.map((f) => f.code)).toEqual([INBOX_FINDING]);
    expect(a!.evidences).toHaveLength(1);
    const [round] = await t.rounds();
    expect(round).toMatchObject({ userId: null, target: 'collector', detail: 'fontes 1; com itens 1; novos 1; repetidos 0' });
    const q = await listQueue(t.ctx('maria-chefe', 'editor_chefe'), {});
    expect('items' in q.body && q.body.items[0]!.titulo).toBe(a!.evidences[0]!.title);
    expect(a!.evidences[0]!.title).not.toBe('');
  });

  it('rodada repetida, mesmo com coletor novo (reinício), não grava de novo nem reescreve o registro', async () => {
    const t = setup();
    await t.enable('mock-ri');
    await t.run();
    const antes = await t.store.listArticles();
    const r = await t.run();
    expect(r.saved).toEqual([]);
    expect(r.duplicates).toBe(1);
    expect(await t.store.listArticles()).toEqual(antes);
    expect(await t.rounds()).toHaveLength(2);
  });

  it('desabilitar uma fonte durante a rodada vale antes de a coleta dela começar', async () => {
    let ja = false;
    const t: ReturnType<typeof setup> = setup(async (url) => { if (!ja && url.endsWith('ri.mock.example/feed.xml')) { ja = true; await t.disable('mock-ri-2'); } });
    await t.enable('mock-ri');
    await t.enable('mock-ri-2');
    const r = await t.run();
    expect(r.saved).toHaveLength(1);
    expect(t.asked.filter((u) => u.includes('ri2.mock.example'))).toEqual([]);
    expect(r.sources.find((s) => s.sourceId === 'mock-ri-2')).toMatchObject({ status: 'not_eligible', evidences: 0 });
    expect((await t.rounds())[0]!.detail).toContain('desabilitadas durante a rodada: mock-ri-2');
  });

  it('todas as fontes desabilitadas: nada é lido, gravado ou registrado na trilha (parada visível)', async () => {
    const t = setup();
    await t.enable('mock-ri');
    await t.disable('mock-ri');
    const r = await t.run();
    expect(r.sources).toEqual([]);
    expect(t.asked).toEqual([]);
    expect(await t.store.listArticles()).toEqual([]);
    expect(await t.rounds()).toEqual([]);
  });

  it('não sobrescreve um registro que apareceu enquanto a rodada lia', async () => {
    const id = articleIdFor('https://ri.mock.example/noticias/alfa-parceria');
    const outro = { articleId: id, editoria: 'mercado' as const, status: 'bloqueado' as const, evidences: [], blockers: [], findings: [], reviews: [], recheckCount: 0, updatedAt: '2026-11-25T10:00:00.000Z' };
    const t = setup(async (url, store) => { if (url.endsWith('/alfa-parceria')) await store.putArticle(outro); });
    await t.enable('mock-ri');
    const r = await t.run();
    expect(r.saved).toEqual([]);
    expect(r.duplicates).toBe(1);
    expect(await t.store.getArticle(id)).toEqual(outro);
  });

  it('item sem rascunho não passa por revisão, nova checagem nem publicação', async () => {
    const t = setup();
    await t.enable('mock-ri');
    const [id] = (await t.run()).saved as [string];
    const chefe = t.ctx('maria-chefe', 'editor_chefe');
    for (const decision of ['confirm', 'send_back', 'block'] as const) {
      expect((await submitReview(chefe, { articleId: id, decision, note: 'MOCK nota' })).status).toBe(409);
    }
    expect((await requestRecheck(chefe, { articleId: id })).status).toBe(404);
    const p = await applyPublication(t.store, { articleId: id, receiptId: 'r', url: 'https://ri.mock.example/x', publishedAt: NOW.toISOString() });
    expect(p).toMatchObject({ ok: false, code: 'no_draft' });
    expect((await t.store.getArticle(id))!.status).toBe('rascunho');
  });
});
