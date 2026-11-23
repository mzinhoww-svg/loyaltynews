import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import type { AuditItem, ArticleRecord, CorrectionRecord, EditorialStore, PublicationCommit, PublicationCommitStep, SourceState } from './store';
import { openCase } from '../corrections/corrections';
import { SourceRegistry } from '../sources/registry';
import { SEED_SOURCES } from '../sources/seed';
import { listQueue, getArticleReview } from './handlers';
import { reviewSource, setSourceEnabled } from './source-handlers';
import type { HandlerCtx } from './common';

/**
 * SUÍTE DE CONTRATO da porta `EditorialStore` (especificação em docs/editorial-store-contract.md).
 * Quem implementa a porta (ex.: Backend, sobre PostgreSQL) importa `@ln/editorial/testing` e roda:
 *
 *   runEditorialStoreContract('PostgresEditorialStore', async () => makeCleanStore());
 *
 * A fábrica é chamada ANTES DE CADA TESTE e deve devolver uma loja VAZIA e isolada (ex.: PGlite novo ou
 * schema limpo/transação revertida). Se a fábrica devolver `{ store, teardown }`, `teardown` roda ao fim de cada teste.
 */

export interface StoreHandleObject {
  store: EditorialStore;
  teardown?: () => Promise<void>;
  /**
   * Gancho de TESTE (opcional, mas recomendado ao Backend): faz a PRÓXIMA `commitPublication` falhar no passo indicado
   * (`null` desarma). Com ele, a suíte prova que uma falha entre os passos não deixa gravação parcial. Sem ele, o caso é pulado.
   */
  armFault?: (step: PublicationCommitStep | null) => void;
}
export type StoreHandle = EditorialStore | StoreHandleObject;
export type StoreFactory = () => StoreHandle | Promise<StoreHandle>;

async function open(f: StoreFactory): Promise<StoreHandleObject> {
  const r = await f();
  return 'store' in r ? r : { store: r };
}

/** Dados JSON puros: o que a loja devolve deve ser igual a isto após normalização JSON (undefined descartado). */
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function sampleArticle(id: string, over: Partial<ArticleRecord> = {}): ArticleRecord {
  return {
    articleId: id, editoria: 'pontos', status: 'em_checagem',
    draft: {
      id: `${id}:d0`, editoria: 'pontos', slug: `materia-${id}`, resumo: 'Resumo MOCK', tipoConteudo: 'noticia', classeDeDado: 'public', patrocinado: false, headline: 'MOCK: título com acentuação, “aspas” e emoji 🚀', body: 'Corpo MOCK.\n\nFontes:\n- MOCK: https://ri.mock.example/a (acessado em 2026-11-23)',
      claims: [{ id: 'c1', kind: 'fact', text: 'afirmação MOCK', evidenceIds: ['ev_1'] }, { id: 'c2', kind: 'quote', text: 'fala', evidenceIds: ['ev_1'], quote: { text: 'texto literal', speaker: 'Pessoa MOCK' } }],
      evidenceIds: ['ev_1'], signature: 'Redação Loyalty News', image: { mode: 'none', reason: 'sem base de direito' }, modelProvider: 'deepseek', promptVersion: 'editorial-0.1',
    },
    evidences: [{
      id: 'ev_1', sourceId: 'mock-ri', url: 'https://ri.mock.example/a', canonicalUrl: 'https://ri.mock.example/a', fetchedAt: '2026-11-23T12:00:00.000Z',
      contentSha256: 'a'.repeat(64), title: 'MOCK', text: 'Texto MOCK', publishedAt: null, suspicious: false, suspiciousReasons: [],
    }],
    factcheck: { provider: 'anthropic', model: 'mock', verdicts: [{ claimId: 'c1', verdict: 'pass' }, { claimId: 'c2', verdict: 'inconclusive' }] },
    blockers: [], findings: [{ code: 'x', message: 'achado MOCK', claimId: 'c1' }], reviews: [], recheckCount: 0, updatedAt: '2026-11-23T12:00:00.000Z', ...over,
  };
}

export function sampleCorrection(id: string, articleId = 'a1'): CorrectionRecord {
  const c = openCase({ id, articleId, kind: 'right_of_reply', receivedAt: '2026-11-23T12:00:00.000Z', contested: 'trecho contestado', requester: { name: 'Requerente MOCK', identityVerified: false, channel: 'form' }, socialPosts: [{ postId: 'li-1', channel: 'linkedin', reconciled: false }] });
  return { case: c, replyText: 'Resposta MOCK com acentuação, 日本語 e emoji 🚀', contact: 'contato@mock.example' };
}

