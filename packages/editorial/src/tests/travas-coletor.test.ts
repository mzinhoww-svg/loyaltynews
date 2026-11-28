// DP-103 (proprietário, 28/11) com os pareceres 64 e 65: trava das cinco fontes, teto e pausa persistentes, autoria visível e prazo do texto bruto.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { InMemoryEditorialStore } from '../api/store';
import { attributionNameOf, COLLECTOR_ALLOWLIST } from '../collector/allowlist';
import { isExcludedSource, isRestrictedBlog } from '../collector/restricted';
import { Collector, USER_AGENT } from '../collector/collector';
import { HOST_PAUSE_ACTION, HOST_READ_ACTION, registeredCollectorGuards, StoreHostBudget } from '../factory/read-budget';
import { INBOX_FINDING } from '../factory/inbox';
import { purgeRawText, RAW_TEXT_ACTION, withdrawCollected } from '../factory/raw-text';
import type { ArticleRecord } from '../api/store';
import { buildAttribution, checkAttribution } from '../rules/rules';
import { SEED_SOURCES } from '../sources/seed';
import type { Draft, Source } from '../types';
import { FakeResolver, MockFetcher, MOCK_PUBLIC_IP } from '../../fixtures/mock-web.mock';
import { decisaoInscrita } from './decisao-registrada';

const ROOT = resolve(__dirname, '../../../..');
const HOST = 'www.camara.leg.br';
const FEED = `https://${HOST}/noticias/rss/ultimas-noticias`;
const ITEM = (n: number) => `https://${HOST}/noticias/${n}-materia-mock`;
const seed = (id: string): Source => ({ ...SEED_SOURCES.find((s) => s.id === id)!, enabled: true, termsStatus: 'approved', urlVerified: true, paywall: 'none' });
const PAGE = `<html><head><title>MOCK</title></head><body><article><p>${'Texto de exemplo da matéria MOCK para o teste. '.repeat(20)}</p>
<!--<p>Reportagem - Nome Escondido</p>--><p><strong>Reportagem - Maria da Silva/RS</strong><br>Edição - João Souza</p></article></body></html>`;
const rss = (n: number) => `<rss><channel>${Array.from({ length: n }, (_, i) => `<item><title>MOCK ${i}</title><link>${ITEM(i)}</link></item>`).join('')}</channel></rss>`;

function web(itens = 10) {
  const pages: Record<string, { status: number; headers: Record<string, string>; body: string }> = {
    [`https://${HOST}/robots.txt`]: { status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' },
    [FEED]: { status: 200, headers: { 'content-type': 'application/rss+xml' }, body: rss(itens) },
  };
  for (let i = 0; i < itens; i++) pages[ITEM(i)] = { status: 200, headers: { 'content-type': 'text/html' }, body: PAGE };
  return new MockFetcher(pages);
}
const mk = (fetcher: MockFetcher, store: InMemoryEditorialStore, now: () => Date) =>
  new Collector(fetcher, { now, sleep: async () => {}, minSpacingMs: 0, resolver: new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP]] }), flags: { editorialCollector: true }, ...registeredCollectorGuards(store, 'coleta_continua') });
const T0 = Date.parse('2026-11-28T12:00:00.000Z');

// Guarda de registro: fica PULADO (e visível no relatório) enquanto a decisão citada não tiver entrada em decisions.yaml nesta base.
test.skipIf(!decisaoInscrita(COLLECTOR_ALLOWLIST.decisionId))(`registro: ${COLLECTOR_ALLOWLIST.decisionId} inscrita em decisions.yaml (pulado = ainda não inscrita; 5º ato)`, () => {
  assert.ok(decisaoInscrita(COLLECTOR_ALLOWLIST.decisionId));
});
test('registro: a conferência reconhece uma decisão inscrita e recusa uma inexistente', () => {
  assert.equal(decisaoInscrita('DP-29'), true);
  assert.equal(decisaoInscrita('DP-999'), false);
});

