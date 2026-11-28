import { test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher, mockWeb } from '../../fixtures/mock-web.mock';
const mockResolver = () => new FakeResolver({ 'ri.mock.example': [[MOCK_PUBLIC_IP]], 'blog.mock.example': [[MOCK_PUBLIC_IP]] });
import { SourceRegistry } from '../sources/registry';
import { InMemoryAuditLog } from '../pipeline/stages';
import { InMemoryEditorialStore } from '../api/store';
import type { HandlerCtx, Actor } from '../api/handlers';
import { reviewSource, setSourceEnabled } from '../api/source-handlers';
import { createLlmGateway } from '../factory/llm-gateway';
import type { ChatRequest, ChatResult, ChatTransport } from '../factory/llm-gateway';
import { buildMessages, TOM_DE_VOZ } from '../factory/prompts';
import { runFactory } from '../factory/run';
import type { FactoryDeps } from '../factory/run';
import { runAutoral, PautaAutoral } from '../factory/autoral';
import { AUTORAL_LABEL, checkAnchoring, checkAutoral, checkOriginality } from '../rules/rules';
import { FlagDisabled } from '../flags';
import type { Draft, Evidence, Source } from '../types';

const NOW = new Date('2026-11-25T12:00:00Z');
const FLAGS = { editorialCollector: true, editorialPipeline: true } as const;
const chefe: Actor = { userId: 'maria-chefe', roles: ['editor_chefe'], mfa: true };
const admin: Actor = { userId: 'joao-admin', roles: ['admin'], mfa: true };
const VER = { level: 'lido', researchedBy: 'ln-editorial-engineer', robots: 'permitido', robotsNote: 'MOCK', termsExcerpt: null, termsFetchedAt: null, consultedAt: null, imageRightsNote: 'não informado', notes: 'MOCK' } as const;

const PRIMARY: Source = { ...MOCK_SOURCE, enabled: false, termsStatus: 'pending', urlVerified: false, verification: VER };
const BLOG: Source = {
  ...PRIMARY, id: 'mock-blog', name: 'MOCK Blog Especializado', kind: 'blog', host: 'blog.mock.example',
  listingUrl: 'https://blog.mock.example/', feedUrl: 'https://blog.mock.example/feed.xml', termsUrl: 'https://blog.mock.example/termos',
};

let store: InMemoryEditorialStore;
let registry: SourceRegistry;
beforeEach(() => { store = new InMemoryEditorialStore(); registry = new SourceRegistry([PRIMARY, BLOG]); });
const hctx = (actor: Actor): HandlerCtx => ({ actor, store, sources: registry, now: () => NOW, newId: () => 'id' });
async function enable(id: string) {
  const rv = await reviewSource(hctx(chefe), { sourceId: id, termsStatus: 'approved', termsNote: 'DP-28/DP-29, classe D, risco aceito pelo proprietário; termos lidos.', urlVerified: true, robotsChecked: true, paywall: 'none' });
  assert.equal(rv.status, 200);
  assert.equal((await setSourceEnabled(hctx(admin), { sourceId: id, enabled: true })).status, 200);
}

const BLOG_POST = (links: string) => `<html><head><title>MOCK Blog</title></head><body><article><h1>Alfa e Beta fecham parceria de acúmulo</h1>
<p>Comentamos hoje que o Programa Alfa e a Varejista Beta anunciaram uma nova aliança para quem junta pontos nas compras do dia a dia, com regra própria de acúmulo.</p>
<p>Na nossa leitura, a novidade interessa a quem já compra na rede e quer entender o ganho extra de pontos, que vale a partir do mês que vem segundo o comunicado. ${links}</p>
<p>Vale acompanhar os próximos anúncios dos programas para saber se outras redes entram na mesma regra de acúmulo e como ficam as validades dos pontos.</p></article></body></html>`;
const PAGE_BETA = `<html><head><title>MOCK Beta</title><link rel="canonical" href="https://ri.mock.example/noticias/beta-comunicado"/></head><body><article><h1>MOCK: Varejista Beta detalha regras do acúmulo</h1>
<p>A Varejista Beta (empresa fictícia) detalhou em comunicado as regras do acúmulo de pontos com o Programa Alfa, válidas para compras em lojas físicas e no aplicativo.</p>
<p>O comunicado informa que a validade dos pontos acumulados é de 12 meses e que o acúmulo começa em 1 de dezembro de 2026, com limite mensal definido pela empresa.</p>
<p>A Varejista Beta afirma que o regulamento completo estará disponível no site oficial do programa até o início da vigência da parceria.</p></article></body></html>`;

