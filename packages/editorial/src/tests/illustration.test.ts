import { test, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import { ILLUSTRATION_CREDIT, ImageRights, imageLabel } from '@ln/contracts';
import { Collector } from '../collector/collector';
import { COLLECT_ON, MOCK_SOURCE, mockResolver } from '../../fixtures/mock-web.mock';
import { MockGateway, mockOk } from '../../fixtures/mock-gateway.mock';
import { mockWebRoles, passAll, rolesDraftOutput } from '../../fixtures/mock-roles.mock';
import { SourceRegistry } from '../sources/registry';
import { InMemoryAuditLog, socialPack } from '../pipeline/stages';
import type { StageDeps } from '../pipeline/stages';
import { InMemoryQueue, makeProcessor } from '../pipeline/queue';
import type { Draft, Evidence } from '../types';
import { InMemoryEditorialStore, applyOutcome } from '../api/store';
import { confirmIllustrationLimits } from '../api/illustration';
import type { HandlerCtx } from '../api/handlers';
import { runDeterministicChecks } from '../rules/rules';
import { draftContentSha256, imageToRights, makeIllustration, toPublishableContent } from '../publishable';

const NOW = new Date('2026-11-24T13:00:00Z');
const URL_PUB = 'https://loyaltynews.example/materia/a1';
let ev: Evidence;
beforeAll(async () => {
  ev = (await new Collector(mockWebRoles(), { minSpacingMs: 0, now: () => NOW, resolver: mockResolver(), flags: COLLECT_ON }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/nomeacoes')).evidence!;
});

const gw = () => new MockGateway(ev.id, {
  draft: () => mockOk('deepseek', rolesDraftOutput(ev.id)),
  factcheck: () => mockOk('anthropic', passAll(['c1', 'c2', 'c3'])),
  social_pack: () => mockOk('deepseek', { linkedin: 'MOCK: Alfa muda a diretoria.' }),
});

async function approved() {
  const store = new InMemoryEditorialStore();
  const deps: StageDeps = { gateway: gw(), registry: new SourceRegistry([MOCK_SOURCE]), audit: new InMemoryAuditLog(), flags: { editorialPipeline: true }, now: () => NOW };
  const q = new InMemoryQueue();
  await q.enqueue({ stage: 'triage', jobId: 'a1:triage:0', data: { articleId: 'a1', editoria: 'mercado', evidences: [ev], attempt: 0 } });
  await q.drain(makeProcessor(deps, q));
  for (const { spec, outcome } of q.processed) await applyOutcome(store, spec.data, outcome, NOW.toISOString());
  return { store, deps, draft: (await store.getArticle('a1'))!.draft! };
}

const ill = () => makeIllustration({ url: 'https://cdn.loyaltynews.example/ilustracoes/a1.png', alt: 'pontos viram passagens', generatedBy: 'gerador-MOCK-v1', promptVersion: 'img-0.1', prompt: 'PROMPT MOCK SECRETO' });
const reviewed = () => ({ ...ill(), humanReview: { reviewedBy: 'revisora', at: '2026-11-24T10:00:00Z', limitsConfirmed: true as const } });

test('ADR-018: ilustração → ImageRights (origem ilustracao_gerada, base gerada_ia, crédito institucional) sem NENHUM dado interno', async () => {
  const { draft: d } = await approved();
  const withIll: Draft = { ...d, image: ill() };
  const r = ImageRights.parse(imageToRights(withIll));
  assert.deepEqual([r.origem, r.baseDeDireito, r.credito, r.edicoes], ['ilustracao_gerada', 'gerada_ia', ILLUSTRATION_CREDIT, []]);
  assert.equal(r.textoAlternativo, 'Ilustração conceitual: pontos viram passagens');
  assert.equal(r.link, undefined);
  const blob = JSON.stringify({ rights: imageToRights(withIll), content: toPublishableContent(withIll) });
  for (const interno of ['gerador-MOCK-v1', 'img-0.1', 'PROMPT MOCK', 'generatedBy', 'promptVersion', 'promptSha256']) assert.ok(!blob.includes(interno), `${interno} vazou`);
  assert.ok(withIll.image.mode === 'conceptual' && /^[0-9a-f]{64}$/.test(withIll.image.promptSha256), 'registro interno guarda só o hash do prompt');
  assert.equal(imageLabel(r), 'Ilustração conceitual');
  assert.equal(imageLabel(r, { rotulagemIa: true }), 'Ilustração conceitual gerada por IA');
  assert.equal(ImageRights.parse(imageToRights({ ...d, image: { ...ill(), alt: 'Ilustração conceitual: já prefixado' } })).textoAlternativo, 'Ilustração conceitual: já prefixado');
  // trocar foto por ilustração, ou uma ilustração por outra, invalida o recibo
  assert.notEqual(draftContentSha256(withIll), draftContentSha256(d));
  assert.notEqual(draftContentSha256(withIll), draftContentSha256({ ...d, image: { ...ill(), url: 'https://cdn.loyaltynews.example/ilustracoes/outra.png' } }));
  // revisão humana e registro interno NÃO mudam o hash (não vão ao portal)
  assert.equal(draftContentSha256(withIll), draftContentSha256({ ...d, image: { ...ill(), generatedBy: 'outro-gerador', humanReview: { reviewedBy: 'x', at: '2026-11-24T10:00:00Z', limitsConfirmed: true } } }));
});

test('ADR-018: gate — ilustração exige revisão humana dos limites; cobertura_evento não aceita; sem menção a IA no alt', async () => {
  const { draft: d } = await approved();
  const codes = (x: Draft) => runDeterministicChecks(x, [ev]).findings.map((f) => f.code);
  assert.deepEqual(codes({ ...d, image: ill() }), ['illustration_needs_human_review']);
  assert.deepEqual(codes({ ...d, image: reviewed() }), []);
  assert.ok(codes({ ...d, image: reviewed(), tipoConteudo: 'cobertura_evento' }).includes('illustration_not_allowed_for_event'));
  assert.ok(codes({ ...d, image: { ...reviewed(), alt: 'Ilustração gerada por IA' } }).includes('illustration_mentions_tool'));
  assert.ok(codes({ ...d, image: { ...reviewed(), alt: 'Cena feita com o modelo X' } }).includes('illustration_mentions_tool'));
});

test('ADR-018: confirmIllustrationLimits registra a revisão humana (papel, nota, auditoria) e libera o gate', async () => {
  const { store } = await approved();
  const rec = (await store.getArticle('a1'))!;
  await store.putArticle({ ...rec, draft: { ...rec.draft!, image: ill() } });
  const mk = (roles: string[], mfa = true): HandlerCtx => ({ actor: { userId: 'ana-revisora', roles, mfa }, store, now: () => NOW, newId: () => 'id' });
  const NOTE = 'conferido: sem pessoas, marcas ou cena documental';
  assert.equal((await confirmIllustrationLimits(mk(['editor']), { articleId: 'a1', note: NOTE })).status, 403);
  assert.equal((await confirmIllustrationLimits(mk(['revisor'], false), { articleId: 'a1', note: NOTE })).status, 401);
  assert.equal((await confirmIllustrationLimits(mk(['revisor']), { articleId: 'a1', note: 'curta' })).status, 400);
  assert.equal((await confirmIllustrationLimits(mk(['revisor']), { articleId: 'nao-existe', note: NOTE })).status, 404);
  assert.equal((await confirmIllustrationLimits(mk(['revisor']), { articleId: 'a1', note: NOTE })).status, 200);
  const after = (await store.getArticle('a1'))!;
  assert.ok(after.draft!.image.mode === 'conceptual' && after.draft!.image.humanReview?.reviewedBy === 'ana-revisora');
  assert.deepEqual(runDeterministicChecks(after.draft!, after.evidences).findings, []);
  assert.ok((await store.listAudit()).some((a) => a.action === 'illustration.limits_confirmed' && a.userId === 'ana-revisora'));
  // matéria já publicada: use o fluxo de correção
  await store.putArticle({ ...after, status: 'publicado' });
  assert.equal((await confirmIllustrationLimits(mk(['revisor']), { articleId: 'a1', note: NOTE })).status, 409);
  // sem ilustração: conflito
  await store.putArticle({ ...after, draft: { ...after.draft!, image: { mode: 'none', reason: 'x' } } });
  assert.equal((await confirmIllustrationLimits(mk(['revisor']), { articleId: 'a1', note: NOTE })).status, 409);
});

test('ADR-018: o card social leva o mesmo rótulo visível da ilustração (só cita IA com rotulagemIa); foto não ganha rótulo', async () => {
  const { deps, draft } = await approved();
  const job = { articleId: 'a1', editoria: draft.editoria, evidences: [ev], attempt: 0, approved: true, draft: { ...draft, image: reviewed() } };
  const o = await socialPack(deps, job, { url: URL_PUB });
  assert.ok(o.kind === 'done' && o.pack);
  assert.deepEqual([o.pack.image.mode, o.pack.image.label], ['conceptual', 'Ilustração conceitual']);
  assert.deepEqual(o.pack.blockers, []);
  const o2 = await socialPack({ ...deps, flags: { editorialPipeline: true, rotulagemIa: true } }, job, { url: URL_PUB });
  assert.equal(o2.kind === 'done' && o2.pack?.image.label, 'Ilustração conceitual gerada por IA');
  const photo = await socialPack(deps, { ...job, draft: { ...draft, image: { mode: 'source_image', sourceId: 'mock-ri', url: 'https://ri.mock.example/i.jpg', credit: 'c', creditLink: 'https://ri.mock.example', basis: null } } }, { url: URL_PUB });
  assert.equal(photo.kind === 'done' && photo.pack?.image.label, undefined);
});