test('lista permitida: exatamente as cinco fontes da decisão, com o host do cadastro e teto de 6 por hora', () => {
  assert.equal(COLLECTOR_ALLOWLIST.decisionId, 'DP-103');
  assert.deepEqual(COLLECTOR_ALLOWLIST.sources.map((s) => s.id).sort(), ['abemf', 'camara-noticias', 'mestre-das-milhas', 'passageiro-de-primeira', 'procon-sp']);
  for (const a of COLLECTOR_ALLOWLIST.sources) {
    assert.equal(SEED_SOURCES.find((s) => s.id === a.id)?.host, a.host, a.id);
    assert.equal(a.maxPerHour, 6, a.id);
  }
  for (const fora of ['skift', 'iata', 'bain', 'cathay']) assert.ok(!COLLECTOR_ALLOWLIST.sources.some((s) => s.id.includes(fora) || s.host.includes(fora)), fora);
});

test('trava: fonte habilitada no cadastro e fora da lista não gera NENHUMA requisição (feed, URL e sitemap)', async () => {
  const fetcher = web();
  const store = new InMemoryEditorialStore();
  const c = mk(fetcher, store, () => new Date(T0));
  const fora: Source = { ...seed('camara-noticias'), id: 'outra-fonte' };
  const trocada: Source = { ...seed('camara-noticias'), host: 'outro.example', feedUrl: 'https://outro.example/feed' };
  for (const s of [fora, trocada]) {
    const f = await c.collectFeed(s, 5);
    const u = await c.collectUrl(s, ITEM(0));
    const m = await c.collectSitemap({ ...s, sitemapUrl: `https://${s.host}/sitemap.xml` }, 5);
    assert.deepEqual([f.skipped[0]?.code, u.skip?.code, m.skipped[0]?.code], ['source_not_allowed', 'source_not_allowed', 'source_not_allowed']);
    assert.match(f.skipped[0]!.detail, /DP-103/);
  }
  assert.equal(fetcher.calls.length, 0);
  assert.equal((await store.listAudit()).length, 0);
});

test('teto por hora: robots, feed e matérias contam; outra instância e outra rodada na mesma hora não requisitam; a janela volta', async () => {
  const fetcher = web();
  const store = new InMemoryEditorialStore();
  const primeira = await mk(fetcher, store, () => new Date(T0)).collectFeed(seed('camara-noticias'), 10);
  assert.equal(fetcher.calls.length, 6, 'robots.txt + feed + 4 matérias');
  assert.equal(primeira.evidences.length, 4);
  assert.equal(primeira.skipped.at(-1)?.code, 'rate_limited');
  const segunda = await mk(fetcher, store, () => new Date(T0 + 30 * 60_000)).collectFeed(seed('camara-noticias'), 10);
  assert.equal(fetcher.calls.length, 6, 'instância nova, mesma hora: nada sai para a rede');
  assert.equal(segunda.skipped[0]?.code, 'rate_limited');
  assert.equal((await store.listAudit()).filter((a) => a.action === HOST_READ_ACTION && a.target === HOST).length, 6);
  const depois = await mk(fetcher, store, () => new Date(T0 + 3_600_001)).collectFeed(seed('camara-noticias'), 10);
  assert.equal(depois.evidences.length, 4);
  assert.equal(fetcher.calls.length, 12);
});

test('teto por hora: duas instâncias ao mesmo tempo não passam de 6 no total', async () => {
  const fetcher = web();
  const store = new InMemoryEditorialStore();
  await Promise.all([1, 2, 3].map(() => mk(fetcher, store, () => new Date(T0)).collectFeed(seed('camara-noticias'), 10)));
  assert.ok(fetcher.calls.length <= 6, String(fetcher.calls.length));
});

test('teto por hora: contador indisponível = não requisita', async () => {
  const fetcher = web();
  const store = new InMemoryEditorialStore();
  const quebrado = new StoreHostBudget(Object.assign(Object.create(store), { reserveRead: async () => { throw new Error('banco fora'); } }));
  const c = new Collector(fetcher, { now: () => new Date(T0), sleep: async () => {}, minSpacingMs: 0, resolver: new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP]] }), flags: { editorialCollector: true }, hostBudget: quebrado });
  const r = await c.collectFeed(seed('camara-noticias'), 5);
  assert.equal(r.evidences.length, 0);
  assert.equal(fetcher.calls.length, 0);
});

