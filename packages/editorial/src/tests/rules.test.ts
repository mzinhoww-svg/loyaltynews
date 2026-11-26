import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Collector } from '../collector/collector';
import { MOCK_SOURCE, mockResolver, mockWeb, COLLECT_ON } from '../../fixtures/mock-web.mock';
import { goodDraftOutput, MOCK_EVIDENCE_QUOTE } from '../../fixtures/mock-gateway.mock';
import {
  buildAttribution, checkBodyGrounding, checkClaims, checkImage, checkNoFabricatedReporting, checkOriginality, checkSignature,
  decideImage, numbersMatch, parseNumbersIn, runDeterministicChecks,
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

function numEv(text: string): Evidence {
  return {
    id: 'ev-num', sourceId: 'ri-mock', url: 'https://ri.mock.example/resultado', canonicalUrl: 'https://ri.mock.example/resultado',
    fetchedAt: '2026-11-25T09:00:00.000Z', contentSha256: 'sha-mock', title: 'Resultado do período', text,
    publishedAt: '2026-11-24T00:00:00.000Z', suspicious: false, suspiciousReasons: [],
  };
}

test('número: multiplicador textual e separador de milhar não geram falso positivo (caso real do piloto)', () => {
  const e = numEv('A companhia reportou $4,000 de receita, $14,000 de custos e EUR 60,000 de investimento.');
  const d = mk({ body: 'A receita somou US$ 4 mil, os custos 14 mil e o investimento EUR 60 mil.', evidenceIds: [e.id] });
  assert.deepEqual(checkBodyGrounding(d, [e]).findings, []);
  d.claims = [{ id: 'n', kind: 'number', text: 'US$ 4 mil de receita', evidenceIds: [e.id] }];
  assert.deepEqual(checkClaims(d, [e]).findings.filter((x) => x.code === 'unsupported_metric'), []);
});

test('número: arredondamento correto passa; valor inventado continua barrado', () => {
  const e = numEv('O tíquete médio ficou em US$ 4,240 por associado.');
  const ok = mk({ body: 'O tíquete médio foi de US$ 4 mil por associado.', evidenceIds: [e.id] });
  assert.deepEqual(checkBodyGrounding(ok, [e]).findings, []);
  const ruim = mk({ body: 'O tíquete médio foi de US$ 7 mil por associado.', evidenceIds: [e.id] });
  assert.ok(checkBodyGrounding(ruim, [e]).findings.some((x) => x.code === 'unsupported_metric' && x.message.includes('7 mil')));
});

test('número: moeda dos dois lados precisa bater; sem moeda de um lado compara só o valor', () => {
  const e = numEv('O fundo destinou US$ 60,000 ao programa.');
  const outraMoeda = mk({ body: 'O fundo destinou EUR 60 mil ao programa.', evidenceIds: [e.id] });
  assert.ok(checkBodyGrounding(outraMoeda, [e]).findings.some((x) => x.code === 'unsupported_metric'));
  const semMoeda = mk({ body: 'O fundo destinou 60 mil ao programa.', evidenceIds: [e.id] });
  assert.deepEqual(checkBodyGrounding(semMoeda, [e]).findings, []);
});

test('número: separadores pt-BR e en-US e K/M/B são equivalentes', () => {
  const e = numEv('Receita de R$ 1.234,56, base de 4,000 clientes e projeção de 4 milhões.');
  const d = mk({ body: 'Receita de R$ 1,234.56, base de 4K clientes e projeção de 4M.', evidenceIds: [e.id] });
  assert.deepEqual(checkBodyGrounding(d, [e]).findings, []);
});

test('parseNumbersIn: valor, moeda e arredondamento', () => {
  const [a] = parseNumbersIn('US$ 4 mil');
  assert.deepEqual([a?.value, a?.currency, a?.rounded], [4000, 'USD', true]);
  const [b] = parseNumbersIn('EUR 60,000');
  assert.deepEqual([b?.value, b?.currency, b?.rounded], [60000, 'EUR', false]);
  const [c] = parseNumbersIn('R$ 1.234,56');
  assert.deepEqual([c?.value, c?.currency], [1234.56, 'BRL']);
  const [d] = parseNumbersIn('4M');
  assert.deepEqual([d?.value, d?.rounded], [4_000_000, true]);
  assert.equal(numbersMatch(parseNumbersIn('US$ 4 mil')[0]!, parseNumbersIn('US$ 4,240')[0]!), true);
});

test('claim de data: 6 de outubro de 2026 contra October 06, 2026 (zero à esquerda)', () => {
  const e = numEv('October 06, 2026');
  assert.equal(numbersMatch(parseNumbersIn('6')[0]!, parseNumbersIn('06')[0]!), true, '6 e 06 têm o mesmo valor');
  const d = mk({ body: 'O anúncio é de 6 de outubro de 2026.', evidenceIds: [e.id] });
  d.claims = [{ id: 'c2', kind: 'date', text: 'O anúncio é de 6 de outubro de 2026', evidenceIds: [e.id] }];
  assert.deepEqual(checkClaims(d, [e]).findings.filter((x) => x.code === 'unsupported_metric'), []);
  assert.deepEqual(checkBodyGrounding(d, [e]).findings.filter((x) => x.code === 'unsupported_metric'), []);
});

test('claim de data: número que não existe (7 contra 06) continua barrando', () => {
  const e = numEv('October 06, 2026');
  const d = mk({ body: 'O anúncio é de 7 de outubro de 2026.', evidenceIds: [e.id] });
  const f = checkBodyGrounding(d, [e]).findings.filter((x) => x.code === 'unsupported_metric');
  assert.ok(f.some((x) => x.message.includes('"7"')), JSON.stringify(f));
});

// Tabela do parecer do QA 11 (ft-editorial-busca-4shas-qa11.md), um caso por linha.
// "bloqueia" é o resultado exigido pela regra de arredondamento correto (inclusive nas linhas que passavam por tolerância).
interface CasoMatcher { caso: string; ev: string; texto: string; esperado: 'passa' | 'bloqueia'; via?: 'claim' }
const CASOS_MATCHER: CasoMatcher[] = [
  { caso: 'piloto: 4 mil, 14 mil e EUR 60 mil', ev: 'A companhia reportou $4,000 de receita, $14,000 de custos e EUR 60,000 de investimento.', texto: 'A receita somou US$ 4 mil, os custos 14 mil e o investimento EUR 60 mil.', esperado: 'passa' },
  { caso: 'arredondamento: 4 mil para 4.240', ev: 'O tíquete médio ficou em US$ 4,240 por associado.', texto: 'O tíquete médio foi de US$ 4 mil por associado.', esperado: 'passa' },
  { caso: 'inventado sem par: 7 mil para 4.240', ev: 'O tíquete médio ficou em US$ 4,240 por associado.', texto: 'O tíquete médio foi de US$ 7 mil por associado.', esperado: 'bloqueia' },
  { caso: 'moeda divergente: EUR contra US$', ev: 'O fundo destinou US$ 60,000 ao programa.', texto: 'O fundo destinou EUR 60 mil ao programa.', esperado: 'bloqueia' },
  { caso: 'moeda ausente de um lado: 60 mil contra US$ 60.000', ev: 'O fundo destinou US$ 60,000 ao programa.', texto: 'O fundo destinou 60 mil ao programa.', esperado: 'passa' },
  { caso: 'moeda inventada no texto: US$ 60 mil contra 60.000 sem moeda', ev: 'O fundo destinou 60,000 ao programa.', texto: 'O fundo destinou US$ 60 mil ao programa.', esperado: 'passa' },
  { caso: 'separadores pt/en: R$ 1.234,56 contra R$ 1,234.56', ev: 'Receita de R$ 1.234,56.', texto: 'Receita de R$ 1,234.56.', esperado: 'passa' },
  { caso: 'tolerância: 11 mil para 10.000', ev: 'A base tem US$ 10,000.', texto: 'A base tem US$ 11 mil.', esperado: 'bloqueia' },
  { caso: 'tolerância: 4,4 mil para 4.000', ev: 'A base tem US$ 4,000.', texto: 'A base tem US$ 4,4 mil.', esperado: 'bloqueia' },
  { caso: 'tolerância: 3,6 mil para 4.000', ev: 'A base tem US$ 4,000.', texto: 'A base tem US$ 3,6 mil.', esperado: 'bloqueia' },
  { caso: 'tolerância: 3,5 mil para 4.000', ev: 'A base tem US$ 4,000.', texto: 'A base tem US$ 3,5 mil.', esperado: 'bloqueia' },
  { caso: 'tolerância: 900 para "cerca de 1 mil"', ev: 'O total foi de cerca de 1 mil associados.', texto: 'O total foi de 900 associados.', esperado: 'bloqueia' },
  { caso: 'limitação de contexto: 7 mil pontos para 7.000 lojas', ev: 'A rede tem 7.000 lojas.', texto: 'O programa distribuiu 7 mil pontos.', esperado: 'passa' },
  { caso: 'limitação de contexto: 7,3 mil pontos para 7.000 lojas', ev: 'A rede tem 7.000 lojas.', texto: 'O programa distribuiu 7,3 mil pontos.', esperado: 'bloqueia' },
  { caso: 'limitação de contexto no claim: 7 mil pontos para 7.000 lojas', ev: 'A rede tem 7.000 lojas.', texto: '7 mil pontos distribuídos', esperado: 'passa', via: 'claim' },
  { caso: 'borda: 1 mil para 900 (arredondamento correto para cima)', ev: 'O total foi de 900 associados.', texto: 'O total foi de 1 mil associados.', esperado: 'passa' },
  { caso: 'moeda: BRL contra R$', ev: 'O valor foi R$ 60,000.', texto: 'O valor foi BRL 60 mil.', esperado: 'passa' },
  { caso: 'moeda: USD contra US$', ev: 'O valor foi US$ 60,000.', texto: 'O valor foi USD 60 mil.', esperado: 'passa' },
  { caso: 'moeda: GBP contra EUR', ev: 'O valor foi EUR 60,000.', texto: 'O valor foi GBP 60 mil.', esperado: 'bloqueia' },
  { caso: 'moeda: euros contra US$', ev: 'O valor foi US$ 60,000.', texto: 'O valor foi 60 mil euros.', esperado: 'bloqueia' },
  { caso: 'moeda: US$ contra euros', ev: 'O valor foi 60 mil euros.', texto: 'O valor foi US$ 60 mil.', esperado: 'bloqueia' },
  { caso: 'moeda: euro singular contra US$', ev: 'O valor foi US$ 60,000.', texto: 'O valor foi 60 mil euro.', esperado: 'bloqueia' },
  { caso: 'moeda: EUR contra euros', ev: 'O valor foi 60 mil euros.', texto: 'O valor foi EUR 60 mil.', esperado: 'passa' },
  { caso: 'moeda: reais contra US$', ev: 'O valor foi US$ 60,000.', texto: 'O valor foi 60 mil reais.', esperado: 'bloqueia' },
  { caso: 'moeda: dólares contra US$', ev: 'O valor foi US$ 60,000.', texto: 'O valor foi 60 mil dólares.', esperado: 'passa' },
  { caso: 'moeda: libras contra GBP', ev: 'O valor foi GBP 60,000.', texto: 'O valor foi 60 mil libras.', esperado: 'passa' },
  { caso: 'moeda: ienes contra US$', ev: 'O valor foi US$ 60,000.', texto: 'O valor foi 60 mil ienes.', esperado: 'bloqueia' },
  { caso: 'moeda: dólares contra EUR', ev: 'O valor foi EUR 60,000.', texto: 'O valor foi 60 mil dólares.', esperado: 'bloqueia' },
  { caso: 'moeda: libras contra US$', ev: 'O valor foi US$ 60,000.', texto: 'O valor foi 60 mil libras.', esperado: 'bloqueia' },
  { caso: 'moeda: reais contra R$', ev: 'O valor foi R$ 60,000.', texto: 'O valor foi 60 mil reais.', esperado: 'passa' },
  { caso: 'moeda: ienes contra JPY', ev: 'O valor foi JPY 60,000.', texto: 'O valor foi 60 mil ienes.', esperado: 'passa' },
];
test.each(CASOS_MATCHER)('matcher QA 11 — $caso → $esperado', ({ ev, texto, esperado, via }) => {
  const e = numEv(ev);
  const d = mk({ body: texto, evidenceIds: [e.id] });
  let achados: string[];
  if (via === 'claim') {
    d.claims = [{ id: 'n', kind: 'number', text: texto, evidenceIds: [e.id] }];
    achados = checkClaims(d, [e]).findings.filter((x) => x.code === 'unsupported_metric').map((x) => x.message);
  } else {
    achados = checkBodyGrounding(d, [e]).findings.filter((x) => x.code === 'unsupported_metric').map((x) => x.message);
  }
  if (esperado === 'passa') assert.deepEqual(achados, []);
  else assert.ok(achados.length > 0, `esperava bloqueio para "${texto}"`);
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
