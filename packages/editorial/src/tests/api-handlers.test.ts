import { test, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { MOCK_SOURCE, mockResolver, mockWeb, COLLECT_ON } from '../../fixtures/mock-web.mock';
import { MockGateway } from '../../fixtures/mock-gateway.mock';
import { SourceRegistry } from '../sources/registry';
import { InMemoryAuditLog } from '../pipeline/stages';
import type { StageDeps } from '../pipeline/stages';
import { InMemoryQueue, makeProcessor } from '../pipeline/queue';
import type { Evidence } from '../types';
import { InMemoryEditorialStore, applyOutcome } from '../api/store';
import { storeBackedPublishedLookup } from '../api/published-lookup';
import { applyPublication } from '../api/publication';
import type { ArticleRecord } from '../api/store';
import {
  acknowledgeLegalCase, closeCorrection, getArticleReview, getCorrection, getFactcheck, intakeRightOfReply, listCorrections, listQueue,
  markCorrectionEntitiesRebuilt, openCorrection, preserveCorrectionEvidence, publishCorrectionNotice, reconcileCorrectionSocial,
  requestRecheck, submitReview, triageCorrection, verifyRequester,
} from '../api/handlers';
import type { Actor, HandlerCtx } from '../api/handlers';

const NOW = new Date('2026-11-24T10:00:00Z');
const user = (roles: string[], mfa = true): Actor => ({ userId: `u-${roles[0]}`, roles, mfa });
const editor = user(['editor']); const chefe = user(['editor_chefe']); const admin = user(['admin']); const revisor = user(['revisor']);
let n = 0;
const mkctx = (actor: Actor | null, store: InMemoryEditorialStore, queue?: InMemoryQueue): HandlerCtx =>
  ({ actor, store, published: storeBackedPublishedLookup(store), siteBaseUrl: 'https://loyaltynews.example', now: () => NOW, newId: () => `id-${++n}`, ...(queue ? { queue } : {}) });

let ev: Evidence;
beforeAll(async () => {
  ev = (await new Collector(mockWeb(), { minSpacingMs: 0, now: () => NOW, resolver: mockResolver(), flags: COLLECT_ON }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria')).evidence!;
});

/** Matéria aprovada e PUBLICADA (recibo registrado): só de matéria já publicada se abre caso de correção (ADR-019). */
async function publishedStore(): Promise<InMemoryEditorialStore> {
  const store = await approvedStore();
  const r = await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-MOCK', url: 'https://loyaltynews.example/noticia/a1', publishedAt: NOW.toISOString() });
  assert.ok(r.ok, r.ok ? '' : r.message);
  return store;
}

/** Roda o pipeline (MOCK) e grava o resultado no store, como o worker do Backend faria. */
async function approvedStore(articleId = 'a1'): Promise<InMemoryEditorialStore> {
  const store = new InMemoryEditorialStore();
  const deps: StageDeps = { gateway: new MockGateway(ev.id), registry: new SourceRegistry([MOCK_SOURCE]), audit: new InMemoryAuditLog(), flags: { 'editorialPipeline': true }, now: () => NOW };
  const q = new InMemoryQueue();
  await q.enqueue({ stage: 'triage', jobId: `${articleId}:triage:0`, data: { articleId, editoria: 'pontos', evidences: [ev], attempt: 0 } });
  await q.drain(makeProcessor(deps, q));
  for (const { spec, outcome } of q.processed) await applyOutcome(store, spec.data, outcome, NOW.toISOString());
  return store;
}

test('RBAC: sem sessão 401, sem MFA 401, papéis sem acesso 403; nenhum handler vaza dados', async () => {
  const store = await approvedStore();
  assert.equal((await listQueue(mkctx(null, store), {})).status, 401);
  assert.equal((await listQueue(mkctx(user(['editor'], false), store), {})).status, 401);
  assert.equal((await listQueue(mkctx(user(['leitor']), store), {})).status, 403);
  assert.equal((await listQueue(mkctx(user(['comercial']), store), {})).status, 403);
  assert.equal((await getArticleReview(mkctx(user(['comercial']), store), { articleId: 'a1' })).status, 403);
  assert.equal((await submitReview(mkctx(editor, store), { articleId: 'a1', decision: 'send_back', note: 'ajuste' })).status, 403); // editor não decide revisão
  assert.equal((await openCorrection(mkctx(revisor, store), {})).status, 403);
  assert.equal((await acknowledgeLegalCase(mkctx(chefe, store), { correctionId: 'x' })).status, 403); // só admin
});

test('applyOutcome grava o resultado do pipeline: aprovada, com rascunho e checagem de provedor distinto', async () => {
  const store = await approvedStore();
  const r = (await store.getArticle('a1'))!;
  assert.equal(r.status, 'aprovado');
  assert.equal(r.draft?.signature, 'Redação Loyalty News');
  assert.notEqual(r.draft?.modelProvider, r.factcheck?.provider);
});

test('fila: filtros, paginação, bloqueadas primeiro, entrada inválida => 400', async () => {
  const store = await approvedStore('a1');
  const blocked: ArticleRecord = { articleId: 'b1', editoria: 'regulacao', status: 'bloqueado', evidences: [], blockers: ['duplicate'], findings: [], reviews: [], recheckCount: 0, updatedAt: '2026-11-24T11:00:00.000Z' };
  await store.putArticle(blocked);
  const c = mkctx(editor, store);
  const all = await listQueue(c, {});
  assert.equal(all.status, 200);
  const body = all.body as { items: Array<{ articleId: string; status: string; titulo: string | null }>; total: number };
  assert.equal(body.total, 2);
  assert.equal(body.items[0]?.articleId, 'b1', 'bloqueada primeiro');
  assert.ok(body.items[1]?.titulo?.startsWith('MOCK'));
  assert.equal(((await listQueue(c, { status: 'aprovado' })).body as { total: number }).total, 1);
  assert.equal(((await listQueue(c, { editoria: 'regulacao', limit: 1 })).body as { items: unknown[] }).items.length, 1);
  assert.equal((await listQueue(c, { limit: 1000 })).status, 400);
  assert.equal((await listQueue(c, { status: 'inventado' })).status, 400);
  assert.equal((await listQueue(c, { editoria: 'pontos-milhas' })).status, 400); // slug antigo não existe mais
});

test('visão de revisão: gate recalculado; adulterar o rascunho derruba o gate mesmo com status aprovado', async () => {
  const store = await approvedStore();
  const ok = await getArticleReview(mkctx(revisor, store), { articleId: 'a1' });
  assert.equal(ok.status, 200);
  const v = ok.body as import('../api/handlers').ReviewView;
  assert.equal(v.gate.passou, true);
  assert.equal(v.gate.independencia.independent, true);
  assert.equal(v.rascunho?.assinatura, 'Redação Loyalty News');
  assert.ok(v.evidencias[0]?.sha256.match(/^[0-9a-f]{64}$/));
  // adulteração: número inventado no corpo
  const rec = (await store.getArticle('a1'))!;
  await store.putArticle({ ...rec, draft: { ...rec.draft!, body: rec.draft!.body.replace('\n\nFontes:\n', '\nA alta foi de 87% no trimestre.\n\nFontes:\n') } });
  const t =(await getArticleReview(mkctx(revisor, store), { articleId: 'a1' })).body as import('../api/handlers').ReviewView;
  assert.equal(t.gate.passou, false);
  assert.ok(t.gate.achados.some((x) => x.code === 'unsupported_metric'));
  assert.equal((await getArticleReview(mkctx(revisor, store), { articleId: 'nao-existe' })).status, 404);
});

test('revisão humana: confirm só com gate passando; humano não força aprovação; transições seguem o contrato', async () => {
  const store = await approvedStore();
  const c = mkctx(revisor, store);
  assert.equal((await submitReview(c, { articleId: 'a1', decision: 'confirm', note: 'x' })).status, 400); // nota mínima
  const ok = await submitReview(c, { articleId: 'a1', decision: 'confirm', note: 'conferido pela revisão' });
  assert.equal(ok.status, 200);
  assert.equal((await store.getArticle('a1'))?.status, 'aprovado');
  assert.equal((await store.getArticle('a1'))?.reviews.length, 1);
  // block a partir de aprovado não é transição permitida
  assert.equal((await submitReview(c, { articleId: 'a1', decision: 'block', note: 'bloquear' })).status, 409);
  // adulterado => confirm recusado
  const rec = (await store.getArticle('a1'))!;
  await store.putArticle({ ...rec, draft: { ...rec.draft!, body: `${rec.draft!.body}\nCresceu 55%.` } });
  assert.equal((await submitReview(c, { articleId: 'a1', decision: 'confirm', note: 'tentando confirmar' })).status, 409);
  // send_back devolve a rascunho
  const back = await submitReview(c, { articleId: 'a1', decision: 'send_back', note: 'refazer a redação' });
  assert.equal(back.status, 200);
  assert.equal((await store.getArticle('a1'))?.status, 'rascunho');
  assert.equal((await store.listAudit()).filter((a) => a.action.startsWith('review.')).length, 2);
  // de rascunho não se pode bloquear
  assert.equal((await submitReview(c, { articleId: 'a1', decision: 'block', note: 'bloquear' })).status, 409);
});

test('checagem: visão por claim, independência; recheck apenas enfileira (idempotente, 202); sem fila 503; publicada 409', async () => {
  const store = await approvedStore();
  const f = (await getFactcheck(mkctx(editor, store), { articleId: 'a1' })).body as import('../api/handlers').FactcheckView;
  assert.equal(f.resumo.aprovadas, 4);
  assert.equal(f.resumo.semVeredito, 0);
  assert.equal(f.independencia.independent, true);
  const q = new InMemoryQueue();
  const r1 = await requestRecheck(mkctx(revisor, store, q), { articleId: 'a1' });
  assert.equal(r1.status, 202);
  assert.equal((r1.body as { jobId: string }).jobId, 'a1:factcheck:r1');
  assert.ok(q.seen.has('a1:factcheck:r1'));
  const r2 = await requestRecheck(mkctx(revisor, store, q), { articleId: 'a1' });
  assert.equal((r2.body as { jobId: string }).jobId, 'a1:factcheck:r2');
  assert.equal((await store.getArticle('a1'))?.recheckCount, 2);
  assert.equal((await requestRecheck(mkctx(revisor, store), { articleId: 'a1' })).status, 503);
  assert.equal((await requestRecheck(mkctx(editor, store, q), { articleId: 'a1' })).status, 403);
  const pub = (await store.getArticle('a1'))!; await store.putArticle({ ...pub, status: 'publicado' });
  assert.equal((await requestRecheck(mkctx(revisor, store, q), { articleId: 'a1' })).status, 409);
});

test('errata completa pelos handlers: abrir → preservar → triar com claims verificadas → aviso → social → entidades → fechar', async () => {
  const store = await publishedStore();
  const c = mkctx(chefe, store);
  const opened = await openCorrection(c, { articleId: 'a1', kind: 'erratum', contested: '3 pontos por real', requester: { name: 'MOCK Leitor', channel: 'email' } });
  assert.equal(opened.status, 201);
  const id = (opened.body as { id: string }).id;
  const pre = await preserveCorrectionEvidence(c, { correctionId: id, url: 'https://loyaltynews.example/materia/a1', body: '<html>versão publicada</html>' });
  assert.equal(pre.status, 200);
  // sem claims => 400; claim não sustentada => 409
  assert.equal((await triageCorrection(c, { correctionId: id, accepted: true, reason: 'confere' })).status, 400);
  const invented = await triageCorrection(c, { correctionId: id, accepted: true, reason: 'confere', corrected: '9 pontos por real', claims: [{ id: 'k1', kind: 'number', text: '9 pontos por real', evidenceIds: [ev.id] }] });
  assert.equal(invented.status, 409);
  const tri = await triageCorrection(c, { correctionId: id, accepted: true, reason: 'evidência confirma', corrected: '2 pontos por real', claims: [{ id: 'k1', kind: 'number', text: '2 pontos por real', evidenceIds: [ev.id] }] });
  assert.equal(tri.status, 200);
  assert.equal((tri.body as { state: string }).state, 'accepted');
  const pub = await publishCorrectionNotice(c, { correctionId: id, socialPosts: [{ postId: 'li-1', channel: 'linkedin' }] });
  assert.equal(pub.status, 200);
  const notice = (pub.body as { notice: { text: string } }).notice.text;
  assert.match(notice, /Correção \(2026-11-24\).*3 pontos por real.*2 pontos por real/);
  assert.ok(notice.includes('Redação Loyalty News'));
  assert.equal((await reconcileCorrectionSocial(c, { correctionId: id, receipts: [] })).status, 409);
  assert.equal((await reconcileCorrectionSocial(c, { correctionId: id, receipts: [{ postId: 'li-1' }] })).status, 200);
  assert.equal((await closeCorrection(c, { correctionId: id })).status, 409); // entidades ainda não reconstruídas
  assert.equal((await markCorrectionEntitiesRebuilt(c, { correctionId: id })).status, 200);
  const closed = await closeCorrection(c, { correctionId: id });
  assert.equal(closed.status, 200);
  assert.equal((closed.body as { state: string }).state, 'closed');
  assert.ok((await store.listAudit()).some((a) => a.action === 'correction.close'));
  assert.equal(((await listCorrections(mkctx(editor, store), { state: 'closed' })).body as { items: unknown[] }).items.length, 1);
});

test('direito de resposta: intake público, identidade, escalonamento ao responsável (admin), texto preservado, sem vazar contato', async () => {
  const store = await publishedStore();
  const reply = 'Texto original da empresa, escrito por ela e que deve ser publicado sem qualquer edição.';
  const intake = await intakeRightOfReply(mkctx(null, store), { articleId: 'a1', contested: 'afirmação sobre a empresa', requester: { name: 'MOCK Empresa S.A.' }, contact: 'contato@mock.example', replyText: reply });
  assert.equal(intake.status, 201);
  const id = (intake.body as { correctionId: string }).correctionId;
  assert.equal((await store.listAudit()).find((a) => a.action === 'correction.open')?.userId, null);
  assert.equal((await intakeRightOfReply(mkctx(null, store), { articleId: 'nao-existe', contested: 'xxx', requester: { name: 'MOCK' }, replyText: reply })).status, 404);
  assert.equal((await intakeRightOfReply(mkctx(null, store), { articleId: 'a1', contested: 'xxx', requester: { name: 'MOCK' }, replyText: 'curto' })).status, 400);

  const c = mkctx(chefe, store);
  const view = await getCorrection(c, { correctionId: id });
  assert.equal(view.status, 200);
  assert.ok(!JSON.stringify(view.body).includes('contato@mock.example'), 'contato (dado pessoal) não é exposto');
  assert.equal((view.body as { replyText: string }).replyText, reply);

  await preserveCorrectionEvidence(c, { correctionId: id, url: 'https://loyaltynews.example/materia/a1', body: 'versão publicada' });
  // identidade não verificada => bloqueado
  assert.equal((await triageCorrection(c, { correctionId: id, accepted: true, reason: 'pedido formal' })).status, 409);
  assert.equal((await verifyRequester(mkctx(editor, store), { correctionId: id, method: 'conferência de documento' })).status, 403);
  assert.equal((await verifyRequester(c, { correctionId: id, method: 'conferência de documento' })).status, 200);
  const tri = await triageCorrection(c, { correctionId: id, accepted: true, reason: 'pedido formal válido' });
  assert.equal((tri.body as { state: string }).state, 'escalated_legal');
  // sem ciência do responsável não publica
  assert.equal((await publishCorrectionNotice(c, { correctionId: id })).status, 409);
  assert.equal((await acknowledgeLegalCase(c, { correctionId: id })).status, 403);
  assert.equal((await acknowledgeLegalCase(mkctx(admin, store), { correctionId: id })).status, 200);
  const pub = await publishCorrectionNotice(c, { correctionId: id });
  assert.equal(pub.status, 200);
  assert.ok((pub.body as { notice: { text: string } }).notice.text.includes(reply), 'texto do requerente publicado sem alteração');
  assert.equal((await reconcileCorrectionSocial(c, { correctionId: id, receipts: [] })).status, 200); // sem posts sociais
  await markCorrectionEntitiesRebuilt(c, { correctionId: id });
  assert.equal(((await closeCorrection(c, { correctionId: id })).body as { state: string }).state, 'closed');
});

test('handlers são puros: nenhuma chamada de rede ou modelo (fetch bloqueado durante os testes)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error('fetch proibido'); }) as typeof fetch;
  try {
    const store = await approvedStore('p1');
    assert.equal((await listQueue(mkctx(editor, store), {})).status, 200);
    assert.equal((await getFactcheck(mkctx(editor, store), { articleId: 'p1' })).status, 200);
  } finally { globalThis.fetch = realFetch; }
});
