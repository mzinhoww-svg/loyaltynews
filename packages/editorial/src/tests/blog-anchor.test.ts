// DP-59: blog autorizado pode ancorar; todo o resto das travas continua.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MockFetcher } from '../../fixtures/mock-web.mock';
import { InMemoryEditorialStore } from '../api/store';
import { reviewSource, setSourceEnabled } from '../api/source-handlers';
import { createLlmGateway } from '../factory/llm-gateway';
import type { ChatRequest, ChatResult, ChatTransport } from '../factory/llm-gateway';
import { BLOG_ANCHOR_RULE, buildMessages } from '../factory/prompts';
import { runFactory } from '../factory/run';
import { InMemoryAuditLog } from '../pipeline/stages';
import { BLOG_ANCHOR_ALLOWLIST, isPermittedBlogAnchor } from '../rules/blog-anchor';
import { checkAnchoring } from '../rules/rules';
import { SourceRegistry } from '../sources/registry';
import { SEED_SOURCES } from '../sources/seed';
import type { Draft, Evidence, Source } from '../types';

const NOW = new Date('2026-11-28T12:00:00Z');
const HOST = 'passageirodeprimeira.com';
const ev = (id: string, over: Partial<Evidence> = {}): Evidence => ({
  id, sourceId: 'passageiro-de-primeira', url: `https://${HOST}/${id}`, canonicalUrl: `https://${HOST}/${id}`, fetchedAt: NOW.toISOString(), contentSha256: 'a'.repeat(64),
  title: id, text: 'texto', publishedAt: null, suspicious: false, suspiciousReasons: [], sourceTier: 'secondary', ...over,
});
const outro = (id: string) => ev(id, { sourceId: 'outro-blog', url: `https://outro.example/${id}`, canonicalUrl: `https://outro.example/${id}` });
const oficial = (id: string) => ev(id, { sourceId: 'abemf', sourceTier: 'primary', url: `https://web.abemf.com.br/${id}`, canonicalUrl: `https://web.abemf.com.br/${id}` });
const draft = (claims: Array<{ kind: 'fact' | 'number' | 'date' | 'quote'; ids: string[] }>, ids: string[]): Draft => ({
  evidenceIds: ids, claims: claims.map((c, i) => ({ id: `c${i}`, kind: c.kind, text: 't', evidenceIds: c.ids })),
} as unknown as Draft);
const codes = (d: Draft, evs: Evidence[]) => checkAnchoring(d, evs).findings.map((f) => `${f.code}:${f.claimId ?? ''}`);

test('lista: exatamente os dois blogs da decisão, secundários no cadastro e com o mesmo host', () => {
  assert.equal(BLOG_ANCHOR_ALLOWLIST.decisionId, 'DP-59');
  assert.deepEqual(BLOG_ANCHOR_ALLOWLIST.sources.map((s) => s.id), ['passageiro-de-primeira', 'mestre-das-milhas']);
  for (const a of BLOG_ANCHOR_ALLOWLIST.sources) {
    const s = SEED_SOURCES.find((x) => x.id === a.id)!;
    assert.equal(s.host, a.host);
    assert.equal(s.kind, 'blog');
  }
});

test('blog autorizado ancora fato, número e data; citação continua pedindo fonte primária', () => {
  const b = ev('b');
  assert.deepEqual(codes(draft([{ kind: 'fact', ids: ['b'] }, { kind: 'number', ids: ['b'] }, { kind: 'date', ids: ['b'] }], ['b']), [b]), []);
  assert.deepEqual(codes(draft([{ kind: 'quote', ids: ['b'] }], ['b']), [b]), ['unanchored_claim:c0']);
  assert.deepEqual(codes(draft([{ kind: 'quote', ids: ['b', 'p'] }], ['b', 'p']), [b, oficial('p')]), []);
});

test('não vale: outro blog, host trocado, canônico de outro site, provedor de leitura, evidência suspeita ou sem https', () => {
  const ruins = [
    outro('o'), ev('h', { url: 'https://mau.example/h' }), ev('c', { canonicalUrl: 'https://mau.example/c' }), ev('v', { acesso: 'via-provedor' }),
    ev('s', { suspicious: true }), ev('i', { url: `http://${HOST}/i` }), ev('w', { url: `https://www.${HOST}/w` }),
  ];
  for (const e of ruins) {
    assert.equal(isPermittedBlogAnchor(e), false, e.id);
    assert.deepEqual(codes(draft([{ kind: 'number', ids: [e.id] }], [e.id]), [e]), ['needs_primary_anchor:', 'unanchored_claim:c0'], e.id);
  }
});

test('mistura: número que só o outro blog diz continua barrado mesmo com o blog autorizado na matéria', () => {
  assert.deepEqual(codes(draft([{ kind: 'number', ids: ['o'] }, { kind: 'number', ids: ['b'] }], ['b', 'o']), [ev('b'), outro('o')]), ['unanchored_claim:c0']);
});