export function sampleSourceState(id: string, over: Partial<SourceState> = {}): SourceState {
  return { sourceId: id, enabled: false, termsStatus: 'pending', urlVerified: false, paywall: 'unknown', review: null, updatedAt: '2026-11-23T12:00:00.000Z', updatedBy: 'u1', ...over };
}

export function sampleCommit(id: string, over: { receiptId?: string; withCorrection?: boolean } = {}): PublicationCommit {
  const publishedAt = '2026-11-24T13:00:00.000Z';
  const article = sampleArticle(id, {
    status: 'publicado', updatedAt: publishedAt,
    publication: { receiptId: over.receiptId ?? 'rcpt-1', url: `https://loyaltynews.example/materia/${id}`, publishedAt, contentSha256: 'b'.repeat(64) },
  });
  return {
    article,
    audit: { at: publishedAt, userId: null, action: 'article.published', target: id, detail: `recibo ${over.receiptId ?? 'rcpt-1'}` },
    outbox: { queue: 'intelligence-ingest', refId: id, idempotencyKey: `article.published:${id}:${'b'.repeat(64)}` },
    ...(over.withCorrection ? { correction: sampleCorrection(`k-${id}`, id) } : {}),
  };
}

export interface ContractCase { name: string; run: (f: StoreFactory) => Promise<void> }

const withStore = async (f: StoreFactory, fn: (s: EditorialStore, h: StoreHandleObject) => Promise<void>) => {
  const h = await open(f);
  try { await fn(h.store, h); } finally { await h.teardown?.(); }
};

/** Nada da publicação pode estar gravado. */
async function assertNothingCommitted(s: EditorialStore, id: string): Promise<void> {
  assert.equal(await s.getArticle(id), undefined, 'matéria não pode existir');
  assert.deepEqual(await s.listAudit(), [], 'auditoria não pode existir');
  assert.deepEqual(await s.listOutbox(), [], 'outbox não pode existir');
}