test('atribuição da Câmara: assinatura exigida, sem nome de repórter extraído da página', async () => {
  const r = await mk(web(1), new InMemoryEditorialStore(), () => new Date(T0)).collectFeed(seed('camara-noticias'), 1);
  const e = r.evidences[0]!;
  assert.ok(!('author' in e));
  const bloco = buildAttribution([e], SEED_SOURCES);
  assert.equal(bloco, `Fontes:\n- Agência Câmara (Câmara dos Deputados): ${e.canonicalUrl} (acessado em 2026-11-28)`);
  const d = { evidenceIds: [e.id], body: `Texto.\n\n${bloco}` } as unknown as Draft;
  assert.deepEqual(checkAttribution(d, [e]).findings, []);
  assert.equal(attributionNameOf('abemf'), undefined);
});

test('R1: o cadastro não aumenta o teto; a chave do host não depende de maiúsculas', async () => {
  const fetcher = web();
  const store = new InMemoryEditorialStore();
  await mk(fetcher, store, () => new Date(T0)).collectFeed({ ...seed('camara-noticias'), maxRequestsPerHour: 64 }, 10);
  await mk(fetcher, store, () => new Date(T0)).collectFeed({ ...seed('camara-noticias'), host: 'WWW.Camara.leg.br', maxRequestsPerHour: 64 }, 10);
  assert.equal(fetcher.calls.length, 6);
  assert.deepEqual([...new Set((await store.listAudit()).map((a) => a.target))], [HOST]);
});

test('R2: falha passageira do contador não fica guardada; a mesma instância volta a ler quando o banco volta', async () => {
  const fetcher = web(1);
  const store = new InMemoryEditorialStore();
  let fora = true;
  const original = store.reserveRead.bind(store);
  store.reserveRead = async (r) => { if (fora) throw new Error('banco fora'); return original(r); };
  const c = mk(fetcher, store, () => new Date(T0));
  const antes = await c.collectFeed(seed('camara-noticias'), 1);
  assert.equal(antes.skipped[0]?.code, 'rate_limited');
  assert.equal(fetcher.calls.length, 0);
  fora = false;
  assert.equal((await c.collectFeed(seed('camara-noticias'), 1)).evidences.length, 1);
});

test('robots.txt é relido: falha vale 1 h e regra lida vale 24 h', async () => {
  const fetcher = web(1);
  const robots = `https://${HOST}/robots.txt`;
  fetcher.routes.set(robots, { status: 500, headers: {}, body: '' });
  let agora = T0;
  const c = mk(fetcher, new InMemoryEditorialStore(), () => new Date(agora));
  assert.equal((await c.collectFeed(seed('camara-noticias'), 1)).skipped[0]?.code, 'robots_unavailable');
  fetcher.routes.set(robots, { status: 200, headers: {}, body: 'User-agent: *\nAllow: /\n' });
  agora = T0 + 3_600_001;
  assert.equal((await c.collectFeed(seed('camara-noticias'), 1)).evidences.length, 1);
  fetcher.routes.set(robots, { status: 200, headers: {}, body: 'User-agent: *\nDisallow: /\n' });
  agora += 24 * 3_600_000 + 1;
  assert.equal((await c.collectFeed(seed('camara-noticias'), 1)).skipped[0]?.code, 'robots_disallow');
});

const semLista = (fetcher: MockFetcher, host: string, extra: Record<string, unknown> = {}) =>
  new Collector(fetcher, { now: () => new Date(T0), sleep: async () => {}, minSpacingMs: 0, resolver: new FakeResolver({ [host]: [[MOCK_PUBLIC_IP]] }), flags: { editorialCollector: true }, ...extra });

