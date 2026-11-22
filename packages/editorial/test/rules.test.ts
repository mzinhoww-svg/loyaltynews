import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collector } from '../src/collector/collector.ts';
import { MOCK_SOURCE, mockWeb } from '../fixtures/mock-web.mock.ts';
import { goodDraftOutput, MOCK_EVIDENCE_QUOTE } from '../fixtures/mock-gateway.mock.ts';
import {
  buildAttribution, checkClaims, checkImage, checkNoFabricatedReporting, checkOriginality, checkSignature,
  decideImage, runDeterministicChecks,
} from '../src/rules/rules.ts';
import { SIGNATURE } from '../src/types.ts';
import type { Draft, Evidence } from '../src/types.ts';

const col = new Collector(mockWeb(), { now: () => new Date('2026-11-23T12:00:00Z') });
const ev: Evidence = (await col.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria')).evidence!;

function mk(over: Partial<Draft> & { body?: string } = {}): Draft {
  const o = goodDraftOutput(ev.id) as { headline: string; body: string; claims: Draft['claims'] };
  const body = `${over.body ?? o.body}\n\n${buildAttribution([ev], [MOCK_SOURCE])}`;
  return {
    id: 'd', editoria: 'pontos-milhas', headline: o.headline, claims: o.claims, evidenceIds: [ev.id], signature: SIGNATURE,
    image: { mode: 'none', reason: 'teste' }, modelProvider: 'deepseek', promptVersion: 't', ...over, body,
  };
}

test('rascunho bom passa em todas as verificações determinísticas', () => {
  const r = runDeterministicChecks(mk(), [ev]);
  assert.deepEqual(r.findings, []);
  assert.equal(r.verdict, 'pass');
});

test('assinatura: só "Redação Loyalty News"; byline de pessoa é rejeitada', () => {
  assert.equal(checkSignature(mk({ signature: 'João Silva' })).findings[0]?.code, 'bad_signature');
  assert.equal(checkSignature(mk({ body: 'Por Maria Souza\nTexto.' })).findings[0]?.code, 'invented_byline');
  assert.equal(checkSignature(mk()).verdict, 'pass');
});

test('nunca inventar entrevista ou apuração presencial', () => {
  for (const t of ['Em entrevista exclusiva à Redação, a diretora disse algo.', 'Nossa reportagem esteve no evento.', 'Conversamos com o presidente.', 'Segundo apuração presencial da equipe.']) {
    assert.equal(checkNoFabricatedReporting(mk({ body: t })).verdict, 'fail', t);
  }
});

test('nunca inventar fala: citação fora da evidência é rejeitada (claim e corpo)', () => {
  const d = mk({ body: 'A diretora afirmou: "este é um texto inventado que nunca foi dito por ninguém".' });
  assert.ok(runDeterministicChecks(d, [ev]).findings.some((x) => x.code === 'invented_quote'));
  const d2 = mk();
  d2.claims = [{ id: 'q', kind: 'quote', text: 'fala', evidenceIds: [ev.id], quote: { text: 'frase inventada pela IA agora', speaker: 'Maria Teste' } }];
  assert.ok(checkClaims(d2, [ev]).findings.some((x) => x.code === 'invented_quote'));
  d2.claims = [{ id: 'q', kind: 'quote', text: 'fala', evidenceIds: [ev.id], quote: { text: MOCK_EVIDENCE_QUOTE, speaker: 'Pessoa Inventada' } }];
  assert.ok(checkClaims(d2, [ev]).findings.some((x) => x.message.includes('autor da fala')));
});

test('nunca inventar métrica: número fora da evidência é rejeitado', () => {
  const d = mk({ body: 'O programa teve 1.500.000 de participantes e crescimento de 35%.' });
  const f = runDeterministicChecks(d, [ev]).findings.filter((x) => x.code === 'unsupported_metric');
  assert.ok(f.length >= 2);
});

test('claim sem evidência ou com evidência inexistente é rejeitado', () => {
  const d = mk();
  d.claims = [{ id: 'x', kind: 'fact', text: 'algo', evidenceIds: [] }, { id: 'y', kind: 'fact', text: 'algo', evidenceIds: ['ev_nao_existe'] }];
  const codes = checkClaims(d, [ev]).findings.map((x) => x.code);
  assert.ok(codes.includes('unsupported_claim') && codes.includes('unknown_evidence'));
});

test('originalidade: cópia literal e troca de palavras superficial são barradas', () => {
  const copied = mk({ body: ev.text.split('\n').find((l) => l.includes('informou nesta segunda-feira'))! });
  assert.ok(checkOriginality(copied, [ev]).findings.some((x) => x.code === 'copy_literal'));
  assert.equal(checkOriginality(mk(), [ev]).verdict, 'pass');
});

test('atribuição: link da fonte é obrigatório', () => {
  const d = mk();
  d.body = d.body.replace(ev.canonicalUrl, 'x');
  assert.ok(runDeterministicChecks(d, [ev]).findings.some((x) => x.code === 'missing_attribution'));
});

test('evidência suspeita nunca sustenta matéria', () => {
  const sus = { ...ev, suspicious: true, suspiciousReasons: ['publish_command'] };
  assert.ok(runDeterministicChecks(mk(), [sus]).findings.some((x) => x.code === 'suspicious_evidence'));
});

test('imagem (D08): sem base de direito registrada => sem foto; com base + crédito => imagem da fonte', () => {
  const cand = { url: 'https://ri.mock.example/img.jpg', credit: 'MOCK Foto', creditLink: 'https://ri.mock.example/' };
  assert.equal(decideImage(MOCK_SOURCE, cand).mode, 'none');
  assert.equal(decideImage(MOCK_SOURCE, null).mode, 'none');
  const withBasis = { ...MOCK_SOURCE, imageRights: { kind: 'license' as const, reference: 'LIC-MOCK-1', registeredAt: '2026-11-22T00:00:00Z', validatedBy: 'root' } };
  const img = decideImage(withBasis, cand);
  assert.equal(img.mode, 'source_image');
  assert.equal(checkImage(img).verdict, 'pass');
  assert.equal(decideImage(withBasis, { ...cand, credit: '' }).mode, 'none');
  // decisão forjada sem base é barrada pelo gate
  assert.equal(checkImage({ mode: 'source_image', sourceId: 's', url: 'u', credit: 'c', creditLink: 'l', basis: null }).findings[0]?.code, 'rights_basis_unresolved');
  assert.equal(checkImage({ mode: 'conceptual', label: 'imagem', generatedBy: 'x' }).findings[0]?.code, 'conceptual_unlabeled');
  assert.equal(checkImage({ mode: 'conceptual', label: 'Ilustração conceitual gerada por IA', generatedBy: 'x' }).verdict, 'pass');
});
