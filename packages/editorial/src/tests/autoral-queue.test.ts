import { test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { COLLECT_ON, FakeResolver, MOCK_PUBLIC_IP, MOCK_SOURCE, MockFetcher, mockWeb } from '../../fixtures/mock-web.mock';
import { SourceRegistry } from '../sources/registry';
import { InMemoryAuditLog } from '../pipeline/stages';
import { InMemoryEditorialStore } from '../api/store';
import type { Actor, HandlerCtx } from '../api/handlers';
import { reviewSource, setSourceEnabled } from '../api/source-handlers';
import { listPautas, submitPauta } from '../api/pauta-handlers';
import { createLlmGateway } from '../factory/llm-gateway';
import type { ChatRequest, ChatResult, ChatTransport } from '../factory/llm-gateway';
import { runAutoralQueue } from '../factory/autoral-queue';
import type { FactoryDeps } from '../factory/run';
import type { Source } from '../types';

const NOW = new Date('2026-11-25T12:00:00Z');
const FLAGS = { editorialCollector: true, editorialPipeline: true } as const;
const chefe: Actor = { userId: 'maria-chefe', roles: ['editor_chefe'], mfa: true };
const admin: Actor = { userId: 'joao-admin', roles: ['admin'], mfa: true };
const editor: Actor = { userId: 'edu-editor', roles: ['editor'], mfa: true };
const PRIMARY: Source = { ...MOCK_SOURCE, enabled: false, termsStatus: 'pending', urlVerified: false, verification: { level: 'lido', researchedBy: 'ln-editorial-engineer', robots: 'permitido', robotsNote: 'x', termsExcerpt: null, termsFetchedAt: null, consultedAt: null, imageRightsNote: 'x', notes: 'x' } };
const PAGE_BETA = `<html><head><title>MOCK Beta</title><link rel="canonical" href="https://ri.mock.example/noticias/beta"/></head><body><article><h1>MOCK: Beta detalha regras</h1><p>A Varejista Beta (empresa fictícia) detalhou em comunicado as regras do acúmulo de pontos com o Programa Alfa, válidas para lojas físicas e aplicativo.</p><p>O comunicado informa que o acúmulo será de 2 pontos por real gasto a partir de 1 de dezembro de 2026, com regulamento no site oficial.</p><p>A empresa afirma que o regulamento completo estará disponível antes do início da vigência da parceria divulgada hoje.</p></article></body></html>`;
const PAUTA = { id: 'acumulo-alfa-beta', titulo: 'O que muda no acúmulo com a nova aliança', angulo: 'Explicar, com base nos comunicados oficiais, como ficam vigência e regra de pontos.', formato: 'explicador', editoria: 'pontos',
  ancoras: ['https://ri.mock.example/noticias/alfa-parceria', 'https://ri.mock.example/noticias/beta'] };

class Llm implements ChatTransport {
  calls: ChatRequest[] = [];
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.calls.push(req);
    const c = req.messages[1]!.content; const input = JSON.parse(c.slice(c.indexOf('\n') + 1)) as { evidences?: Array<{ id: string }>; claims?: Array<{ id: string }> };
    const ids = (input.evidences ?? []).map((e) => e.id);
    const out: Record<string, unknown> = {
      context: { notes: [{ text: 'Contexto.', evidenceIds: [ids[0]] }] },
      draft: { headline: 'MOCK: o que muda no acúmulo com a aliança entre Alfa e Beta', resumo: 'Explicação das regras de acúmulo da parceria fictícia entre Alfa e Beta, com vigência.',
        body: 'Cada real gasto renderá 2 pontos ao cliente. A vigência da regra começa em dezembro, no dia 1, ainda em 2026, de acordo com o comunicado.',
        claims: [{ id: 'c1', kind: 'fact', text: 'parceria de acúmulo', evidenceIds: ids }, { id: 'c2', kind: 'number', text: '2 pontos por real gasto', evidenceIds: ids }, { id: 'c3', kind: 'date', text: '1 de dezembro de 2026', evidenceIds: ids }] },
      factcheck: { verdicts: (input.claims ?? []).map((k) => ({ claimId: k.id, verdict: 'pass' })) },
      review: { approve: true, issues: [] },
    };
    return { ok: true, provider: req.excludeProviders.includes('deepseek') ? 'anthropic' : 'deepseek', model: `${req.route}-mock`, text: JSON.stringify(out[req.taskClass] ?? {}), usage: { inputTokens: 1, outputTokens: 1, costMicrosUsd: 0 } };
  }
}

