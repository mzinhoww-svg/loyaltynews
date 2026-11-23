import { loadPolicyFile, type ModelPolicy } from '@ln/modelops';
import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { emptyOutputFor } from './output';
import { POLICY_FIXTURE } from './paths';
import {
  authorOf, buildQualificationPlan, criteriaFor, requiredCriteriaFor, decide, evalCacheHit, evalCost, evalDistinctAuthor, evalSchema, evalSeededErrors, evalZdr,
  QUAL_BUDGET_PROPOSAL, QUAL_CASES, QUAL_CRITERIA, QUAL_STAGES, type UsageInfo,
} from './qualification';

const policy = loadPolicyFile(POLICY_FIXTURE).policy as ModelPolicy;
const reg = loadRegistries();
// TODOS os dados abaixo são SIMULADOS (testes do avaliador); nenhuma chamada real, nenhum resultado de modelo.
const usage = (over: Partial<UsageInfo> = {}): UsageInfo => ({ promptTokens: 6_500, cachedTokens: 6_000, completionTokens: 100, costUsd: 0.001, ...over });

describe('protocolo de qualificação: casos e critérios', () => {
  it('cobre os papéis da proposta do FinOps e só usa modelos com ID e preço na política', () => {
    expect(new Set(QUAL_CASES.map((c) => c.role))).toEqual(
      new Set(['editorial_draft', 'fact_check', 'editorial_review', 'audit', 'ritual_participant_input', 'ritual_chair_synthesis', 'premium_analysis', 'golden_labeling']),
    );
    const ids = new Set(policy.models.filter((m) => m.binding).map((m) => m.id));
    for (const c of QUAL_CASES) for (const m of c.models) expect(ids.has(m), `${c.id}/${m}`).toBe(true);
  });

  it('nunca inclui Fable (sem ZDR listado), DeepSeek, imagens nem Sonnet no gate do rascunho Anthropic', () => {
    const all = QUAL_CASES.flatMap((c) => c.models);
    expect(all).not.toContain('claude-fable-5-2');
    expect(all.some((m) => m.includes('deepseek') || m.includes('image'))).toBe(false);
    expect(QUAL_CASES.find((c) => c.id === 'Q-REVIEW')!.models).not.toContain('claude-sonnet-5-5');
    // a checagem de fatos usa só autor distinto do redator (Anthropic): OpenAI
    expect(QUAL_CASES.find((c) => c.id === 'Q-FACT')!.models.every((m) => m.startsWith('openai'))).toBe(true);
  });

  it('toda entrada é pública/sintética e todo caso aponta critérios existentes', () => {
    const known = new Set(QUAL_CRITERIA.map((c) => c.id));
    for (const c of QUAL_CASES) {
      expect(c.dataClass, c.id).toBe('public');
      expect(c.input.length, c.id).toBeGreaterThan(20);
      for (const k of c.checks) expect(known.has(k), `${c.id}: ${k}`).toBe(true);
    }
    expect(new Set(QUAL_CRITERIA.map((c) => c.id)).size).toBe(QUAL_CRITERIA.length);
  });

  it('o cache é testado em todos os modelos candidatos (cached_tokens > 0 na 2ª chamada de cada par)', () => {
    const cache = QUAL_CASES.find((c) => c.id === 'Q-CACHE')!;
    expect(new Set(cache.models)).toEqual(new Set(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'openai-text-review', 'openai-text-review-alt']));
    expect(cache.callsPerRun).toBe(2);
    for (const m of cache.models) expect(criteriaFor(m)).toContain('QC-CACHE-HIT');
    expect(QUAL_CRITERIA.find((c) => c.id === 'QC-CACHE-HIT')!.measure).toMatch(/cached_tokens > 0/);
  });
});

