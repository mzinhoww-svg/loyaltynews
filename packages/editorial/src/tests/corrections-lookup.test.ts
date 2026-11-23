import { test, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { COLLECT_ON, MOCK_SOURCE, mockResolver, mockWeb } from '../../fixtures/mock-web.mock';
import { InMemoryEditorialStore } from '../api/store';
import type { ArticleRecord } from '../api/store';
import type { Actor, HandlerCtx } from '../api/handlers';
import { getCorrection, intakeRightOfReply, openCorrection, preserveCorrectionEvidence, triageCorrection } from '../api/handlers';
import type { CorrectionView } from '../api/handlers';
import { isCorrectable, storeBackedPublishedLookup } from '../api/published-lookup';
import type { PublishedArticleLookup, PublishedArticleRef } from '../api/published-lookup';
import type { Evidence } from '../types';

const NOW = new Date('2026-11-25T10:00:00Z');
const chefe: Actor = { userId: 'maria-chefe', roles: ['editor_chefe'], mfa: true };
let ev: Evidence;
beforeAll(async () => {
  ev = (await new Collector(mockWeb(), { now: () => NOW, resolver: mockResolver(), flags: COLLECT_ON }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria')).evidence!;
});

/** Lookup MOCK do CMS: matérias que NÃO existem no EditorialStore (nascem no CMS), com evidências ligadas em article_sources. */
function cmsLookup(refs: PublishedArticleRef[], evidences: Evidence[] = []): PublishedArticleLookup {
  return { async get(id) { return refs.find((r) => r.id === id); }, async evidences() { return evidences; } };
}
const ref = (over: Partial<PublishedArticleRef> = {}): PublishedArticleRef => ({ id: 'cms-1', slug: 'materia-do-cms', titulo: 'MOCK: matéria do CMS', status: 'publicado', versao: 3, publicadoEm: '2026-11-20T12:00:00.000Z', origem: 'cms', ...over });
const mk = (actor: Actor | null, store: InMemoryEditorialStore, published?: PublishedArticleLookup): HandlerCtx => {
  let n = 0; // ids sequenciais por contexto: k1, k2, ...
  return { actor, store, now: () => NOW, newId: () => `k${++n}`, siteBaseUrl: 'https://loyaltynews.example/', ...(published ? { published } : {}) };
};
const OPEN = { kind: 'erratum', contested: '3 pontos por real', requester: { name: 'MOCK Leitor', channel: 'email' } } as const;

test('ADR-019: caso de correção abre para matéria SÓ do CMS (fora do EditorialStore) e guarda versão, origem e slug', async () => {
  const store = new InMemoryEditorialStore();
  const c = mk(chefe, store, cmsLookup([ref()]));
  const r = await openCorrection(c, { ...OPEN, articleId: 'cms-1' });
  assert.equal(r.status, 201);
  const v = r.body as CorrectionView;
  assert.deepEqual([v.articleId, v.articleVersao, v.articleOrigem, v.articleSlug], ['cms-1', 3, 'cms', 'materia-do-cms']);
  assert.equal(await store.getArticle('cms-1'), undefined, 'a matéria do CMS não está no registro editorial');
  assert.equal(((await getCorrection(c, { correctionId: 'k1' })).body as CorrectionView).articleVersao, 3);
});

test('ADR-019: correção de matéria publicada, corrigida ou despublicada; rascunho/aprovada/bloqueada/inexistente dão 404 IDÊNTICO', async () => {
  const store = new InMemoryEditorialStore();
  const refs = [
    ref({ id: 'p', status: 'publicado' }), ref({ id: 'c', status: 'corrigido' }), ref({ id: 'd', status: 'despublicado' }),
    ref({ id: 'r', status: 'rascunho' }), ref({ id: 'e', status: 'em_checagem' }), ref({ id: 'a', status: 'aprovado' }), ref({ id: 'b', status: 'bloqueado' }),
  ];
  const c = mk(chefe, store, cmsLookup(refs));
  for (const id of ['p', 'c', 'd']) assert.equal((await openCorrection(c, { ...OPEN, articleId: id })).status, 201, id);
  const answers = new Set<string>();
  for (const id of ['r', 'e', 'a', 'b', 'nao-existe']) {
    const res = await openCorrection(c, { ...OPEN, articleId: id });
    assert.equal(res.status, 404, id);
    answers.add(JSON.stringify(res));
  }
  assert.equal(answers.size, 1, 'a resposta de "não publicada" não pode diferir da de "inexistente"');
  // intake público: mesma resposta, nada gravado
  const pub: HandlerCtx = { ...c, actor: null }; // mesmo contador de ids
  const body = { contested: 'afirmação sobre a empresa', requester: { name: 'MOCK Empresa' }, replyText: 'Resposta MOCK da empresa, sem qualquer edição, para publicação.' };
  const draft = await intakeRightOfReply(pub, { ...body, articleId: 'r' });
  const none = await intakeRightOfReply(pub, { ...body, articleId: 'nao-existe' });
  assert.deepEqual(draft, none);
  assert.equal(draft.status, 404);
  assert.equal((await intakeRightOfReply(pub, { ...body, articleId: 'p' })).status, 201);
  assert.equal((await store.listCorrections()).length, 4, 'só os casos de matérias publicadas foram gravados (3 internos + 1 intake)');
});

test('ADR-019: sem a porta de matérias publicadas o caso não abre (503) e a matéria do store que não está publicada também dá 404', async () => {
  const store = new InMemoryEditorialStore();
  assert.equal((await openCorrection(mk(chefe, store), { ...OPEN, articleId: 'x' })).status, 503);
  // matéria da Fábrica só aprovada (não publicada) no store: a referência de store dá 404
  const rec: ArticleRecord = { articleId: 'f1', editoria: 'pontos', status: 'aprovado', evidences: [ev], blockers: [], findings: [], reviews: [], recheckCount: 0, updatedAt: NOW.toISOString() };
  await store.putArticle(rec);
  const c = mk(chefe, store, storeBackedPublishedLookup(store));
  assert.equal((await openCorrection(c, { ...OPEN, articleId: 'f1' })).status, 404);
  await store.putArticle({ ...rec, status: 'publicado' });
  const ok = await openCorrection(c, { ...OPEN, articleId: 'f1' });
  assert.equal(ok.status, 201);
  assert.equal((ok.body as CorrectionView).articleOrigem, 'fabrica');
  assert.equal(isCorrectable(undefined), false);
});

test('ADR-019: preservar evidência usa /noticia/{slug} por padrão; a verificação da errata usa as evidências do CMS (article_sources)', async () => {
  const store = new InMemoryEditorialStore();
  const c = mk(chefe, store, cmsLookup([ref()], [ev]));
  await openCorrection(c, { ...OPEN, articleId: 'cms-1' });
  const pre = await preserveCorrectionEvidence(c, { correctionId: 'k1', body: '<html>versão publicada</html>' });
  assert.equal(pre.status, 200);
  const rec = (await store.getCorrection('k1'))!;
  assert.equal(rec.case.archive?.url, 'https://loyaltynews.example/noticia/materia-do-cms');
  // sem siteBaseUrl e sem URL: pede a URL
  const noBase = { ...c, siteBaseUrl: undefined } as HandlerCtx;
  const k2 = await openCorrection({ ...noBase, newId: () => 'k2' }, { ...OPEN, articleId: 'cms-1' });
  assert.equal(k2.status, 201);
  assert.equal((await preserveCorrectionEvidence({ ...noBase, newId: () => 'k2' }, { correctionId: 'k2', body: 'x' })).status, 400);
  // errata sustentada pela evidência do CMS (que não existe no EditorialStore) é aceita; número fora da evidência é recusado
  const claim = (text: string) => [{ id: 'c1', kind: 'number' as const, text, evidenceIds: [ev.id] }];
  assert.equal((await triageCorrection(c, { correctionId: 'k1', accepted: true, reason: 'evidência confirma', corrected: '2 pontos por real', claims: claim('9 pontos por real') })).status, 409);
  const ok = await triageCorrection(c, { correctionId: 'k1', accepted: true, reason: 'evidência confirma', corrected: '2 pontos por real', claims: claim('2 pontos por real') });
  assert.equal(ok.status, 200);
  assert.equal((ok.body as CorrectionView).state, 'accepted');
  // sem nenhuma evidência (porta sem article_sources e sem registro editorial): errata não é sustentada
  const bare = mk(chefe, store, cmsLookup([ref({ id: 'cms-2' })], []));
  await openCorrection({ ...bare, newId: () => 'k3' }, { ...OPEN, articleId: 'cms-2' });
  await preserveCorrectionEvidence({ ...bare, newId: () => 'k3' }, { correctionId: 'k3', body: 'x' });
  assert.equal((await triageCorrection(bare, { correctionId: 'k3', accepted: true, reason: 'sem evidência', corrected: '2 pontos por real', claims: claim('2 pontos por real') })).status, 409);
});