function web(post: string): MockFetcher {
  const w = mockWeb();
  w.routes.set('https://ri.mock.example/noticias/beta-comunicado', { status: 200, headers: {}, body: PAGE_BETA });
  w.routes.set('https://blog.mock.example/robots.txt', { status: 200, headers: {}, body: 'User-agent: *\nDisallow:' });
  w.routes.set('https://blog.mock.example/feed.xml', { status: 200, headers: {}, body: '<rss><channel><item><title>Alfa e Beta fecham parceria de acúmulo</title><link>https://blog.mock.example/post-alfa-beta</link><pubDate>Mon, 23 Nov 2026 12:00:00 +0000</pubDate></item></channel></rss>' });
  w.routes.set('https://blog.mock.example/post-alfa-beta', { status: 200, headers: {}, body: post });
  return w;
}

/** LLM FALSO que respeita o "tier" das evidências: cita a fonte primária nos números e datas. `mode` escolhe o defeito a injetar. */
class Llm implements ChatTransport {
  calls: ChatRequest[] = [];
  constructor(private readonly mode: 'ok' | 'blog_only_numbers' | 'quote_in_autoral' = 'ok') {}
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.calls.push(req);
    const input = JSON.parse(req.messages[1]!.content.slice(req.messages[1]!.content.indexOf('\n') + 1)) as { evidences: Array<{ id: string; tier: string }>; mode?: string };
    const evs = input.evidences ?? [];
    const prim = evs.filter((e) => e.tier === 'primary').map((e) => e.id);
    const sec = evs.filter((e) => e.tier === 'secondary').map((e) => e.id);
    const all = evs.map((e) => e.id);
    const usage = { inputTokens: 1, outputTokens: 1, costMicrosUsd: 0 };
    let out: unknown;
    switch (req.taskClass) {
      case 'triage': out = { relevant: true, editoria: 'pontos' }; break;
      case 'context': out = { notes: [{ text: 'Contexto MOCK.', evidenceIds: [all[0]] }] }; break;
      case 'draft': {
        const numEv = this.mode === 'blog_only_numbers' && sec.length ? sec : prim;
        const claims: unknown[] = [
          { id: 'c1', kind: 'fact', text: 'Programa Alfa e Varejista Beta anunciaram parceria de acúmulo', evidenceIds: all },
          { id: 'c2', kind: 'number', text: '2 pontos por real gasto', evidenceIds: numEv },
          { id: 'c3', kind: 'date', text: 'a partir de 1 de dezembro de 2026', evidenceIds: numEv },
        ];
        if (input.mode === 'autoral' && this.mode === 'quote_in_autoral') claims.push({ id: 'c4', kind: 'quote', text: 'fala', evidenceIds: prim, quote: { text: 'x', speaker: 'y' } });
        out = {
          headline: input.mode === 'autoral' ? 'MOCK: o que muda no acúmulo com a nova aliança entre Alfa e Beta' : 'MOCK: nova parceria liga o Programa Alfa à Varejista Beta no acúmulo',
          resumo: 'Parceria fictícia de acúmulo entre Programa Alfa e Varejista Beta, com validade e vigência definidas em comunicado.',
          body: 'Programa Alfa e Varejista Beta firmaram uma aliança para o acúmulo de pontos nas compras dos clientes. ' +
            'Cada real gasto renderá 2 pontos ao cliente. A vigência da regra começa em dezembro, no dia 1, ainda em 2026, de acordo com o comunicado.',
          claims,
        };
        break;
      }
      case 'factcheck': out = { verdicts: ((input as unknown as { claims: Array<{ id: string }> }).claims ?? []).map((c) => ({ claimId: c.id, verdict: 'pass' })) }; break;
      case 'review': out = { approve: true, issues: [] }; break;
      default: out = {};
    }
    return { ok: true, provider: req.excludeProviders.includes('deepseek') ? 'anthropic' : 'deepseek', model: `${req.route}-mock`, text: JSON.stringify(out), usage };
  }
}