let store: InMemoryEditorialStore; let registry: SourceRegistry;
beforeEach(() => { store = new InMemoryEditorialStore(); registry = new SourceRegistry([PRIMARY]); });
const hctx = (a: Actor): HandlerCtx => ({ actor: a, store, sources: registry, now: () => NOW, newId: () => 'id' });
async function enable() {
  assert.equal((await reviewSource(hctx(chefe), { sourceId: 'mock-ri', termsStatus: 'approved', termsNote: 'DP-28: termos lidos; risco aceito pelo proprietário.', urlVerified: true, robotsChecked: true, paywall: 'none' })).status, 200);
  assert.equal((await setSourceEnabled(hctx(admin), { sourceId: 'mock-ri', enabled: true })).status, 200);
}
function deps(llm: ChatTransport): FactoryDeps {
  const w = mockWeb(); w.routes.set('https://ri.mock.example/noticias/beta', { status: 200, headers: {}, body: PAGE_BETA });
  return { store, registry, gateway: createLlmGateway(llm), audit: new InMemoryAuditLog(), flags: FLAGS, now: () => NOW,
    collector: new Collector(w as MockFetcher, { now: () => NOW, resolver: new FakeResolver({ 'ri.mock.example': [[MOCK_PUBLIC_IP]] }), flags: COLLECT_ON, minSpacingMs: 0 }) };
}

test('fila autoral: pauta registrada pela rota (pendente) → worker processa → matéria aprovada na fila comum, pauta marcada processada com o resultado; sem recibo nem publicação', async () => {
  await enable();
  assert.equal((await submitPauta(hctx(editor), PAUTA)).status, 201);
  assert.equal((await listPautas(hctx(editor), {})).body && (await listPautas(hctx(editor), {})).status, 200);
  const llm = new Llm();
  const rep = await runAutoralQueue(deps(llm));
  assert.equal(rep.processed.length, 1); assert.equal(rep.processed[0]!.status, 'aprovado', JSON.stringify(rep));
  const art = (await store.getArticle(rep.processed[0]!.articleId!))!;
  assert.equal(art.status, 'aprovado'); assert.equal(art.draft!.autoral?.pautaId, 'acumulo-alfa-beta'); assert.equal(art.draft!.tipoConteudo, 'analise');
  const lista = ((await listPautas(hctx(admin), {})).body as { items: Array<{ estado: string; resultado?: { status: string; articleId: string } }> }).items;
  assert.equal(lista[0]!.estado, 'processada'); assert.equal(lista[0]!.resultado!.status, 'aprovado'); assert.equal(lista[0]!.resultado!.articleId, art.articleId);
  const again = await runAutoralQueue(deps(llm));
  assert.equal(again.processed.length, 0, 'nada pendente');
  assert.ok(!(await store.listOutbox()).length, 'nada foi para a fila de publicação');
});

test('fila autoral: âncora não habilitada vira resultado "bloqueado" gravado (sem chamar modelo); flags desligadas sobem e a pauta continua pendente; limite por execução', async () => {
  assert.equal((await submitPauta(hctx(chefe), PAUTA)).status, 201);
  assert.equal((await submitPauta(hctx(chefe), { ...PAUTA, id: 'segunda-pauta-alfa' })).status, 201);
  const llm = new Llm();
  await assert.rejects(() => runAutoralQueue({ ...deps(llm), flags: {} }), /flag|desligad/i);
  assert.equal(((await listPautas(hctx(chefe), {})).body as { items: Array<{ estado: string }> }).items.every((p) => p.estado === 'pendente'), true);
  const rep = await runAutoralQueue(deps(llm), { max: 1 }); // mock-ri não habilitada
  assert.equal(rep.processed[0]!.status, 'bloqueado'); assert.equal(rep.pending, 1);
  assert.equal(llm.calls.length, 0);
});

