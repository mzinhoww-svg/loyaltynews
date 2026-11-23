import { test } from 'vitest';
import assert from 'node:assert/strict';
import { checkTone, runDeterministicChecks } from '../rules/rules';
import { TITLE_MAX, TITLE_TARGET } from '../rules/tone';
import { buildMessages, FACTORY_PROMPT_VERSION, TOM_DE_VOZ, TOM_DE_VOZ_VERSION } from '../factory/prompts';
import { draft as draftStage, InMemoryAuditLog } from '../pipeline/stages';
import { SourceRegistry } from '../sources/registry';
import { Collector } from '../collector/collector';
import { COLLECT_ON, MOCK_SOURCE, mockResolver, mockWeb } from '../../fixtures/mock-web.mock';
import { MockGateway, goodDraftOutput } from '../../fixtures/mock-gateway.mock';
import { InMemoryEditorialStore } from '../api/store';
import { getArticleReview } from '../api/handlers';
import { sampleArticle } from '../api/store-contract';
import type { GatewayRequest, GatewayResponse } from '../gateway';
import type { Draft } from '../types';
import type { ArticleJob } from '../pipeline/jobs';

// Tom lint (guia de tom de voz v0.2): BLOQUEIA o objetivo, AVISA o contextual; prompt editorial-0.3.

const base = { headline: 'Programa Alfa oferece bônus de 100% em transferências de pontos', resumo: 'Bônus de 100% em transferências de pontos, válido até 15 de dezembro de 2026.', body: 'O Programa Alfa anunciou em 23 de novembro de 2026 um bônus de 100% nas transferências, segundo o comunicado da empresa.' };
const codes = (r: { blocking: Array<{ code: string }>; warnings: Array<{ code: string }> }) => ({ b: r.blocking.map((x) => x.code), w: r.warnings.map((x) => x.code) });

test('texto limpo: nenhum bloqueio e nenhum aviso; título entre 71 e 90 só gera o aviso de meta', () => {
  assert.deepEqual(codes(checkTone(base)), { b: [], w: [] });
  assert.ok(base.headline.length <= TITLE_TARGET);
  const mid = 'Programa Alfa oferece bônus de 100% em transferências de pontos de cartões parceiros'; // 84
  assert.ok(mid.length > TITLE_TARGET && mid.length <= TITLE_MAX);
  assert.deepEqual(codes(checkTone({ ...base, headline: mid })), { b: [], w: ['tone_title_target'] });
});

test('BLOQUEIA: emoji, "!" no título, título > 90, título começando por veja/saiba/confira e a frase em inglês do rodapé', () => {
  assert.deepEqual(codes(checkTone({ ...base, body: `${base.body} 🚀` })).b, ['tone_emoji']);
  assert.deepEqual(codes(checkTone({ ...base, headline: 'Programa Alfa 🔥 bônus' })).b, ['tone_emoji']);
  assert.deepEqual(codes(checkTone({ ...base, headline: 'Programa Alfa oferece bônus!' })).b, ['tone_title_exclamation']);
  assert.deepEqual(codes(checkTone({ ...base, body: `${base.body} Atenção!` })).b, [], '"!" no corpo não bloqueia (só no título)');
  const long = ('Programa Alfa anuncia bônus de transferência ' + 'a'.repeat(100)).slice(0, 91);
  assert.equal([...long].length, 91);
  assert.deepEqual(codes(checkTone({ ...base, headline: long })).b, ['tone_title_length']);
  assert.deepEqual(codes(checkTone({ ...base, headline: 'x'.repeat(90) })).b, [], '90 caracteres ainda passa');
  for (const h of ['Veja como funciona o bônus do Programa Alfa', 'Saiba o que muda no acúmulo', 'confira as regras do bônus', '"Confira" o bônus do Programa Alfa']) assert.deepEqual(codes(checkTone({ ...base, headline: h })).b, ['tone_title_clickbait'], h);
  assert.deepEqual(codes(checkTone({ ...base, body: `${base.body} The Global Network for Board-Level Loyalty Leaders.` })).b, ['tone_brand_footer_phrase']);
  // símbolos de marca registrada não são emoji
  assert.deepEqual(codes(checkTone({ ...base, body: `${base.body} Programa Alfa™ e Gama® © 2026.` })).b, []);
});