function deps(llm: ChatTransport, fetcher: MockFetcher, over: Partial<FactoryDeps> = {}): FactoryDeps {
  return {
    store, registry, gateway: createLlmGateway(llm), audit: new InMemoryAuditLog(), flags: FLAGS, now: () => NOW,
    collector: new Collector(fetcher, { minSpacingMs: 0, now: () => NOW, resolver: mockResolver(), flags: COLLECT_ON, sleep: async () => {} }), ...over,
  };
}
const LINK_PRIMARY = '<a href="https://ri.mock.example/noticias/alfa-parceria">comunicado oficial</a>';

test('blog com link para fonte primária habilitada: a fábrica coleta a âncora, o modelo recebe o nível (tier) e a matéria é aprovada', async () => {
  await enable('mock-ri'); await enable('mock-blog');
  const llm = new Llm();
  const rep = await runFactory(deps(llm, web(BLOG_POST(LINK_PRIMARY))), { onlySourceIds: ['mock-blog'] });
  assert.equal(rep.articles.length, 1);
  const a = rep.articles[0]!;
  assert.deepEqual(a.anchors, ['https://ri.mock.example/noticias/alfa-parceria']);
  assert.equal(a.status, 'aprovado', JSON.stringify(a));
  const rec = (await store.getArticle(a.articleId))!;
  assert.equal(rec.evidences.length, 2);
  assert.deepEqual(rec.evidences.map((e) => e.sourceTier), ['secondary', 'primary']);
  assert.ok(rec.draft!.body.includes('https://blog.mock.example/post-alfa-beta') && rec.draft!.body.includes('https://ri.mock.example/noticias/alfa-parceria'), 'as duas fontes ficam atribuídas');
  const sent = JSON.parse(llm.calls.find((c) => c.taskClass === 'draft')!.messages[1]!.content.split('\n').slice(1).join('\n')) as { evidences: Array<{ tier: string }> };
  assert.deepEqual(sent.evidences.map((e) => e.tier), ['secondary', 'primary']);
});

test('blog sem link para fonte primária: bloqueado como "unanchored" ANTES de chamar o modelo (não gasta chamada)', async () => {
  await enable('mock-ri'); await enable('mock-blog');
  const llm = new Llm();
  const rep = await runFactory(deps(llm, web(BLOG_POST('<a href="https://outro-site.example/x">outro site</a>'))), { onlySourceIds: ['mock-blog'] });
  const a = rep.articles[0]!;
  assert.equal(a.status, 'bloqueado');
  assert.deepEqual(a.blockers, ['unanchored']);
  assert.match(a.findings[0]!, /não linka nenhuma fonte primária habilitada/);
  assert.equal(llm.calls.length, 0, 'nenhuma chamada de modelo');
});

test('link para fonte primária NÃO habilitada não ancora (a âncora só vale se a fonte passou pela revisão humana)', async () => {
  await enable('mock-blog'); // mock-ri continua desabilitada
  const llm = new Llm();
  const rep = await runFactory(deps(llm, web(BLOG_POST(LINK_PRIMARY))), { onlySourceIds: ['mock-blog'] });
  assert.equal(rep.articles[0]!.status, 'bloqueado');
  assert.equal(llm.calls.length, 0);
});

test('número e data sustentados só pelo blog são barrados (unanchored_claim) mesmo com âncora no texto', async () => {
  await enable('mock-ri'); await enable('mock-blog');
  const rep = await runFactory(deps(new Llm('blog_only_numbers'), web(BLOG_POST(LINK_PRIMARY))), { onlySourceIds: ['mock-blog'] });
  const a = rep.articles[0]!;
  assert.equal(a.status, 'bloqueado');
  assert.ok(a.blockers.includes('unanchored'), a.blockers.join(','));
  assert.ok(a.findings.some((f) => f.startsWith('unanchored_claim')));
});

