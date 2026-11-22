import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildErratumNotice, buildReplyNotice, closeCase, isOverdue, markEntitiesRebuilt, openCase, ownerAck, preserveEvidence,
  publishNotice, reconcileSocial, triage, verifyCorrectionClaims,
} from '../src/corrections/corrections.ts';
import type { CorrectionCase, Step } from '../src/corrections/corrections.ts';
import { Collector } from '../src/collector/collector.ts';
import { MOCK_SOURCE, mockWeb } from '../fixtures/mock-web.mock.ts';
import { SIGNATURE } from '../src/types.ts';

const T = (n: number) => `2026-11-2${n}T12:00:00.000Z`;
const must = (s: Step): CorrectionCase => { assert.ok(s.ok, s.ok ? '' : `${s.blocker}: ${s.message}`); return s.case; };

const base = (over: Partial<Parameters<typeof openCase>[0]> = {}) => openCase({
  id: 'k1', articleId: 'a1', kind: 'erratum', receivedAt: T(3), contested: '3 pontos por real', supportingEvidenceIds: ['ev1'],
  requester: { name: 'MOCK Leitor', identityVerified: false, channel: 'email' }, legal: false,
  socialPosts: [{ postId: 'li-1', channel: 'linkedin', reconciled: false }], ...over,
});

test('errata: fluxo completo com preservação, aviso público datado, reconciliação social e entidades', () => {
  let c = base();
  c = must(preserveEvidence(c, { url: 'https://loyaltynews.example/a1', body: '<html>versão publicada</html>', capturedAt: T(3) }));
  assert.match(c.archive!.sha256, /^[0-9a-f]{64}$/);
  c = must(triage(c, { accepted: true, reason: 'evidência confirma', at: T(3) }));
  assert.equal(c.state, 'accepted');
  const text = buildErratumNotice({ contested: '3 pontos por real', corrected: '2 pontos por real', at: T(3) });
  assert.match(text, /Correção \(2026-11-23\)/);
  assert.ok(text.includes(SIGNATURE));
  c = must(publishNotice(c, { text }, T(3)));
  // social pendente => remote_unresolved
  const pend = reconcileSocial(c, [], T(3));
  assert.ok(!pend.ok && pend.blocker === 'remote_unresolved');
  c = must(reconcileSocial(c, [{ postId: 'li-1' }], T(3)));
  const early = closeCase(c, T(4));
  assert.ok(!early.ok && early.blocker === 'remote_unresolved'); // entidades ainda não reconstruídas
  c = must(closeCase(markEntitiesRebuilt(c), T(4)));
  assert.equal(c.state, 'closed');
  assert.deepEqual(c.history.map((h) => h.to), ['received', 'evidence_preserved', 'triaged', 'accepted', 'notice_published', 'social_reconciled', 'closed']);
});

test('errata aceita sem evidência de suporte é bloqueada (missing_evidence)', () => {
  let c = must(preserveEvidence(base({ supportingEvidenceIds: [] }), { url: 'u', body: 'b', capturedAt: T(3) }));
  const r = triage(c, { accepted: true, reason: 'x', at: T(3) });
  assert.ok(!r.ok && r.blocker === 'missing_evidence');
});

test('pedido de direito de resposta com identidade não verificada é bloqueado (unverified_request)', () => {
  const c = must(preserveEvidence(base({ kind: 'right_of_reply' }), { url: 'u', body: 'b', capturedAt: T(3) }));
  const r = triage(c, { accepted: true, reason: 'x', at: T(3) });
  assert.ok(!r.ok && r.blocker === 'unverified_request');
});

test('direito de resposta: caso jurídico escala ao responsável; sem ciência não publica; texto preservado com hash', () => {
  const reqr = { name: 'MOCK Empresa', identityVerified: true, channel: 'email' };
  let c = must(preserveEvidence(base({ kind: 'right_of_reply', requester: reqr, socialPosts: [], legal: true }), { url: 'u', body: 'b', capturedAt: T(3) }));
  c = must(triage(c, { accepted: true, reason: 'pedido formal válido', at: T(3) }));
  assert.equal(c.state, 'escalated_legal');
  assert.equal(c.ownerNotifiedAt, T(3));
  const reply = buildReplyNotice(c, 'Texto original do requerente, sem edições.', T(4));
  const blocked = publishNotice(c, reply, T(4));
  assert.ok(!blocked.ok && blocked.blocker === 'owner_ack_missing');
  c = must(publishNotice(ownerAck(c, T(4)), reply, T(4)));
  assert.match(c.notice!.text, /sem alterações/);
  assert.ok(c.notice!.text.includes('Texto original do requerente, sem edições.'));
  assert.match(c.notice!.replySha256!, /^[0-9a-f]{64}$/);
  c = must(reconcileSocial(c, [], T(4)));
  c = must(closeCase(markEntitiesRebuilt(c), T(5)));
  assert.equal(c.state, 'closed');
});

test('caso jurídico rejeitado pelo agente não fecha sem ciência do responsável', () => {
  const reqr = { name: 'MOCK', identityVerified: true, channel: 'email' };
  let c = must(preserveEvidence(base({ kind: 'right_of_reply', requester: reqr, legal: true }), { url: 'u', body: 'b', capturedAt: T(3) }));
  c = must(triage(c, { accepted: false, reason: 'fora do escopo', at: T(3) }));
  assert.equal(c.state, 'escalated_legal');
  const r = closeCase(c, T(4));
  assert.ok(!r.ok && r.blocker === 'owner_ack_missing');
  assert.equal(must(closeCase(ownerAck(c, T(4)), T(4))).state, 'closed');
});

test('direito de resposta sem hash do texto original é recusado; transição inválida é recusada', () => {
  const reqr = { name: 'MOCK', identityVerified: true, channel: 'email' };
  let c = must(preserveEvidence(base({ kind: 'right_of_reply', requester: reqr, legal: true }), { url: 'u', body: 'b', capturedAt: T(3) }));
  c = ownerAck(must(triage(c, { accepted: true, reason: 'ok', at: T(3) })), T(3));
  const r = publishNotice(c, { text: 'resposta' }, T(4));
  assert.ok(!r.ok && r.blocker === 'notice_missing');
  const inv = publishNotice(base(), { text: 'x' }, T(3));
  assert.ok(!inv.ok && inv.blocker === 'invalid_transition');
});

test('pedido rejeitado (não jurídico) fecha com motivo registrado', () => {
  let c = must(preserveEvidence(base(), { url: 'u', body: 'b', capturedAt: T(3) }));
  c = must(triage(c, { accepted: false, reason: 'sem fundamento', at: T(3) }));
  assert.equal(c.state, 'rejected');
  assert.equal(must(closeCase(c, T(3))).state, 'closed');
});

test('a correção também é verificada: claim da errata precisa constar na evidência', async () => {
  const ev = (await new Collector(mockWeb(), { now: () => new Date(T(3)) }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria')).evidence!;
  assert.deepEqual(verifyCorrectionClaims([{ id: 'k', kind: 'number', text: '2 pontos por real', evidenceIds: [ev.id] }], [ev]), []);
  const f = verifyCorrectionClaims([{ id: 'k', kind: 'number', text: '9 pontos por real', evidenceIds: [ev.id] }], [ev]);
  assert.equal(f[0]?.code, 'unsupported_metric');
});

test('atraso é só informativo e não presume prazo legal (deadline nulo => nunca atrasado)', () => {
  assert.equal(isOverdue(base(), new Date('2030-01-01')), false);
  assert.equal(isOverdue(base({ deadlineAt: T(4) }), new Date(T(5))), true);
});