test('em todo uso: fonte excluída não gera requisição, por id ou por domínio, nem pela leitura via provedor', async () => {
  const casos: Array<Partial<Source>> = [
    { id: 'skift', host: 'skift.com' }, { id: 'outro-nome', host: 'www.iata.org' }, { id: 'iata-pressroom', host: 'x.example' },
    { id: 'z', host: 'news.cathaypacific.com' }, { id: 'y', host: 'www.bain.com' }, { id: 'w', host: 'netpromotersystem.com', acesso: 'via-provedor' },
    { id: 'am', host: 'www.asiamiles.com' }, { id: 'br', host: 'bain.com.br' },
  ];
  for (const over of casos) {
    const fetcher = web();
    let leituras = 0;
    const c = semLista(fetcher, over.host!, { reader: { name: 'p', read: async () => { leituras++; return { status: 200, body: '' }; } }, restrictedBudget: new StoreHostBudget(new InMemoryEditorialStore()) });
    const s: Source = { ...seed('camara-noticias'), pathPrefix: null, feedUrl: `https://${over.host}/feed`, sitemapUrl: `https://${over.host}/s.xml`, ...over };
    assert.equal((await c.collectFeed(s, 3)).skipped[0]?.code, 'source_not_allowed', over.host!);
    assert.equal((await c.collectUrl(s, `https://${over.host}/a`)).skip?.code, 'source_not_allowed', over.host!);
    assert.equal((await c.collectSitemap(s, 3)).skipped[0]?.code, 'source_not_allowed', over.host!);
    assert.equal(fetcher.calls.length + leituras, 0, over.host!);
  }
  assert.ok(!isExcludedSource({ id: 'icao-eventos', host: 'www.icao.int' }) && !isExcludedSource({ id: 'x', host: 'obain.com' }));
});

