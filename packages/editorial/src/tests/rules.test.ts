import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { MOCK_SOURCE, mockResolver, mockWeb, COLLECT_ON } from '../../fixtures/mock-web.mock';
import { goodDraftOutput, MOCK_EVIDENCE_QUOTE } from '../../fixtures/mock-gateway.mock';
import {
  buildAttribution, checkClaims, checkImage, checkNoFabricatedReporting, checkOriginality, checkSignature,
  decideImage, runDeterministicChecks,
} from '../rules/rules';
import { makeIllustration } from '../publishable';
import { SIGNATURE } from '../types';
import type { Draft, Evidence } from '../types';

const col = new Collector(mockWeb(), { minSpacingMs: 0, now: () => new Date('2026-11-23T12:00:00Z'), resolver: mockResolver(), flags: COLLECT_ON });
const ev: Evidence = (await col.collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria')).evidence!;

function mk(over: Partial<Draft> & { body?: string } = {}): Draft {
  const o = goodDraftOutput(ev.id) as { headline: string; body: string; claims: Draft['claims'] };
  const body = `${over.body ?? o.body}\n\n${buildAttribution([ev], [MOCK_SOURCE])}`;
  return {
    id: 'd', editoria: 'pontos', slug: 'mock-programa-alfa', resumo: 'Resumo MOCK do programa fictício.', tipoConteudo: 'noticia', classeDeDado: 'public', patrocinado: false, headline: o.headline, claims: o.claims, evidenceIds: [ev.id], signature: SIGNATURE,
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
  // ilustração conceitual (ADR-018): sem revisão humana dos limites o gate bloqueia; com revisão e registro completo passa
  const ill = makeIllustration({ url: 'https://cdn.loyaltynews.example/ilustracoes/a1.png', alt: 'Ilustração conceitual: pontos viram passagens', generatedBy: 'gerador-MOCK', promptVersion: 'img-0.1', prompt: 'PROMPT MOCK' });
  assert.deepEqual(checkImage(ill).findings.map((x) => x.code), ['illustration_needs_human_review']);
  assert.equal(checkImage({ ...ill, humanReview: { reviewedBy: 'revisora', at: '2026-11-24T10:00:00Z', limitsConfirmed: true } }).verdict, 'pass');
  assert.ok(checkImage({ ...ill, alt: 'Imagem gerada por IA com modelo X' }).findings.some((x) => x.code === 'illustration_mentions_tool'));
  assert.ok(checkImage({ ...ill, alt: ' ' }).findings.some((x) => x.code === 'illustration_alt_missing'));
  assert.ok(checkImage({ ...ill, url: 'ftp://x' }).findings.some((x) => x.code === 'illustration_url_invalid'));
  assert.ok(checkImage({ ...ill, promptSha256: 'xyz' }).findings.some((x) => x.code === 'illustration_registry_incomplete'));
});

test('bloco "Fontes:" não aceita texto livre: número/citação anexados depois dele não escapam do gate', () => {
  const d = mk();
  d.body = `${d.body}\nA alta foi de 87% no trimestre.`;
  const codes = runDeterministicChecks(d, [ev]).findings.map((x) => x.code);
  assert.ok(codes.includes('tampered_attribution'), codes.join(','));
  const two = mk(); two.body = `${two.body}\n\nFontes:\n- Falsa: https://x.example/y (acessado em 2026-11-23)`;
  assert.ok(runDeterministicChecks(two, [ev]).findings.some((x) => x.code === 'attribution_block'));
  const none = mk(); none.body = none.body.split('\n\nFontes:\n')[0]!;
  assert.ok(runDeterministicChecks(none, [ev]).findings.some((x) => x.code === 'attribution_block'));
});