describe('orçamento da qualificação em etapas (PM 23/11, DP-26, ADR-021)', () => {
  const plan = buildQualificationPlan(policy);
  const modelsOf = (stage: 1 | 2 | 3) => [...new Set(plan.costs.filter((c) => c.stage === stage).map((c) => c.model))].sort();

  it('etapa 1 = Haiku, Sonnet e GPT-6.1-terra; etapa 2 = só rotulagem do golden set (terra); Opus e GPT-6.2-sol na etapa 3', () => {
    expect(modelsOf(1)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'openai-text-review']);
    expect(modelsOf(2)).toEqual(['openai-text-review']);
    expect([...new Set(plan.costs.filter((c) => c.stage === 2).map((c) => c.caseId))]).toEqual(['Q-GOLDEN']);
    expect(modelsOf(3)).toEqual(['claude-opus-5-5', 'openai-text-review-alt']);
    expect(QUAL_STAGES[3].inNovember).toBe(false);
    expect(QUAL_STAGES[3].capUsd).toBeNull();
  });

  it('o plano cabe: etapa 1 ≤ US$ 5, etapa 2 ≤ US$ 10, novembro ≤ US$ 15, sem reserva de auditoria; avisos viram decisão pendente', () => {
    expect(plan.checks.filter((c) => !c.ok && c.severity === 'error')).toEqual([]);
    expect(plan.ok).toBe(true);
    expect(plan.stageTotals[1].ceilingWithRetriesMicro).toBeLessThanOrEqual(plan.caps.stage1Micro);
    expect(plan.stageTotals[2].ceilingWithRetriesMicro).toBeLessThanOrEqual(plan.caps.stage2Micro);
    expect(plan.novemberTotals.ceilingWithRetriesMicro).toBeLessThanOrEqual(QUAL_BUDGET_PROPOSAL.novemberCapUsd * 1_000_000);
    expect(plan.novemberTotals.ceilingWithRetriesMicro + QUAL_BUDGET_PROPOSAL.verifierAcceptancesUsd * 1_000_000).toBeLessThanOrEqual(plan.caps.monthlyCapMicro);
    expect(plan.novemberTotals.expectedMicro).toBeLessThan(plan.novemberTotals.ceilingMicro);
    expect(QUAL_BUDGET_PROPOSAL.usesAuditReserve).toBe(false);
    // Opus (escalonamento) só na etapa 3: nenhum custo de Opus nas etapas de novembro
    expect(plan.costs.filter((c) => c.stage !== 3).some((c) => c.model === 'claude-opus-5-5')).toBe(false);
  });

  it('as decisões pendentes aparecem como AVISO: cap do modo (ADR-021, US$ 5) e fonte de verba da rotulagem', () => {
    const warnings = plan.checks.filter((c) => c.severity === 'warning' && !c.ok).map((c) => c.id).sort();
    expect(warnings).toEqual(['adr021_mode_cap', 'golden_label_funding']);
    expect(plan.caps.adr021ModeCapMicro).toBe(5_000_000);
    expect(plan.novemberTotals.ceilingWithRetriesMicro).toBeGreaterThan(plan.caps.adr021ModeCapMicro); // por isso o aviso
  });

  it('conta as chamadas por etapa', () => {
    const calls = (st: number) => QUAL_CASES.reduce((n, c) => n + c.models.filter((m) => c.stages[m] === st).length * c.runsPerModel * c.callsPerRun, 0);
    expect(plan.stageTotals[1].calls).toBe(calls(1));
    expect(plan.stageTotals[2].calls).toBe(calls(2));
    expect(plan.stageTotals[3].calls).toBe(calls(3));
    expect(plan.stageTotals[2].calls).toBe(400);
    // etapa 1: draft 20 + fact 20 + review 10 + audit 6 (terra) + rituais in 12×2 + syn 6×2 + cache 5×2×3
    expect(plan.stageTotals[1].calls).toBe(20 + 20 + 10 + 6 + 24 + 12 + 30);
  });

  it('toda chamada tem etapa e modelo na política; DeepSeek, Fable e imagens nunca entram', () => {
    for (const c of QUAL_CASES) for (const m of c.models) expect(c.stages[m], `${c.id}/${m}`).toBeGreaterThanOrEqual(1);
    expect(QUAL_CASES.flatMap((c) => c.models).some((m) => m.includes('deepseek') || m.includes('fable') || m.includes('image'))).toBe(false);
  });

  it('falha fechada: sem preço, estouro da etapa 1 e estouro do total de novembro reprovam', () => {
    const noPrice = structuredClone(policy);
    delete (noPrice.models.find((m) => m.id === 'openai-text-review') as { binding?: unknown }).binding;
    expect(buildQualificationPlan(noPrice).checks.find((c) => c.id === 'no_unknown_cost')!.ok).toBe(false);

    const heavy = QUAL_CASES.map((c) => ({ ...c, runsPerModel: c.runsPerModel * 40 }));
    const p = buildQualificationPlan(policy, heavy);
    expect(p.ok).toBe(false);
    expect(p.checks.find((c) => c.id === 'stage1_cap')!.ok).toBe(false);
    expect(p.checks.find((c) => c.id === 'november_cap')!.ok).toBe(false);

    // etapa 1 e 2 não podem usar Opus nem GPT-6.2-sol
    const leaky = QUAL_CASES.map((c) => (c.id === 'Q-PREMIUM' ? { ...c, stages: { 'claude-opus-5-5': 1 as const } } : c));
    expect(buildQualificationPlan(policy, leaky).checks.find((c) => c.id === 'stages_1_2_exclude_deferred_models')!.ok).toBe(false);
  });
});