export const EDITORIAL_STORE_CONTRACT: ContractCase[] = [
  { name: 'loja nova está vazia; get de chave inexistente devolve undefined', run: (f) => withStore(f, async (s) => {
    assert.equal(await s.getArticle('nao-existe'), undefined);
    assert.equal(await s.getCorrection('nao-existe'), undefined);
    assert.equal(await s.getSourceState('nao-existe'), undefined);
    assert.deepEqual(await s.listArticles(), []);
    assert.deepEqual(await s.listCorrections(), []);
    assert.deepEqual(await s.listSourceStates(), []);
    assert.deepEqual(await s.listAudit(), []);
  }) },
  { name: 'matéria: put/get preserva o registro (JSON), inclusive acentos, emoji e estruturas aninhadas', run: (f) => withStore(f, async (s) => {
    const a = sampleArticle('a1');
    await s.putArticle(a);
    assert.deepEqual(await s.getArticle('a1'), json(a));
  }) },
  { name: 'matéria: put é UPSERT (substitui por inteiro, sem duplicar)', run: (f) => withStore(f, async (s) => {
    await s.putArticle(sampleArticle('a1', { status: 'em_checagem', blockers: ['duplicate'] }));
    const second = sampleArticle('a1', { status: 'aprovado', blockers: [], findings: [], updatedAt: '2026-11-24T00:00:00.000Z' });
    delete second.factcheck;
    await s.putArticle(second);
    assert.equal((await s.listArticles()).length, 1);
    assert.deepEqual(await s.getArticle('a1'), json(second), 'campos antigos não podem sobreviver (ex.: factcheck removido, blockers esvaziados)');
  }) },
  { name: 'sem aliasing na entrada: alterar o objeto depois de put não altera o armazenado', run: (f) => withStore(f, async (s) => {
    const a = sampleArticle('a1');
    const expected = json(a);
    await s.putArticle(a);
    a.status = 'publicado'; a.draft!.headline = 'ALTERADO'; a.evidences[0]!.text = 'ALTERADO'; a.findings.push({ code: 'novo', message: 'novo' });
    assert.deepEqual(await s.getArticle('a1'), expected);
  }) },
  { name: 'sem aliasing na saída: alterar o objeto devolvido não altera o armazenado', run: (f) => withStore(f, async (s) => {
    await s.putArticle(sampleArticle('a1'));
    const got = (await s.getArticle('a1'))!;
    got.status = 'publicado'; got.draft!.claims.length = 0; got.evidences.length = 0;
    const listed = await s.listArticles(); listed[0]!.blockers.push('duplicate'); listed.length = 0;
    assert.deepEqual(await s.getArticle('a1'), json(sampleArticle('a1')));
    assert.equal((await s.listArticles()).length, 1);
  }) },
  { name: 'list devolve todos os registros, sem duplicatas (ordem não garantida)', run: (f) => withStore(f, async (s) => {
    for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) await s.putArticle(sampleArticle(id));
    await s.putArticle(sampleArticle('a3', { status: 'bloqueado' }));
    const ids = (await s.listArticles()).map((a) => a.articleId).sort();
    assert.deepEqual(ids, ['a1', 'a2', 'a3', 'a4', 'a5']);
  }) },
  { name: 'payload grande e texto multibyte são preservados sem truncar', run: (f) => withStore(f, async (s) => {
    const a = sampleArticle('big');
    a.draft!.body = `${'ação 🚀 日本語 '.repeat(30_000)}fim`;
    await s.putArticle(a);
    const got = await s.getArticle('big');
    assert.equal(got?.draft?.body.length, a.draft!.body.length);
    assert.ok(got?.draft?.body.endsWith('fim'));
  }) },
  { name: 'correção: put/get/list pela chave case.id; dados pessoais preservados como entregues', run: (f) => withStore(f, async (s) => {
    const c = sampleCorrection('k1');
    await s.putCorrection(c);
    assert.deepEqual(await s.getCorrection('k1'), json(c));
    const c2 = { ...c, case: { ...c.case, state: 'evidence_preserved' as const } };
    await s.putCorrection(c2);
    assert.equal((await s.listCorrections()).length, 1);
    assert.equal((await s.getCorrection('k1'))?.case.state, 'evidence_preserved');
    c.replyText = 'ALTERADO'; // sem aliasing
    assert.equal((await s.getCorrection('k1'))?.replyText, c2.replyText);
  }) },
  { name: 'estado de fonte: put/get/upsert/list', run: (f) => withStore(f, async (s) => {
    await s.putSourceState(sampleSourceState('bcb'));
    await s.putSourceState(sampleSourceState('cvm'));
    await s.putSourceState(sampleSourceState('bcb', { enabled: true, termsStatus: 'approved', paywall: 'none', updatedBy: 'u2' }));
    assert.equal((await s.listSourceStates()).length, 2);
    assert.deepEqual(await s.getSourceState('bcb'), json(sampleSourceState('bcb', { enabled: true, termsStatus: 'approved', paywall: 'none', updatedBy: 'u2' })));
  }) },
  { name: 'auditoria: somente-acréscimo, ordem de chegada preservada, null/opcionais mantidos', run: (f) => withStore(f, async (s) => {
    const items: AuditItem[] = [];
    for (let i = 0; i < 30; i++) {
      const it: AuditItem = { at: `2026-11-23T12:00:${String(i).padStart(2, '0')}.000Z`, userId: i % 3 === 0 ? null : `u${i}`, action: `acao.${i}`, target: `t${i}`, ...(i % 2 ? { detail: `detalhe ${i}` } : {}) };
      items.push(it);
      await s.appendAudit(it);
    }
    assert.deepEqual(await s.listAudit(), items.map((i) => json(i)));
    items[0]!.action = 'ALTERADO';
    assert.equal((await s.listAudit())[0]?.action, 'acao.0');
  }) },
  { name: 'concorrência: puts paralelos de chaves distintas e appends paralelos não perdem dados', run: (f) => withStore(f, async (s) => {
    await Promise.all(Array.from({ length: 25 }, (_, i) => s.putArticle(sampleArticle(`p${i}`))));
    assert.equal(new Set((await s.listArticles()).map((a) => a.articleId)).size, 25);
    await Promise.all(Array.from({ length: 40 }, (_, i) => s.appendAudit({ at: '2026-11-23T12:00:00.000Z', userId: 'u', action: `par.${i}`, target: 't' })));
    const actions = (await s.listAudit()).map((a) => a.action).sort();
    assert.equal(actions.length, 40);
    assert.equal(new Set(actions).size, 40);
  }) },
  { name: 'concorrência: puts paralelos da MESMA chave são atômicos (vence um registro inteiro, sem mistura de campos)', run: (f) => withStore(f, async (s) => {
    const variants = Array.from({ length: 10 }, (_, i) => sampleArticle('same', { status: i % 2 ? 'aprovado' : 'bloqueado', recheckCount: i, updatedAt: `2026-11-23T12:00:0${i}.000Z` }));
    await Promise.all(variants.map((v) => s.putArticle(v)));
    const got = await s.getArticle('same');
    assert.ok(variants.some((v) => JSON.stringify(json(v)) === JSON.stringify(got)), 'o registro final deve ser exatamente um dos enviados');
    assert.equal((await s.listArticles()).length, 1);
  }) },
  { name: 'publicação atômica: commitPublication grava matéria publicada (com recibo), auditoria e outbox juntas', run: (f) => withStore(f, async (s) => {
    const c = sampleCommit('pub1');
    assert.deepEqual(await s.commitPublication(c), { outbox: 'enqueued' });
    assert.deepEqual(await s.getArticle('pub1'), json(c.article));
    assert.deepEqual(await s.listAudit(), [json(c.audit)]);
    assert.deepEqual(await s.listOutbox(), [c.outbox]);
    c.article.status = 'aprovado'; c.outbox.refId = 'ALTERADO'; // sem aliasing na entrada
    assert.equal((await s.getArticle('pub1'))?.status, 'publicado');
    assert.equal((await s.listOutbox())[0]?.refId, 'pub1');
  }) },
  { name: 'publicação atômica: idempotente pela chave da outbox (repetição não duplica nem sobrescreve)', run: (f) => withStore(f, async (s) => {
    const c = sampleCommit('pub1');
    await s.commitPublication(c);
    const again = { ...sampleCommit('pub1', { receiptId: 'rcpt-OUTRO' }), outbox: c.outbox };
    assert.deepEqual(await s.commitPublication(again), { outbox: 'duplicate' });
    assert.equal((await s.listAudit()).length, 1);
    assert.equal((await s.listOutbox()).length, 1);
    assert.equal((await s.getArticle('pub1'))?.publication?.receiptId, 'rcpt-1', 'o registro original não é sobrescrito');
  }) },
  { name: 'publicação atômica: entrada inválida rejeita SEM efeito parcial', run: (f) => withStore(f, async (s) => {
    const bad: PublicationCommit[] = [
      { ...sampleCommit('x1'), article: sampleArticle('x1', { status: 'aprovado' }) },                         // não publicada
      { ...sampleCommit('x1'), article: sampleArticle('x1', { status: 'publicado' }) },                        // sem recibo
      { ...sampleCommit('x1'), outbox: { queue: 'intelligence-ingest', refId: 'x1', idempotencyKey: '' } },    // chave vazia
      { ...sampleCommit('x1'), audit: { at: '2026-11-24T13:00:00.000Z', userId: null, action: '', target: 'x1' } }, // auditoria vazia
    ];
    for (const c of bad) {
      await assert.rejects(s.commitPublication(c));
      await assertNothingCommitted(s, 'x1');
    }
  }) },
  { name: 'publicação atômica: commits idênticos em paralelo resultam em 1 matéria, 1 auditoria, 1 outbox e um único enqueued', run: (f) => withStore(f, async (s) => {
    const results = await Promise.all(Array.from({ length: 10 }, () => s.commitPublication(sampleCommit('par1'))));
    assert.equal(results.filter((r) => r.outbox === 'enqueued').length, 1);
    assert.equal(results.filter((r) => r.outbox === 'duplicate').length, 9);
    assert.equal((await s.listAudit()).length, 1);
    assert.equal((await s.listOutbox()).length, 1);
    assert.equal((await s.listArticles()).length, 1);
  }) },
  { name: 'publicação atômica: falha injetada entre os passos não deixa gravação parcial e a repetição completa tudo uma única vez', run: (f) => withStore(f, async (s, h) => {
    if (!h.armFault) return; // sem gancho de falha o caso não se aplica (recomendado implementar no Backend)
    for (const step of ['after_article', 'after_audit', 'after_outbox'] as const) {
      h.armFault(step);
      await assert.rejects(s.commitPublication(sampleCommit('f1')), /falha injetada|injected/i);
      await assertNothingCommitted(s, 'f1');
    }
    for (const step of ['after_article', 'after_audit', 'after_outbox'] as const) {
      h.armFault(step);
      await assert.rejects(s.commitPublication(sampleCommit('f2', { withCorrection: true })), /falha injetada|injected/i);
      assert.equal(await s.getCorrection('k-f2'), undefined, `${step}: o caso de correção também não pode ficar gravado`);
      assert.equal(await s.getArticle('f2'), undefined);
    }
    h.armFault(null);
    assert.deepEqual(await s.commitPublication(sampleCommit('f1')), { outbox: 'enqueued' });
    assert.equal((await s.listAudit()).length, 1);
    assert.equal((await s.listOutbox()).length, 1);
    assert.equal((await s.getArticle('f1'))?.status, 'publicado');
  }) },
  { name: 'publicação atômica: matéria corrigida + caso de correção + auditoria + outbox no MESMO commit (status corrigido aceito)', run: (f) => withStore(f, async (s) => {
    const c = sampleCommit('cor1', { withCorrection: true });
    c.article.status = 'corrigido';
    c.audit.action = 'article.corrected';
    c.outbox = { queue: 'article-corrected', refId: 'cor1', idempotencyKey: `article.corrected:cor1:${'c'.repeat(64)}` };
    assert.deepEqual(await s.commitPublication(c), { outbox: 'enqueued' });
    assert.deepEqual(await s.getArticle('cor1'), json(c.article));
    assert.deepEqual(await s.getCorrection('k-cor1'), json(c.correction));
    assert.deepEqual(await s.listOutbox(), [c.outbox]);
    assert.equal((await s.listAudit()).length, 1);
    // repetição: idempotente, sem tocar no caso nem duplicar nada
    assert.deepEqual(await s.commitPublication(c), { outbox: 'duplicate' });
    assert.equal((await s.listAudit()).length, 1);
    // caso inválido rejeita sem efeito
    const bad = sampleCommit('cor2', { withCorrection: true });
    bad.correction!.case.id = '';
    await assert.rejects(s.commitPublication(bad));
    assert.equal(await s.getArticle('cor2'), undefined);
    assert.equal((await s.listOutbox()).length, 1);
  }) },
  { name: 'handlers sobre a loja: fila e visão de revisão leem o que foi gravado', run: (f) => withStore(f, async (s) => {
    await s.putArticle(sampleArticle('h1', { status: 'bloqueado', blockers: ['duplicate'] }));
    const ctx: HandlerCtx = { actor: { userId: 'u', roles: ['editor'], mfa: true }, store: s, now: () => new Date('2026-11-24T10:00:00Z'), newId: () => 'id' };
    const q = await listQueue(ctx, {});
    assert.equal(q.status, 200);
    assert.equal((q.body as { total: number }).total, 1);
    assert.equal((await getArticleReview(ctx, { articleId: 'h1' })).status, 200);
    assert.equal((await getArticleReview(ctx, { articleId: 'nao-existe' })).status, 404);
  }) },
  { name: 'handlers sobre a loja: revisão e habilitação de fonte persistem e a auditoria fica gravada', run: (f) => withStore(f, async (s) => {
    const mk = (userId: string, role: string): HandlerCtx => ({ actor: { userId, roles: [role], mfa: true }, store: s, sources: new SourceRegistry(SEED_SOURCES), now: () => new Date('2026-11-24T10:00:00Z'), newId: () => 'id' });
    const rv = await reviewSource(mk('revisora', 'editor_chefe'), { sourceId: 'bcb', termsStatus: 'approved', termsNote: 'Termos oficiais lidos pelo revisor responsável.', urlVerified: true, robotsChecked: true, paywall: 'none' });
    assert.equal(rv.status, 200);
    assert.equal((await setSourceEnabled(mk('chefe', 'admin'), { sourceId: 'bcb', enabled: true })).status, 200);
    assert.equal((await s.getSourceState('bcb'))?.enabled, true);
    assert.deepEqual((await s.listAudit()).map((a) => a.action), ['source.review', 'source.enable']);
  }) },
];

/** Registra a suíte no vitest do chamador. */
export function runEditorialStoreContract(name: string, factory: StoreFactory): void {
  describe(`EditorialStore contract — ${name}`, () => {
    for (const c of EDITORIAL_STORE_CONTRACT) it(c.name, () => c.run(factory));
  });
}