const BLOG_HOST = 'passageirodeprimeira.com';
const blogWeb = (item = 200) => {
  const pages: Record<string, { status: number; headers: Record<string, string>; body: string }> = {
    [`https://${BLOG_HOST}/robots.txt`]: { status: 200, headers: {}, body: 'User-agent: *\nDisallow:' },
    [`https://${BLOG_HOST}/feed/`]: { status: 200, headers: {}, body: `<rss><channel>${Array.from({ length: 10 }, (_, i) => `<item><title>M${i}</title><link>https://${BLOG_HOST}/p${i}</link></item>`).join('')}</channel></rss>` },
  };
  for (let i = 0; i < 10; i++) pages[`https://${BLOG_HOST}/p${i}`] = { status: item, headers: {}, body: PAGE };
  return new MockFetcher(pages);
};

test('em todo uso: blog só pelo coletor direto, com o próprio nome, sem sombra, 6 por hora e pausa persistentes', async () => {
  const store = new InMemoryEditorialStore();
  const semContador = blogWeb();
  const r0 = await semLista(semContador, BLOG_HOST).collectFeed(seed('passageiro-de-primeira'), 10);
  assert.equal(r0.skipped[0]?.code, 'source_not_allowed');
  assert.equal(semContador.calls.length, 0, 'sem contador persistente: nada sai');
  const fetcher = blogWeb();
  const nomes: string[] = [];
  const vistos: string[] = [];
  const get = fetcher.get.bind(fetcher);
  fetcher.get = async (url, opts) => { nomes.push(opts?.userAgent ?? ''); return get(url, opts); };
  const opts = { userAgent: 'Mozilla/5.0 (imitando navegador)', onDirectRead: (e: { url: string }) => vistos.push(e.url), ...registeredCollectorGuards(store, 'fabrica') };
  await semLista(fetcher, BLOG_HOST, opts).collectFeed({ ...seed('passageiro-de-primeira'), maxRequestsPerHour: 64 }, 10);
  await semLista(fetcher, BLOG_HOST, opts).collectFeed(seed('passageiro-de-primeira'), 10);
  assert.equal(fetcher.calls.length, 6);
  assert.deepEqual([...new Set(nomes)], [USER_AGENT]);
  assert.deepEqual(vistos, []);
  assert.equal((await semLista(fetcher, BLOG_HOST, opts).collectFeed({ ...seed('passageiro-de-primeira'), acesso: 'via-provedor' }, 3)).skipped[0]?.code, 'source_not_allowed');
  const recusa = blogWeb(403);
  const outra = new InMemoryEditorialStore();
  await semLista(recusa, BLOG_HOST, registeredCollectorGuards(outra, 'pauta_autoral')).collectFeed(seed('passageiro-de-primeira'), 3);
  assert.equal((await outra.listAudit()).filter((a) => a.action === HOST_PAUSE_ACTION).length, 1);
  assert.ok(isRestrictedBlog({ id: 'qualquer', host: 'www.mestredasmilhas.com' }));
});

test('em todo uso: as demais fontes seguem como antes (sem teto no banco)', async () => {
  const fetcher = web(10);
  const store = new InMemoryEditorialStore();
  const r = await semLista(fetcher, HOST, { ...registeredCollectorGuards(store, 'fabrica') }).collectFeed({ ...seed('camara-noticias'), maxRequestsPerHour: 64 }, 10);
  assert.equal(r.evidences.length, 10);
  assert.equal((await store.listAudit()).length, 0);
});

test('página de desafio contra robô pausa o host', async () => {
  const fetcher = web(2);
  fetcher.routes.set(ITEM(0), { status: 200, headers: {}, body: '<html><head><title>Just a moment...</title></head><body><div class="cf-challenge">Checking your browser before accessing</div></body></html>' });
  const store = new InMemoryEditorialStore();
  const r = await mk(fetcher, store, () => new Date(T0)).collectFeed(seed('camara-noticias'), 2);
  assert.equal(r.skipped[0]?.code, 'challenge');
  assert.equal((await store.listAudit()).filter((a) => a.action === HOST_PAUSE_ACTION).length, 1);
});

for (const status of [403, 429]) {
  test(`${status}: a coleta para e o host fica em pausa por 24 h em qualquer instância`, async () => {
    const fetcher = web(3);
    fetcher.routes.set(ITEM(0), { status, headers: {}, body: '' });
    const store = new InMemoryEditorialStore();
    const r = await mk(fetcher, store, () => new Date(T0)).collectFeed(seed('camara-noticias'), 3);
    assert.equal(r.evidences.length, 0);
    assert.equal(fetcher.calls.length, 3, 'robots, feed e a página recusada');
    assert.equal((await store.listAudit()).filter((a) => a.action === HOST_PAUSE_ACTION).length, 1);
    await mk(fetcher, store, () => new Date(T0 + 23 * 3_600_000)).collectFeed(seed('camara-noticias'), 3);
    assert.equal(fetcher.calls.length, 3, 'em pausa: nada sai');
    await mk(fetcher, store, () => new Date(T0 + 24 * 3_600_000 + 1)).collectFeed(seed('camara-noticias'), 3);
    assert.ok(fetcher.calls.length > 3);
  });
}

test('R3 e identificação: com as travas não há sombra nem provedor de leitura, e o nome do coletor não é trocado', async () => {
  const fetcher = web(2);
  const vistos: string[] = [];
  const nomes: string[] = [];
  const get = fetcher.get.bind(fetcher);
  fetcher.get = async (url, opts) => { nomes.push(opts?.userAgent ?? ''); return get(url, opts); };
  let leituras = 0;
  const c = new Collector(fetcher, {
    now: () => new Date(T0), sleep: async () => {}, minSpacingMs: 0, resolver: new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP]] }), flags: { editorialCollector: true },
    userAgent: 'Mozilla/5.0 (imitando navegador)', onDirectRead: (e) => vistos.push(e.url), reader: { name: 'provedor', read: async () => { leituras++; return { status: 200, body: '' }; } },
    ...registeredCollectorGuards(new InMemoryEditorialStore(), 'coleta_continua'),
  });
  assert.equal((await c.collectFeed(seed('camara-noticias'), 2)).evidences.length, 2);
  assert.deepEqual(vistos, []);
  assert.deepEqual([...new Set(nomes)], [USER_AGENT]);
  const via = await c.collectFeed({ ...seed('camara-noticias'), acesso: 'via-provedor' }, 2);
  assert.equal(via.skipped[0]?.code, 'source_not_allowed');
  assert.equal(leituras, 0);
});

const registro = (id: string, sourceId: string, fetchedAt: string, over: Partial<ArticleRecord> = {}): ArticleRecord => ({
  articleId: id, editoria: 'pontos', status: 'rascunho', blockers: [], reviews: [], recheckCount: 0, updatedAt: fetchedAt,
  findings: [{ code: INBOX_FINDING, message: 'item coletado sem modelo' }],
  evidences: [{ id: `ev_${id}`, sourceId, url: `https://x.example/${id}`, canonicalUrl: `https://x.example/${id}`, fetchedAt, contentSha256: 'a'.repeat(64), title: 'Título MOCK', text: 'Texto bruto MOCK', publishedAt: null, suspicious: false, suspiciousReasons: [], outboundLinks: ['https://y.example/'] }],
  ...over,
});