describe('avaliadores (dados SIMULADOS)', () => {
  it('cache: 2ª chamada precisa de cached_tokens > 0 em todos os pares; menos de 5 pares é inconclusivo', () => {
    const ok = Array.from({ length: 5 }, () => ({ first: usage({ cachedTokens: 0 }), second: usage() }));
    expect(evalCacheHit(ok).status).toBe('pass');
    expect(evalCacheHit(ok.slice(0, 3)).status).toBe('inconclusive');
    const bad = [...ok.slice(0, 4), { first: usage({ cachedTokens: 0 }), second: usage({ cachedTokens: 0 }) }];
    expect(evalCacheHit(bad)).toMatchObject({ status: 'fail' });
    expect(evalCacheHit(bad).detail).toMatch(/cache_failure/);
  });

  it('custo: dentro do desvio passa; acima da reserva ou sem custo informado reprova', () => {
    const call = (cost: number | null, expected = 1000, reserved = 5000) => ({ usage: usage({ costUsd: cost }), expectedMicro: expected, reservedMicro: reserved });
    expect(evalCost([call(0.001), call(0.00105)]).status).toBe('pass');
    expect(evalCost([call(0.002)]).status).toBe('fail'); // 100% de desvio
    expect(evalCost([call(0.006)]).detail).toMatch(/acima da reserva/);
    expect(evalCost([call(null)]).detail).toMatch(/custo desconhecido/);
    expect(evalCost([]).status).toBe('inconclusive');
  });

  it('autor distinto = prefixo do modelo que gerou, não o provedor de hospedagem', () => {
    expect(authorOf('anthropic/claude-haiku-5.5')).toBe('anthropic');
    const ok = [{ draftGenerationModel: 'anthropic/claude-haiku-5.5', checkGenerationModel: 'openai/gpt-6.1-terra' }];
    expect(evalDistinctAuthor(ok).status).toBe('pass');
    const same = [...ok, { draftGenerationModel: 'anthropic/claude-haiku-5.5', checkGenerationModel: 'anthropic/claude-sonnet-5.5' }];
    expect(evalDistinctAuthor(same).status).toBe('fail');
    expect(evalDistinctAuthor([{ draftGenerationModel: '', checkGenerationModel: 'openai/x' }]).status).toBe('fail'); // autor desconhecido bloqueia
    expect(evalDistinctAuthor([], 'QC-DISTINCT-AUTHOR-GATE').status).toBe('inconclusive');
  });

  it('ZDR: precisa ter pedido zdr E o provedor que atendeu estar na lista do modelo', () => {
    const list = new Map([['anthropic/claude-haiku-5.5', new Set(['Google', 'Amazon Bedrock'])]]);
    expect(evalZdr([{ openrouterModel: 'anthropic/claude-haiku-5.5', providerName: 'Google', zdrRequested: true }], list).status).toBe('pass');
    expect(evalZdr([{ openrouterModel: 'anthropic/claude-haiku-5.5', providerName: 'Anthropic', zdrRequested: true }], list).status).toBe('fail');
    expect(evalZdr([{ openrouterModel: 'anthropic/claude-haiku-5.5', providerName: 'Google', zdrRequested: false }], list).status).toBe('fail');
    expect(evalZdr([{ openrouterModel: 'anthropic/claude-fable-5.2', providerName: 'X', zdrRequested: true }], list).status).toBe('fail'); // Fable: sem ZDR listado
  });

  it('esquema: usa o contrato do perfil', () => {
    const profile = reg.agents.find((a) => a.id === 'writer_mercado')!;
    const good = emptyOutputFor(profile);
    expect(evalSchema([good, good, good, good, good, good, good, good, good, good, good, good, good, good, good, good, good, good, good, { x: 1 }], profile).status).toBe('pass'); // 19/20 = 95%
    expect(evalSchema([good, { x: 1 }], profile).status).toBe('fail');
    expect(evalSchema([], profile).status).toBe('inconclusive');
  });

  it('erros plantados: recall mínimo, nenhum crítico perdido, falso positivo em rascunho limpo', () => {
    const items = [
      { seeded: ['e1', 'e2'], flagged: ['e1', 'e2'], critical: ['e1'] },
      { seeded: ['e3', 'e4'], flagged: ['e3'], critical: [] },
      { seeded: [], flagged: [] },
      { seeded: [], flagged: ['x'] },
    ];
    const [recall, fp] = evalSeededErrors(items);
    expect(recall).toMatchObject({ criterion: 'QC-SEEDED-RECALL', status: 'fail' }); // 3/4 = 75%
    expect(fp).toMatchObject({ criterion: 'QC-FALSE-POSITIVE', status: 'fail' }); // 1/2 = 50%
    const [r2, f2] = evalSeededErrors([{ seeded: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], flagged: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], critical: ['j'] }, { seeded: [], flagged: [] }]);
    expect(r2!.status).toBe('fail'); // 90% mas perdeu o crítico
    expect(f2!.status).toBe('pass');
    expect(evalSeededErrors([])[0]!.status).toBe('inconclusive');
  });

  it('decisão: só qualifica com todos os critérios do modelo passando; falta de evidência impede', () => {
    const required = requiredCriteriaFor('openai-text-review');
    expect(required).toEqual(expect.arrayContaining(['QC-SCHEMA', 'QC-DISTINCT-AUTHOR', 'QC-SEEDED-RECALL', 'QC-CACHE-HIT']));
    expect(required).not.toContain('QC-ZDR'); // informativo depois da DP-27
    expect(criteriaFor('openai-text-review')).toContain('QC-ZDR');
    const allPass = required.map((c) => ({ criterion: c, status: 'pass' as const, detail: 'simulado' }));
    expect(decide('openai-text-review', allPass).qualified).toBe(true);
    expect(decide('openai-text-review', allPass.slice(1)).missing).toEqual([required[0]]);
    expect(decide('openai-text-review', allPass.map((v, i) => (i === 0 ? { ...v, status: 'fail' as const } : v))).failed).toEqual([required[0]]);
    expect(decide('openai-text-review', allPass.map((v, i) => (i === 1 ? { ...v, status: 'inconclusive' as const } : v))).qualified).toBe(false);
    expect(decide('openai-text-review', []).qualified).toBe(false);
  });
});