test('AVISA (sem bloquear): palavras proibidas, data relativa sem data absoluta, "você" em notícia, título acima da meta de 70', () => {
  const r = checkTone({ ...base, body: 'Uma oferta imperdível. Corra e aproveite hoje o bônus do programa, que é incrível.' });
  assert.deepEqual(r.blocking, []);
  const words = r.warnings.filter((w) => w.code === 'tone_forbidden_word').map((w) => /"([^"]+)"/.exec(w.message)![1]!.toLowerCase());
  assert.deepEqual([...new Set(words)].sort(), ['aproveite', 'corra', 'imperdível', 'incrível']);
  assert.ok(r.warnings.some((w) => w.code === 'tone_relative_date'));
  assert.ok(checkTone({ ...base, body: 'O bônus vale até hoje, segundo a empresa.' }).warnings.some((w) => w.code === 'tone_relative_date'));
  assert.ok(!checkTone({ ...base, body: 'O bônus vale até hoje (23 de novembro de 2026), segundo a empresa.' }).warnings.some((w) => w.code === 'tone_relative_date'), 'data absoluta no parágrafo');
  assert.ok(!checkTone({ ...base, body: 'O bônus vale até 15/12, segundo a empresa. Anunciado hoje.' }).warnings.some((w) => w.code === 'tone_relative_date'));
  assert.deepEqual(codes(checkTone({ ...base, body: 'Você pode transferir pontos até 15 de dezembro de 2026.' })).w, ['tone_voce_in_news']);
  assert.deepEqual(codes(checkTone({ ...base, headline: 'x'.repeat(80) })).w, ['tone_title_target']);
  assert.deepEqual(codes(checkTone({ ...base, headline: 'Entenda como Veja funciona o bônus' })).w, ['tone_title_clickbait_inside']);
});

test('exceções: citação literal e nome próprio de produto não geram aviso; "você" é permitido em explicador', () => {
  assert.deepEqual(checkTone({ ...base, body: 'A empresa afirmou: "uma oferta exclusiva e revolucionária para você", segundo o comunicado de 23 de novembro de 2026.' }).warnings, []);
  assert.deepEqual(checkTone({ ...base, body: 'O Clube Exclusivo Gold passa a pontuar 2 pontos por real a partir de 1º de dezembro de 2026.' }).warnings, [], 'nome próprio de produto');
  assert.deepEqual(codes(checkTone({ ...base, body: 'O programa chama a oferta de exclusiva.' })).w, ['tone_forbidden_word']);
  const expl = { ...base, body: 'Para saber se você pode transferir, veja o regulamento de 15 de dezembro de 2026.', autoral: { formato: 'explicador' as const, pautaId: 'p' } };
  assert.ok(!checkTone(expl).warnings.some((w) => w.code === 'tone_voce_in_news'));
  assert.ok(checkTone({ ...expl, autoral: { formato: 'comparativo' as const, pautaId: 'p' } }).warnings.some((w) => w.code === 'tone_voce_in_news'));
  // o bloco "Fontes:" gerado pelo sistema não é conferido
  assert.deepEqual(checkTone({ ...base, body: `${base.body}\n\nFontes:\n- Site hoje: https://x.example/a (acessado em 2026-11-23)` }).warnings, []);
});

const draftOf = (over: Partial<Draft> = {}): Draft => ({
  id: 'd', editoria: 'pontos', headline: base.headline, body: base.body, slug: 's', resumo: base.resumo, tipoConteudo: 'noticia', classeDeDado: 'public', patrocinado: false,
  claims: [], evidenceIds: [], signature: 'Redação Loyalty News', image: { mode: 'none', reason: 'x' }, modelProvider: 'p', promptVersion: 'v', ...over,
} as Draft);

test('integração: o bloqueio entra no gate do rascunho; o tom lint pode ser desligado só na correção de matéria já publicada', () => {
  const bad = draftOf({ headline: 'Veja o bônus!' });
  const on = runDeterministicChecks(bad, []).findings.map((f) => f.code);
  assert.ok(on.includes('tone_title_exclamation') && on.includes('tone_title_clickbait'));
  const off = runDeterministicChecks(bad, [], { tone: false }).findings.map((f) => f.code);
  assert.ok(!off.some((c) => c.startsWith('tone_')));
});