test('texto bruto: apagado depois de 7 dias só na caixa de pautas; endereço e impressão digital ficam; repetir não regrava', async () => {
  const store = new InMemoryEditorialStore();
  await store.putArticle(registro('velho', 'passageiro-de-primeira', '2026-11-20T11:00:00.000Z'));
  await store.putArticle(registro('novo', 'passageiro-de-primeira', '2026-11-27T12:00:00.000Z'));
  await store.putArticle(registro('redigido', 'abemf', '2026-11-01T00:00:00.000Z', { status: 'em_checagem' }));
  assert.equal(await purgeRawText(store, new Date(T0)), 1);
  const v = (await store.getArticle('velho'))!.evidences[0]!;
  assert.deepEqual([v.text, v.outboundLinks, v.url, v.contentSha256.length, v.title], ['', undefined, 'https://x.example/velho', 64, 'Título MOCK']);
  assert.equal((await store.getArticle('novo'))!.evidences[0]!.text, 'Texto bruto MOCK');
  assert.equal((await store.getArticle('redigido'))!.evidences[0]!.text, 'Texto bruto MOCK');
  assert.equal(await purgeRawText(store, new Date(T0)), 0);
  assert.equal((await store.listAudit()).filter((a) => a.action === RAW_TEXT_ACTION).length, 1);
});

test('retirada: apaga já texto, título e links da fonte ou do endereço pedido', async () => {
  const store = new InMemoryEditorialStore();
  await store.putArticle(registro('a', 'mestre-das-milhas', '2026-11-28T11:00:00.000Z'));
  await store.putArticle(registro('b', 'abemf', '2026-11-28T11:00:00.000Z'));
  await store.putArticle(registro('c', 'abemf', '2026-11-28T11:00:00.000Z'));
  assert.equal(await withdrawCollected(store, new Date(T0), { sourceId: 'mestre-das-milhas' }), 1);
  assert.equal(await withdrawCollected(store, new Date(T0), { url: 'https://www.x.example/b/?utm_source=feed#topo' }), 1, 'www, barra, rastreio e fragmento não escondem a página');
  assert.equal(await withdrawCollected(store, new Date(T0), { url: 'https://x.example/c?p=2' }), 0, 'parâmetro que não é rastreio é outra página');
  for (const id of ['a', 'b']) {
    const e = (await store.getArticle(id))!.evidences[0]!;
    assert.deepEqual([e.text, e.title, e.outboundLinks], ['', '', undefined], id);
  }
  assert.equal((await store.getArticle('c'))!.evidences[0]!.text, 'Texto bruto MOCK');
});

test('coleta contínua: o prazo do texto bruto roda a cada rodada, mesmo quando ela falha', () => {
  const src = readFileSync(join(ROOT, 'apps/workers/src/editorial-collector.ts'), 'utf8').replace(/\r/g, '');
  assert.match(src, /finally \{\n[^\n]*\n\s*await purgeRawText\(store, now\(\)\)/);
});

test('onde vale a lista permitida: só a coleta contínua; fábrica e pauta autoral recebem apenas o contador dos blogs', () => {
  const store = new InMemoryEditorialStore();
  assert.deepEqual(COLLECTOR_ALLOWLIST.appliesTo, ['coleta_continua']);
  assert.deepEqual(Object.keys(registeredCollectorGuards(store, 'fabrica')), ['restrictedBudget']);
  assert.deepEqual(Object.keys(registeredCollectorGuards(store, 'pauta_autoral')), ['restrictedBudget']);
  const ligada = registeredCollectorGuards(store, 'fabrica', { ...COLLECTOR_ALLOWLIST, appliesTo: ['coleta_continua', 'fabrica'] });
  assert.ok(ligada.allowlist && ligada.hostBudget, 'configurável: basta a decisão incluir o uso');
});

test('workers: todo coletor construído declara o uso, e o main não substitui as travas', () => {
  const dir = join(ROOT, 'apps/workers/src');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const linha of src.split('\n').filter((l) => l.includes('new Collector('))) assert.match(linha, /registeredCollectorGuards\(store, '(coleta_continua|fabrica|pauta_autoral)'\)/, f);
    if (f.endsWith('main.ts')) assert.ok(!/collectorGuards\s*:|collector\s*:/.test(src), `${f} não pode substituir o coletor nem as travas`);
  }
});