test('prompt: a regra 7 só entra quando a entrada traz blog autorizado', () => {
  const sem = buildMessages({ taskClass: 'draft', input: { evidences: [{ id: 'a', tier: 'secondary' }] } })[0]!.content;
  const com = buildMessages({ taskClass: 'draft', input: { evidences: [{ id: 'a', tier: 'blog_ancora' }] } })[0]!.content;
  assert.ok(!sem.includes(BLOG_ANCHOR_RULE));
  assert.ok(com.includes(BLOG_ANCHOR_RULE));
});

class Llm implements ChatTransport {
  calls: ChatRequest[] = [];
  constructor(private readonly sameProvider = false) {}
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.calls.push(req);
    const input = JSON.parse(req.messages[1]!.content.slice(req.messages[1]!.content.indexOf('\n') + 1)) as { evidences?: Array<{ id: string }>; claims?: Array<{ id: string }> };
    const ids = (input.evidences ?? []).map((e) => e.id);
    let out: unknown = {};
    if (req.taskClass === 'triage') out = { relevant: true, editoria: 'pontos' };
    if (req.taskClass === 'context') out = { notes: [{ text: 'Contexto MOCK.', evidenceIds: ids.slice(0, 1) }] };
    if (req.taskClass === 'draft') out = {
      headline: 'MOCK: programa amplia bônus de transferência', resumo: 'Informação de exemplo atribuída ao blog MOCK.',
      body: 'Segundo o Passageiro de Primeira, o programa de exemplo oferece 90 por cento de bônus. A informação ainda não tem confirmação oficial.',
      claims: [{ id: 'c1', kind: 'number', text: '90 por cento de bônus', evidenceIds: ids }],
    };
    if (req.taskClass === 'factcheck') out = { verdicts: (input.claims ?? []).map((c) => ({ claimId: c.id, verdict: 'pass' })) };
    if (req.taskClass === 'review') out = { approve: true, issues: [] };
    const provider = this.sameProvider ? 'deepseek' : req.excludeProviders.includes('deepseek') ? 'anthropic' : 'deepseek';
    return { ok: true, provider, model: `${req.route}-mock`, text: JSON.stringify(out), usage: { inputTokens: 1, outputTokens: 1, costMicrosUsd: 0 } };
  }
}

async function rodar(llm: Llm) {
  const blog: Source = { ...SEED_SOURCES.find((s) => s.id === 'passageiro-de-primeira')!, enabled: false, termsStatus: 'pending', urlVerified: false, paywall: 'none' };
  const registry = new SourceRegistry([blog]);
  const store = new InMemoryEditorialStore();
  const ctx = (userId: string, role: 'editor_chefe' | 'admin') => ({ actor: { userId, roles: [role], mfa: true }, store, sources: registry, now: () => NOW, newId: () => 'id' });
  const rv = await reviewSource(ctx('chefe', 'editor_chefe'), { sourceId: blog.id, termsStatus: 'approved', termsNote: 'MOCK: DP-103, risco aceito.', urlVerified: true, robotsChecked: true, paywall: 'none' });
  assert.equal(rv.status, 200, JSON.stringify(rv.body));
  assert.equal((await setSourceEnabled(ctx('admin', 'admin'), { sourceId: blog.id, enabled: true })).status, 200);
  const post = `https://${HOST}/post-mock`;
  const fetcher = new MockFetcher({
    [`https://${HOST}/robots.txt`]: { status: 200, headers: {}, body: 'User-agent: *\nDisallow:' },
    [`https://${HOST}/feed/`]: { status: 200, headers: {}, body: `<rss><channel><item><title>MOCK bônus</title><link>${post}</link></item></channel></rss>` },
    [post]: { status: 200, headers: {}, body: `<html><head><title>MOCK bônus</title></head><body><article><h1>MOCK bônus</h1><p>${'Publicação fictícia sobre um bônus de 90 por cento no programa de exemplo, para teste. '.repeat(6)}</p></article></body></html>` },
  });
  const audit = new InMemoryAuditLog();
  const rep = await runFactory({
    store, registry, gateway: createLlmGateway(llm), audit, flags: { editorialCollector: true, editorialPipeline: true }, now: () => NOW,
    collector: new Collector(fetcher, { minSpacingMs: 0, now: () => NOW, resolver: new FakeResolver({ [HOST]: [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON, sleep: async () => {} }),
  }, { onlySourceIds: [blog.id] });
  return { rep, store };
}

test('fábrica: post de blog autorizado sem página oficial segue, com link, regra 7 e versão registrada', async () => {
  const llm = new Llm();
  const { rep, store } = await rodar(llm);
  const a = rep.articles[0]!;
  assert.equal(a.status, 'aprovado', JSON.stringify(a));
  const rec = (await store.getArticle(a.articleId))!;
  assert.ok(rec.draft!.body.includes(`https://${HOST}/post-mock`), 'link da fonte');
  assert.equal(rec.draft!.promptVersion, 'editorial-0.3+dp59');
  assert.ok(llm.calls.find((c) => c.taskClass === 'draft')!.messages[0]!.content.includes(BLOG_ANCHOR_RULE));
});

test('fábrica: checagem no mesmo provedor do redator continua barrando matéria de blog', async () => {
  const { rep } = await rodar(new Llm(true));
  const a = rep.articles[0]!;
  assert.equal(a.status, 'bloqueado');
  assert.ok(a.blockers.includes('cross_provider_check_failed'), a.blockers.join(','));
});