const ev = (id: string, tier: 'primary' | 'secondary', text: string, url = `https://x.example/${id}`): Evidence => ({
  id, sourceId: id, url, canonicalUrl: url, fetchedAt: '2026-11-25T12:00:00.000Z', contentSha256: 'a'.repeat(64), title: id, text, publishedAt: null,
  suspicious: false, suspiciousReasons: [], sourceTier: tier,
});
const draftOf = (over: Partial<Draft>): Draft => ({
  id: 'd', editoria: 'pontos', headline: 'h', body: 'texto', slug: 's', resumo: 'r', tipoConteudo: 'noticia', classeDeDado: 'public', patrocinado: false,
  claims: [], evidenceIds: [], signature: 'Redação Loyalty News', image: { mode: 'none', reason: 'x' }, modelProvider: 'p', promptVersion: 'v', ...over,
} as Draft);

test('gate de âncora: só secundária falha; número só no blog falha; fato do blog + número na primária passa; sem blog nada muda', () => {
  const b = ev('blog', 'secondary', 'texto do blog'); const p = ev('prim', 'primary', 'texto oficial');
  const claim = (kind: 'fact' | 'number', ids: string[], id = 'c') => ({ id, kind, text: 't', evidenceIds: ids });
  const codes = (d: Draft, evs: Evidence[]) => checkAnchoring(d, evs).findings.map((f) => f.code);
  assert.deepEqual(codes(draftOf({ evidenceIds: ['blog'], claims: [claim('fact', ['blog'])] }), [b, p]), ['needs_primary_anchor']);
  assert.deepEqual(codes(draftOf({ evidenceIds: ['blog', 'prim'], claims: [claim('fact', ['blog']), claim('number', ['blog'], 'n')] }), [b, p]), ['unanchored_claim']);
  assert.deepEqual(codes(draftOf({ evidenceIds: ['blog', 'prim'], claims: [claim('fact', ['blog']), claim('number', ['prim', 'blog'], 'n')] }), [b, p]), []);
  assert.deepEqual(codes(draftOf({ evidenceIds: ['prim'], claims: [claim('number', ['prim'])] }), [p]), []);
  const legacy: Evidence = { ...p }; delete legacy.sourceTier; // evidência anterior à DP-29 = primária
  assert.deepEqual(codes(draftOf({ evidenceIds: ['prim'], claims: [claim('number', ['prim'])] }), [legacy]), []);
});

test('gate de cópia mais rígido para fonte secundária: 7 palavras seguidas iguais barram blog (limite 6) e passam fonte primária (limite 8)', () => {
  const trecho = 'o programa anunciou regras novas de acúmulo'; // 7 palavras
  const body = `Segundo informações recentes, ${trecho} para todos os clientes do país nesta semana, e ainda há muito o que explicar sobre vigência, limites mensais, validade e parceiros envolvidos no regulamento completo divulgado.`;
  const d = draftOf({ body, evidenceIds: ['e'] });
  const text = `Introdução diferente aqui. ${trecho} e depois outra coisa qualquer completamente distinta sem relação nenhuma com o corpo.`;
  assert.ok(checkOriginality(d, [ev('e', 'secondary', text)]).findings.some((f) => f.code === 'copy_literal'));
  assert.deepEqual(checkOriginality(d, [ev('e', 'primary', text)]).findings, []);
});

test('prompts: tom de voz só na redação/revisão/social; regra de tier e de reescrita no sistema; prompt autoral por mode', () => {
  const sys = (taskClass: Parameters<typeof buildMessages>[0]['taskClass'], input: unknown = {}) => buildMessages({ taskClass, input })[0]!.content;
  assert.ok(sys('draft').includes(TOM_DE_VOZ) && sys('review').includes(TOM_DE_VOZ));
  assert.ok(!sys('factcheck').includes(TOM_DE_VOZ) && !sys('triage').includes(TOM_DE_VOZ));
  assert.match(sys('draft'), /"tier": "primary"/);
  assert.match(sys('draft'), /no máximo 5 palavras seguidas/);
  assert.ok(!/AUTORAL/.test(sys('draft')));
  const a = sys('draft', { mode: 'autoral', pauta: {} });
  assert.match(a, /conteúdo AUTORAL/); assert.match(a, /"headline"/); assert.match(a, /acrescenta/);
});

const PAUTA = { id: 'acumulo-alfa-beta', titulo: 'O que muda no acúmulo com a nova aliança', angulo: 'Explicar, com base nos comunicados oficiais, como ficam validade e vigência dos pontos.', formato: 'explicador', editoria: 'pontos',
  ancoras: ['https://ri.mock.example/noticias/alfa-parceria', 'https://ri.mock.example/noticias/beta-comunicado'] };

