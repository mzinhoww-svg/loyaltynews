import { test, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { COLLECT_ON, MOCK_SOURCE, mockResolver, mockWeb } from '../../fixtures/mock-web.mock';
import { MockGateway } from '../../fixtures/mock-gateway.mock';
import { SourceRegistry } from '../sources/registry';
import { InMemoryAuditLog } from '../pipeline/stages';
import type { StageDeps } from '../pipeline/stages';
import { InMemoryQueue, makeProcessor } from '../pipeline/queue';
import type { Draft, Evidence } from '../types';
import { InMemoryEditorialStore, applyOutcome } from '../api/store';
import type { ArticleRecord } from '../api/store';
import { applyPublication } from '../api/publication';
import { CORRECTION_QUEUE, applyCorrection, prepareCorrection } from '../api/correction-publication';
import type { CorrectionInput } from '../api/correction-publication';
import { storeBackedPublishedLookup } from '../api/published-lookup';
import type { Actor, HandlerCtx } from '../api/handlers';
import { acknowledgeLegalCase, getArticleReview, intakeRightOfReply, openCorrection, preserveCorrectionEvidence, triageCorrection, verifyRequester } from '../api/handlers';
import type { ReviewView } from '../api/handlers';
import { composeBody, fontesPart, parseNotices, renderNotices } from '../notices';
import { checkNotices, mainBody, runDeterministicChecks } from '../rules/rules';
import { draftContentSha256 } from '../publishable';
import { toPublishedArticle } from '../intelligence/published';

const T0 = new Date('2026-11-24T13:00:00Z');
const T1 = '2026-11-26T09:00:00.000Z';
const T2 = '2026-11-27T09:00:00.000Z';
const URL_PUB = 'https://loyaltynews.example/noticia/a1';
const chefe: Actor = { userId: 'maria-chefe', roles: ['editor_chefe'], mfa: true };
const admin: Actor = { userId: 'joao-admin', roles: ['admin'], mfa: true };
let ev: Evidence;
beforeAll(async () => {
  ev = (await new Collector(mockWeb(), { now: () => T0, resolver: mockResolver(), flags: COLLECT_ON }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria')).evidence!;
});

async function publishedStore() {
  const store = new InMemoryEditorialStore();
  const deps: StageDeps = { gateway: new MockGateway(ev.id), registry: new SourceRegistry([MOCK_SOURCE]), audit: new InMemoryAuditLog(), flags: { editorialPipeline: true }, now: () => T0 };
  const q = new InMemoryQueue();
  await q.enqueue({ stage: 'triage', jobId: 'a1:triage:0', data: { articleId: 'a1', editoria: 'mercado', evidences: [ev], attempt: 0 } });
  await q.drain(makeProcessor(deps, q));
  for (const { spec, outcome } of q.processed) await applyOutcome(store, spec.data, outcome, T0.toISOString());
  const r = await applyPublication(store, { articleId: 'a1', receiptId: 'rcpt-v1', url: URL_PUB, publishedAt: T0.toISOString() });
  assert.ok(r.ok);
  return store;
}

let seq = 0;
const ctxOf = (actor: Actor | null, store: InMemoryEditorialStore): HandlerCtx =>
  ({ actor, store, published: storeBackedPublishedLookup(store), siteBaseUrl: 'https://loyaltynews.example', now: () => new Date(T1), newId: () => `k${++seq}` });

const claim = () => [{ id: 'k', kind: 'number' as const, text: '2 pontos por real gasto', evidenceIds: [ev.id] }];

/** Abre um caso de errata e o leva até `accepted` pelos handlers. */
async function acceptedErratum(store: InMemoryEditorialStore, contested = '2 pontos para cada real gasto'): Promise<string> {
  const c = ctxOf(chefe, store);
  const o = await openCorrection(c, { articleId: 'a1', kind: 'erratum', contested, requester: { name: 'MOCK Leitor', channel: 'email' } });
  assert.equal(o.status, 201);
  const id = (o.body as { id: string }).id;
  assert.equal((await preserveCorrectionEvidence(c, { correctionId: id, body: '<html>publicada</html>' })).status, 200);
  const t = await triageCorrection(c, { correctionId: id, accepted: true, reason: 'evidência confirma', corrected: '2 pontos por real gasto', claims: claim() });
  assert.equal((t.body as { state: string }).state, 'accepted');
  return id;
}

/** Nova versão do rascunho (texto corrigido, mesmo slug, mesmas fontes), SEM avisos. */
function correctedDraft(rec: ArticleRecord, mutate: (main: string) => string = (m) => m.replace('2 pontos para cada real gasto', '2 pontos por real gasto')): Draft {
  const d = rec.draft!;
  return { ...d, id: `${d.id}:c`, body: composeBody(mutate(mainBody(d.body)), [], fontesPart(d.body)) };
}
const FC = { provider: 'anthropic', model: 'mock', verdicts: ['c1', 'c2', 'c3', 'c4'].map((claimId) => ({ claimId, verdict: 'pass' as const })) };
const input = (rec: ArticleRecord, correctionId: string, over: Partial<CorrectionInput> = {}): CorrectionInput =>
  ({ articleId: 'a1', correctionId, draft: correctedDraft(rec), factcheck: FC, receiptId: 'rcpt-v2', publishedAt: T1, ...over });

test('avisos: render/parse ida e volta (multilinha, linha em branco, "- " no texto) e bloco malformado é recusado', () => {
  const ns = ['Correção (2026-11-26): onde se lia "A", leia-se "B". Redação Loyalty News.', 'Resposta\n\n- item com hífen\nlinha final'];
  const body = composeBody('Texto.', ns, 'Fontes aqui');
  const p = parseNotices(body);
  assert.ok(p.ok && JSON.stringify(p.notices) === JSON.stringify(ns));
  assert.deepEqual(parseNotices('Sem avisos\n\nFontes:\nx'), { ok: true, notices: [] });
  assert.equal(parseNotices('Texto\n\nAvisos:\nsem hífen\n\nFontes:\nx').ok, false);
  assert.equal(parseNotices(`Texto${renderNotices(['a'])}${renderNotices(['b'])}\n\nFontes:\nx`).ok, false);
  assert.equal(parseNotices('Texto\n\nAvisos:\n- a').ok, false, 'sem Fontes depois');
  assert.equal(mainBody(body), 'Texto.');
});

test('fluxo completo: errata aceita → matéria corrigida, aviso no hash, publicadoEm original, outbox article.corrected e caso avançado', async () => {
  const store = await publishedStore();
  const before = (await store.getArticle('a1'))!;
  const caseId = await acceptedErratum(store);
  const inp = input(before, caseId);
  const prep = await prepareCorrection(store, inp);
  assert.ok(prep.ok);
  assert.notEqual(prep.contentSha256, before.publication!.contentSha256, 'o hash da versão corrigida é novo');
  assert.equal(prep.contentSha256, draftContentSha256(prep.draft));
  assert.ok((await store.getArticle('a1'))!.status === 'publicado', 'prepare não grava nada');
  assert.equal((await store.listOutbox()).filter((o) => o.queue === CORRECTION_QUEUE).length, 0);

  const res = await applyCorrection(store, { ...inp, expectedContentSha256: prep.contentSha256 });
  assert.ok(res.ok && !res.alreadyApplied && res.outbox === 'enqueued');
  const after = (await store.getArticle('a1'))!;
  assert.equal(after.status, 'corrigido');
  assert.equal(after.publication?.publishedAt, T0.toISOString(), 'publicadoEm original mantido');
  assert.equal(after.publication?.correctedAt, T1);
  assert.equal(after.publication?.url, URL_PUB);
  assert.equal(after.publication?.contentSha256, prep.contentSha256);
  assert.equal(after.publication?.receiptId, 'rcpt-v2');
  assert.deepEqual(after.publication?.previous, [{ receiptId: 'rcpt-v1', contentSha256: before.publication!.contentSha256, at: T0.toISOString() }]);
  assert.equal(after.notices?.length, 1);
  assert.ok(after.draft!.body.includes('2 pontos por real gasto') && !mainBody(after.draft!.body).includes('para cada real'));
  assert.ok(after.draft!.body.indexOf('\n\nAvisos:\n') < after.draft!.body.indexOf('\n\nFontes:\n'));
  assert.deepEqual(parseNotices(after.draft!.body), { ok: true, notices: [after.notices![0]!.text] });
  assert.equal(draftContentSha256(after.draft!), after.publication!.contentSha256);
  // outbox, auditoria e caso na mesma operação
  const ob = (await store.listOutbox()).find((o) => o.queue === CORRECTION_QUEUE)!;
  assert.deepEqual(ob, { queue: CORRECTION_QUEUE, refId: 'a1', idempotencyKey: `article.corrected:a1:${prep.contentSha256}` });
  assert.equal((await store.listAudit()).filter((a) => a.action === 'article.corrected').length, 1);
  const cr = (await store.getCorrection(caseId))!;
  assert.equal(cr.case.state, 'notice_published');
  assert.equal(cr.case.notice?.text, after.notices![0]!.text, 'o aviso do caso é exatamente o que está no corpo');
  // o gate recalculado pelo handler continua passando e o PublishedArticle reflete o novo hash
  const view = (await getArticleReview(ctxOf(chefe, store), { articleId: 'a1' })).body as ReviewView;
  assert.equal(view.gate.passou, true);
  const pa = toPublishedArticle(after);
  assert.ok(pa.ok && pa.article.contentSha256 === prep.contentSha256 && pa.article.id === 'a1');
  assert.equal(pa.ok && pa.article.publishedAt, T0.toISOString(), 'publicadoEm original no PublishedArticle');
});

test('idempotente: repetir a mesma aplicação não duplica nada; outro recibo para o mesmo caso é recusado', async () => {
  const store = await publishedStore();
  const caseId = await acceptedErratum(store);
  const inp = input((await store.getArticle('a1'))!, caseId);
  const first = await applyCorrection(store, inp);
  assert.ok(first.ok && first.outbox === 'enqueued');
  const snapshot = JSON.stringify(await store.getArticle('a1'));
  const again = await applyCorrection(store, inp);
  assert.ok(again.ok && again.alreadyApplied && again.outbox === 'duplicate');
  assert.equal(JSON.stringify(await store.getArticle('a1')), snapshot);
  assert.equal((await store.listAudit()).filter((a) => a.action === 'article.corrected').length, 1);
  assert.equal((await store.listOutbox()).filter((o) => o.queue === CORRECTION_QUEUE).length, 1);
  const other = await applyCorrection(store, { ...inp, receiptId: 'rcpt-OUTRO' });
  assert.ok(!other.ok && other.code === 'already_corrected');
});

test('avisos anteriores nunca saem: 2ª correção acumula, o corpo é composto pelo sistema e o gate barra remoção/alteração', async () => {
  const store = await publishedStore();
  const c1 = await acceptedErratum(store);
  assert.ok((await applyCorrection(store, input((await store.getArticle('a1'))!, c1))).ok);
  const mid = (await store.getArticle('a1'))!;
  const n1 = mid.notices![0]!.text;
  // 2ª correção (outro caso aceito)
  const c2 = await acceptedErratum(store, 'texto contestado da 2ª errata');
  const second = input(mid, c2, {
    receiptId: 'rcpt-v3', publishedAt: T2,
    // o rascunho enviado parte do corrigido SEM avisos (o sistema recompõe os avisos anteriores + o novo)
    draft: { ...mid.draft!, body: composeBody(mainBody(mid.draft!.body), [], fontesPart(mid.draft!.body)) },
  });
  const r2 = await applyCorrection(store, second);
  assert.ok(r2.ok, JSON.stringify(r2));
  const fin = (await store.getArticle('a1'))!;
  assert.equal(fin.status, 'corrigido');
  assert.equal(fin.notices?.length, 2);
  assert.equal(fin.notices![0]!.text, n1, 'aviso anterior preservado, na mesma posição');
  const parsed = parseNotices(fin.draft!.body);
  assert.ok(parsed.ok && parsed.notices.length === 2 && parsed.notices[0] === n1);
  assert.equal(fin.publication?.publishedAt, T0.toISOString());
  assert.equal(fin.publication?.previous?.length, 2);
  // rascunho que já traz bloco de avisos (tentando escrever/remover avisos) é recusado
  const c3 = await acceptedErratum(store, 'terceira errata');
  const withNotices = await prepareCorrection(store, input(fin, c3, { draft: { ...fin.draft!, body: composeBody(mainBody(fin.draft!.body), ['aviso inventado'], fontesPart(fin.draft!.body)) } }));
  assert.ok(!withNotices.ok && withNotices.code === 'notices_in_draft');
  // gate: remover o aviso anterior, alterá-lo ou acrescentar aviso não registrado reprova
  const bodyWith = (texts: string[]) => ({ ...fin.draft!, body: composeBody(mainBody(fin.draft!.body), texts, fontesPart(fin.draft!.body)) });
  const expected = fin.notices!.map((n) => n.text);
  assert.deepEqual(checkNotices(bodyWith(expected), expected).findings, []);
  assert.ok(checkNotices(bodyWith(expected.slice(1)), expected).findings.some((f) => f.code === 'notice_removed'));
  assert.ok(checkNotices(bodyWith([`${expected[0]} (editado)`, expected[1]!]), expected).findings.some((f) => f.code === 'notice_altered'));
  assert.ok(checkNotices(bodyWith([...expected, 'extra']), expected).findings.some((f) => f.code === 'notice_unexpected'));
  assert.ok(runDeterministicChecks(bodyWith(['aviso solto']), fin.evidences).findings.some((f) => f.code === 'notice_unexpected'), 'sem avisos registrados, bloco de avisos é adulteração');
});

test('sem caso aceito (ou caso inválido) = recusa SEM efeito', async () => {
  const store = await publishedStore();
  const rec = (await store.getArticle('a1'))!;
  const snap = async () => JSON.stringify({ a: await store.listArticles(), c: await store.listCorrections(), o: await store.listOutbox(), u: await store.listAudit() });
  const baseline = await snap();
  const c = ctxOf(chefe, store);
  const opened = await openCorrection(c, { articleId: 'a1', kind: 'erratum', contested: 'x contestado', requester: { name: 'MOCK', channel: 'email' } });
  const idOpen = (opened.body as { id: string }).id;
  const refuse = async (over: Partial<CorrectionInput>, code: string) => {
    const before = await snap();
    const r = await applyCorrection(store, input(rec, idOpen, over));
    assert.ok(!r.ok && r.code === code, `${code}: ${JSON.stringify(r)}`);
    assert.equal(await snap(), before, `${code}: nada pode mudar`);
  };
  await refuse({}, 'case_not_accepted');                                  // aberto, não aceito
  await refuse({ correctionId: 'nao-existe' }, 'case_not_found');
  await refuse({ articleId: 'nao-existe' }, 'not_found');
  // rejeitado
  await preserveCorrectionEvidence(c, { correctionId: idOpen, body: 'x' });
  await triageCorrection(c, { correctionId: idOpen, accepted: false, reason: 'sem fundamento' });
  await refuse({}, 'case_not_accepted');
  // caso de OUTRA matéria
  const other = await publishedOtherArticle(store);
  const okCase = await acceptedErratum(store);
  const cr = (await store.getCorrection(okCase))!;
  await store.putCorrection({ ...cr, case: { ...cr.case, articleId: other } });
  await refuse({ correctionId: okCase }, 'case_mismatch');
  await store.putCorrection(cr);
  // aceito, mas: slug mudou, checagem do mesmo provedor, claim sem aprovação, hash do recibo velho, número inventado
  await refuse({ correctionId: okCase, draft: { ...correctedDraft(rec), slug: 'outro-slug' } }, 'slug_immutable');
  await refuse({ correctionId: okCase, factcheck: { ...FC, provider: 'deepseek' } }, 'factcheck_failed');
  await refuse({ correctionId: okCase, factcheck: { ...FC, verdicts: FC.verdicts.map((v) => (v.claimId === 'c2' ? { ...v, verdict: 'inconclusive' as const } : v)) } }, 'factcheck_failed');
  await refuse({ correctionId: okCase, expectedContentSha256: 'f'.repeat(64) }, 'receipt_stale');
  await refuse({ correctionId: okCase, draft: correctedDraft(rec, (m) => `${m} A alta foi de 87%.`) }, 'gate_failed');
  // matéria não publicada (aprovada): recusa
  await store.putArticle({ ...rec, status: 'aprovado' });
  await refuse({ correctionId: okCase }, 'not_published');
  await store.putArticle(rec);
  assert.notEqual(baseline, await snap(), 'o baseline mudou só pelos casos abertos/aceitos nos passos acima, não pelas recusas');
  assert.equal((await store.getArticle('a1'))?.status, 'publicado');
  assert.equal((await store.listOutbox()).filter((o) => o.queue === CORRECTION_QUEUE).length, 0);
});

async function publishedOtherArticle(store: InMemoryEditorialStore): Promise<string> {
  const rec = (await store.getArticle('a1'))!;
  await store.putArticle({ ...rec, articleId: 'a2', draft: { ...rec.draft!, slug: 'outra-materia' }, publication: { ...rec.publication!, slug: 'outra-materia', url: 'https://loyaltynews.example/noticia/a2' } });
  return 'a2';
}

test('direito de resposta jurídico: só aplica com ciência do responsável; texto do requerente multilinha preservado no aviso', async () => {
  const store = await publishedStore();
  const rec = (await store.getArticle('a1'))!;
  const reply = 'Texto original da empresa.\n\nLinha dois, com "aspas" e 100% de ênfase — sem edição.\n- item que começa com hífen';
  const intake = await intakeRightOfReply(ctxOf(null, store), { articleId: 'a1', contested: 'afirmação sobre a empresa', requester: { name: 'MOCK Empresa S.A.' }, replyText: reply });
  assert.equal(intake.status, 201);
  const id = (intake.body as { correctionId: string }).correctionId;
  const c = ctxOf(chefe, store);
  await preserveCorrectionEvidence(c, { correctionId: id, body: 'x' });
  await verifyRequester(c, { correctionId: id, method: 'conferência de documento' });
  const tri = await triageCorrection(c, { correctionId: id, accepted: true, reason: 'pedido formal válido' });
  assert.equal((tri.body as { state: string }).state, 'escalated_legal');
  const inp = input(rec, id, { draft: { ...rec.draft! } });
  const noAck = await applyCorrection(store, inp);
  assert.ok(!noAck.ok && noAck.code === 'case_not_accepted', 'sem ciência do responsável não aplica');
  assert.equal((await acknowledgeLegalCase(ctxOf(admin, store), { correctionId: id })).status, 200);
  const res = await applyCorrection(store, inp);
  assert.ok(res.ok, JSON.stringify(res));
  const after = (await store.getArticle('a1'))!;
  assert.equal(after.status, 'corrigido');
  const p = parseNotices(after.draft!.body);
  assert.ok(p.ok && p.notices[0]!.includes(reply), 'resposta do requerente publicada sem alteração, multilinha');
  assert.equal((await store.getCorrection(id))!.case.state, 'notice_published');
  assert.match((await store.getCorrection(id))!.case.notice!.replySha256!, /^[0-9a-f]{64}$/);
  // o gate da matéria (inclui resposta com "100%" no bloco de avisos) não trata o aviso como afirmação do texto
  assert.deepEqual(runDeterministicChecks(after.draft!, after.evidences, { notices: after.notices!.map((n) => n.text) }).findings, []);
});

test('atomicidade: falha injetada no commit da correção não deixa matéria, outbox, auditoria ou caso pela metade; o retry completa tudo', async () => {
  for (const step of ['after_article', 'after_audit', 'after_outbox'] as const) {
    const store = await publishedStore();
    const caseId = await acceptedErratum(store);
    const rec = (await store.getArticle('a1'))!;
    const caseBefore = JSON.stringify(await store.getCorrection(caseId));
    const inp = input(rec, caseId);
    store.armFault(step);
    await assert.rejects(applyCorrection(store, inp), /falha injetada/);
    assert.equal((await store.getArticle('a1'))?.status, 'publicado', step);
    assert.equal((await store.getArticle('a1'))?.notices, undefined, step);
    assert.equal((await store.listOutbox()).filter((o) => o.queue === CORRECTION_QUEUE).length, 0, step);
    assert.equal((await store.listAudit()).filter((a) => a.action === 'article.corrected').length, 0, step);
    assert.equal(JSON.stringify(await store.getCorrection(caseId)), caseBefore, `${step}: caso intacto`);
    const ok = await applyCorrection(store, inp);
    assert.ok(ok.ok && ok.outbox === 'enqueued', step);
    assert.equal((await store.getArticle('a1'))?.status, 'corrigido');
    assert.equal((await store.getCorrection(caseId))?.case.state, 'notice_published');
    assert.equal((await store.listAudit()).filter((a) => a.action === 'article.corrected').length, 1, step);
  }
});