test('submitPauta: RBAC (editor propõe; leitor e revisor não), âncora fora do cadastro primário e id repetido são recusados', async () => {
  const revisor: Actor = { userId: 'r', roles: ['revisor'], mfa: true };
  assert.equal((await submitPauta(hctx(revisor), PAUTA)).status, 403);
  assert.equal((await submitPauta({ ...hctx(editor), actor: null }, PAUTA)).status, 401);
  assert.equal((await submitPauta({ ...hctx(editor), actor: { ...editor, mfa: false } }, PAUTA)).status, 401);
  assert.equal((await submitPauta(hctx(editor), { ...PAUTA, ancoras: [PAUTA.ancoras[0], 'https://outro.example/x'] })).status, 400);
  assert.equal((await submitPauta(hctx(editor), PAUTA)).status, 201);
  assert.equal((await submitPauta(hctx(editor), PAUTA)).status, 409);
  assert.equal((await listPautas(hctx(revisor), {})).status, 200);
  assert.equal((await listPautas({ ...hctx(revisor), actor: { userId: 'l', roles: ['leitor'], mfa: true } }, {})).status, 403);
});

// ---- Identificador estável da revisão do rascunho (piloto de 10 matérias; AgentOps `reviewed_draft_task_id`) ----
import { draftRevision, review as reviewStage } from '../pipeline/stages';
import { draftContentSha256 } from '../publishable';
import { validateModelOutput } from '../factory/output-schemas';

test('revisão do rascunho: checagem e revisão recebem o MESMO identificador (tarefa de redação + hash), que fica na entrada, na auditoria e no registro', async () => {
  await enable();
  assert.equal((await submitPauta(hctx(editor), PAUTA)).status, 201);
  const llm = new Llm();
  const d = deps(llm);
  const rep = await runAutoralQueue(d);
  const art = (await store.getArticle(rep.processed[0]!.articleId!))!;
  const rev = draftRevision({ articleId: art.articleId, editoria: art.editoria, evidences: art.evidences, attempt: 0 }, art.draft!);
  assert.equal(rev.taskId, `${art.articleId}:draft:0`);
  assert.equal(rev.sha256, draftContentSha256(art.draft!));
  assert.deepEqual([art.factcheck!.reviewedDraftTaskId, art.factcheck!.reviewedDraftSha256], [rev.taskId, rev.sha256]);
  assert.deepEqual([art.review!.reviewedDraftTaskId, art.review!.reviewedDraftSha256], [rev.taskId, rev.sha256]);
  const inputOf = (cls: string) => { const c = llm.calls.find((x) => x.taskClass === cls)!.messages[1]!.content; return JSON.parse(c.slice(c.indexOf('\n') + 1)) as { reviewedDraft?: { taskId: string; draftId: string; sha256: string } }; };
  assert.deepEqual(inputOf('factcheck').reviewedDraft, rev); assert.deepEqual(inputOf('review').reviewedDraft, rev);
  assert.equal(inputOf('draft').reviewedDraft, undefined, 'a redação não recebe revisão (ela a produz)');
  const audit = (d.audit as InMemoryAuditLog).entries.filter((e) => e.event === 'model_call' && (e.stage === 'factcheck' || e.stage === 'review'));
  assert.equal(audit.length, 2);
  for (const e of audit) assert.deepEqual([e.reviewedDraftTaskId, e.reviewedDraftSha256], [rev.taskId, rev.sha256]);
  // independência por par: o provedor da checagem difere do redator, e o registro tem os dois
  assert.notEqual(art.factcheck!.provider, art.draft!.modelProvider);
});

test('revisão: rascunho alterado DEPOIS da checagem invalida a aprovação (stale_approval); sem o hash (registro antigo) segue o fluxo', async () => {
  await enable();
  assert.equal((await submitPauta(hctx(editor), PAUTA)).status, 201);
  const llm = new Llm();
  const rep = await runAutoralQueue(deps(llm));
  const art = (await store.getArticle(rep.processed[0]!.articleId!))!;
  const job = { articleId: art.articleId, editoria: art.editoria, evidences: art.evidences, attempt: 0, draft: art.draft!, factcheck: art.factcheck! };
  const stale = await reviewStage({ gateway: createLlmGateway(llm), registry: new SourceRegistry([PRIMARY]), audit: new InMemoryAuditLog(), flags: FLAGS, now: () => NOW },
    { ...job, draft: { ...art.draft!, resumo: `${art.draft!.resumo} (alterado)` } });
  assert.equal(stale.kind, 'blocked');
  if (stale.kind === 'blocked') assert.deepEqual(stale.blocked.blockers, ['stale_approval']);
  const { reviewedDraftSha256: _s, reviewedDraftTaskId: _t, ...legacy } = art.factcheck!;
  void _s; void _t;
  const calls = llm.calls.length;
  const legacyRun = await reviewStage({ gateway: createLlmGateway(llm), registry: new SourceRegistry([PRIMARY]), audit: new InMemoryAuditLog(), flags: FLAGS, now: () => NOW }, { ...job, factcheck: legacy });
  assert.equal(legacyRun.kind, 'done'); assert.equal(llm.calls.length, calls + 1);
});