test('estágio de redação: título com "!" volta ao modelo como achado (nova tentativa) e a versão corrigida segue; 3 tentativas ruins bloqueiam', async () => {
  const ev = (await new Collector(mockWeb(), { now: () => new Date('2026-11-23T12:00:00Z'), resolver: mockResolver(), flags: COLLECT_ON, minSpacingMs: 0 }).collectUrl(MOCK_SOURCE, 'https://ri.mock.example/noticias/alfa-parceria')).evidence!;
  const resp = (output: unknown): GatewayResponse => ({ ok: true, provider: 'deepseek', model: 'm', output, usage: { inputTokens: 0, outputTokens: 0, costMicrosUsd: 0 } });
  const deps = (gw: MockGateway) => ({ gateway: gw, registry: new SourceRegistry([MOCK_SOURCE]), audit: new InMemoryAuditLog(), flags: { editorialPipeline: true }, now: () => new Date('2026-11-23T12:00:00Z') });
  const job: ArticleJob = { articleId: 'a1', editoria: 'pontos', evidences: [ev], attempt: 0 };
  const seen: GatewayRequest[] = [];
  const fix = new MockGateway(ev.id, { draft: (r) => { seen.push(r); return resp(goodDraftOutput(ev.id, r.input && (r.input as { feedback?: unknown[] }).feedback?.length ? {} : { headline: 'Programa Alfa fecha acordo com a Varejista Beta!' })); } });
  const o1 = await draftStage(deps(fix), job);
  assert.equal(o1.kind, 'next'); if (o1.kind === 'next') { assert.equal(o1.next.stage, 'draft'); assert.ok(o1.next.data.feedback!.some((f) => f.code === 'tone_title_exclamation')); }
  const o2 = await draftStage(deps(fix), o1.kind === 'next' ? o1.next.data : job);
  assert.equal(o2.kind, 'next'); if (o2.kind === 'next') assert.equal(o2.next.stage, 'factcheck');
  const always = new MockGateway(ev.id, { draft: () => resp(goodDraftOutput(ev.id, { headline: '🔥 Programa Alfa fecha acordo com a Varejista Beta' })) });
  let cur = job; let last;
  for (let i = 0; i < 3; i++) { last = await draftStage(deps(always), cur); if (last.kind === 'next') cur = last.next.data; }
  assert.equal(last!.kind, 'blocked');
  if (last!.kind === 'blocked') assert.ok(last!.blocked.findings.some((f) => f.code === 'tone_emoji'));
});

test('prompt editorial-0.3 / tom-0.2: regras do guia na redação, revisão e pacote social; fora da checagem e da triagem', () => {
  assert.equal(FACTORY_PROMPT_VERSION, 'editorial-0.3'); assert.equal(TOM_DE_VOZ_VERSION, 'tom-0.2');
  const sys = (t: Parameters<typeof buildMessages>[0]['taskClass']) => buildMessages({ taskClass: t, input: {} })[0]!.content;
  for (const t of ['draft', 'review', 'social_pack'] as const) assert.ok(sys(t).includes(TOM_DE_VOZ), t);
  for (const t of ['factcheck', 'triage', 'context', 'roles'] as const) assert.ok(!sys(t).includes(TOM_DE_VOZ), t);
  for (const re of [/70 caracteres e NUNCA mais de 90/, /nunca começa com "Veja", "Saiba" ou "Confira"/, /sem ponto de exclamação/, /NUNCA use emoji/, /"exclusivo" \(só em citação literal ou nome próprio de produto\)/, /não use "você"/, /Datas absolutas/, /The global network for board-level loyalty leaders/])
    assert.match(TOM_DE_VOZ, re);
  assert.ok(TOM_DE_VOZ.split('\n').length <= 20);
});

test('revisor vê os avisos de tom (recalculados do rascunho) em getArticleReview; avisos não derrubam o gate', async () => {
  const store = new InMemoryEditorialStore();
  const art = sampleArticle('t1', { status: 'em_checagem' });
  art.draft = { ...art.draft!, body: `Você, aproveite hoje o bônus.\n\n${art.draft!.body}` } as Draft;
  await store.putArticle(art);
  const ctx = { actor: { userId: 'r', roles: ['revisor'], mfa: true }, store, now: () => new Date('2026-11-25T12:00:00Z'), newId: () => 'i' };
  const r = await getArticleReview(ctx, { articleId: 't1' });
  assert.equal(r.status, 200);
  const view = r.body as { avisosDeTom: Array<{ code: string }>; gate: { achados: Array<{ code: string }> } };
  assert.ok(view.avisosDeTom.some((w) => w.code === 'tone_voce_in_news') && view.avisosDeTom.some((w) => w.code === 'tone_forbidden_word'));
  assert.ok(!view.gate.achados.some((a) => a.code.startsWith('tone_')), 'aviso não vira achado bloqueante');
});