test('autoral: pauta com 2 âncoras primárias habilitadas é redigida, ganha aviso, tipo "analise", sem imagem e é aprovada; repetir a pauta não duplica', async () => {
  await enable('mock-ri');
  const llm = new Llm();
  const d = deps(llm, web(''));
  const rep = await runAutoral(d, PAUTA);
  assert.equal(rep.status, 'aprovado', JSON.stringify(rep));
  assert.deepEqual(rep.stages, ['context', 'draft', 'factcheck', 'review']);
  const rec = (await store.getArticle(rep.articleId))!;
  assert.ok(rec.draft!.body.startsWith(AUTORAL_LABEL));
  assert.equal(rec.draft!.tipoConteudo, 'analise');
  assert.deepEqual(rec.draft!.autoral, { formato: 'explicador', pautaId: 'acumulo-alfa-beta' });
  assert.equal(rec.draft!.image.mode, 'none');
  assert.ok(rec.evidences.length === 2);
  const sent = llm.calls.find((c) => c.taskClass === 'draft')!.messages[0]!.content;
  assert.match(sent, /conteúdo AUTORAL/);
  const again = await runAutoral(d, PAUTA);
  assert.equal(again.status, 'ja_existe');
  assert.equal(llm.calls.filter((c) => c.taskClass === 'draft').length, 1);
});

test('autoral: sem fonte primária habilitada para as âncoras, bloqueia sem chamar o modelo; pauta inválida e flags desligadas são recusadas', async () => {
  const llm = new Llm();
  const rep = await runAutoral(deps(llm, web('')), PAUTA); // mock-ri NÃO habilitada
  assert.equal(rep.status, 'bloqueado');
  assert.deepEqual(rep.blockers, ['autoral_invalid']);
  assert.match(rep.findings[0]!, /autoral_needs_anchors/);
  assert.equal(llm.calls.length, 0);
  await assert.rejects(() => runAutoral(deps(llm, web('')), { ...PAUTA, ancoras: [PAUTA.ancoras[0]] }), /pauta autoral inválida/);
  await assert.rejects(() => runAutoral(deps(llm, web('')), { ...PAUTA, id: 'Pauta Ruim' }), /pauta autoral inválida/);
  assert.equal(PautaAutoral.safeParse({ ...PAUTA, formato: 'noticia' }).success, false);
  await assert.rejects(() => runAutoral(deps(llm, web(''), { flags: {} }), PAUTA), FlagDisabled);
});

test('autoral: gate exige aviso, tipo analise, 2 páginas primárias distintas e nenhuma fala', async () => {
  const a = ev('a', 'primary', 't', 'https://x.example/a'); const b = ev('b', 'primary', 't', 'https://x.example/b');
  const base = draftOf({ autoral: { formato: 'analise', pautaId: 'p' }, tipoConteudo: 'analise', body: `${AUTORAL_LABEL}\n\ncorpo`, evidenceIds: ['a', 'b'] });
  assert.deepEqual(checkAutoral(base, [a, b]).findings, []);
  const codes = (d: Draft, evs: Evidence[]) => checkAutoral(d, evs).findings.map((f) => f.code).sort();
  assert.deepEqual(codes({ ...base, evidenceIds: ['a'] }, [a, b]), ['autoral_needs_anchors']);
  assert.deepEqual(codes({ ...base, body: 'corpo sem aviso' }, [a, b]), ['autoral_label_missing']);
  assert.deepEqual(codes({ ...base, tipoConteudo: 'noticia' }, [a, b]), ['autoral_wrong_type']);
  assert.deepEqual(codes({ ...base, claims: [{ id: 'q', kind: 'quote', text: 't', evidenceIds: ['a'], quote: { text: 'x', speaker: 'y' } }] }, [a, b]), ['autoral_quote']);
  assert.deepEqual(codes({ ...base, evidenceIds: ['a', 'b'] }, [a, ev('b', 'secondary', 't', 'https://x.example/b')]), ['autoral_needs_anchors'], 'blog não conta como âncora');
  assert.deepEqual(checkAutoral(draftOf({}), []).findings, [], 'sem autoral, a regra não se aplica');
});