test('output_valid: esquema de cada classe (formato), com referências de evidência e cobertura de claims', () => {
  const ok = (cls: Parameters<typeof validateModelOutput>[0], out: unknown, ctx = {}) => validateModelOutput(cls, out, ctx);
  assert.equal(ok('triage', { relevant: true, editoria: 'pontos' }).valid, true);
  assert.equal(ok('triage', { relevant: 'sim' }).valid, false);
  assert.equal(ok('triage', { relevant: true, editoria: 'esportes' }).valid, false, 'editoria fora das 10');
  assert.equal(ok('context', { notes: [{ text: 'x', evidenceIds: ['e1'] }] }, { evidenceIds: ['e1'] }).valid, true);
  assert.deepEqual(ok('context', { notes: [{ text: 'x', evidenceIds: ['e9'] }] }, { evidenceIds: ['e1'] }).issues, ['evidência inexistente na entrada: e9']);
  const draft = { headline: 'Título', body: 'Texto', resumo: 'Resumo curto', claims: [{ id: 'c1', kind: 'fact', text: 't', evidenceIds: ['e1'] }] };
  assert.equal(ok('draft', draft, { evidenceIds: ['e1'] }).valid, true);
  assert.equal(ok('draft', { ...draft, resumo: undefined }).valid, false, 'resumo obrigatório');
  assert.equal(ok('draft', { ...draft, resumo: 'x'.repeat(301) }).valid, false, 'resumo ≤ 300');
  assert.equal(ok('draft', { ...draft, claims: [{ id: 'c1', kind: 'quote', text: 't', evidenceIds: ['e1'] }] }).valid, false, 'quote sem texto/autor');
  assert.equal(ok('draft', { ...draft, claims: [] }).valid, false);
  assert.equal(ok('draft', { ...draft, extra: 1 }).valid, true); assert.equal(validateModelOutput('draft', { ...draft, extra: 1 }, { strict: true }).valid, false);
  assert.equal(ok('factcheck', { verdicts: [{ claimId: 'c1', verdict: 'pass' }] }, { claimIds: ['c1'] }).valid, true);
  assert.deepEqual(ok('factcheck', { verdicts: [{ claimId: 'c1', verdict: 'pass' }] }, { claimIds: ['c1', 'c2'] }).issues, ['claim sem veredito: c2']);
  assert.equal(ok('factcheck', { verdicts: [{ claimId: 'c1', verdict: 'talvez' }] }).valid, false);
  assert.equal(ok('review', { approve: false, issues: ['x'] }).valid, true); assert.equal(ok('review', { approve: 'sim' }).valid, false);
  assert.equal(ok('social_pack', { linkedin: 'texto' }).valid, true); assert.equal(ok('social_pack', { linkedin: 'x'.repeat(1201) }).valid, false);
  assert.equal(ok('roles', { mentions: [{ personName: 'A', orgName: 'B', title: 'CEO', kind: 'present', excerpt: 'A é CEO da B' }] }).valid, true);
  assert.equal(ok('roles', { mentions: [{ personName: 'A', orgName: 'B', title: 'CEO', kind: 'present', effectiveDate: '23/11/2026', excerpt: 'x' }] }).valid, false);
});

test('docs/schemas-saida-por-classe.json acompanha o código (sem divergência)', async () => {
  const { readFileSync } = await import('node:fs');
  const { outputJsonSchemas } = await import('../factory/output-schemas');
  const file = JSON.parse(readFileSync(new URL('../../docs/schemas-saida-por-classe.json', import.meta.url), 'utf8')) as unknown;
  assert.deepEqual(file, JSON.parse(JSON.stringify(outputJsonSchemas())), 'regenerar: ver docs/piloto-10-materias-editorial.md §4');
});
