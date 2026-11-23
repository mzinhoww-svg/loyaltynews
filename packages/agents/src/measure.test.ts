import { loadPolicyFile, SimulatedOpenRouterClient, type ModelPolicy } from '@ln/modelops';
import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { buildCallPrompt, calibrateAssumptions, estimateTokens, percentile, sampleFromResponse, stat, UsageRecorder, type UsageSample } from './measure';
import { POLICY_FIXTURE } from './paths';
import { buildRoutingPlan, DEFAULT_ASSUMPTIONS } from './routing-plan';

const reg = loadRegistries();
const policy = loadPolicyFile(POLICY_FIXTURE).policy as ModelPolicy;

let n = 0;
const sample = (over: Partial<UsageSample> = {}): UsageSample => ({
  meeting_id: 'D-mercado', role: 'participant_input', route: 'economy', model: 'anthropic/claude-haiku-5.5', generationId: `gen-${++n}`,
  promptTokens: 2000, cacheReadTokens: 3000, cacheWriteTokens: 0, completionTokens: 400, maxOutputTokens: 700, costUsd: 0.001, source: 'measured', ...over,
});

describe('estimativa de prompt por caracteres (linha de base, não medição)', () => {
  it('3,6 caracteres por token, arredondado para cima', () => {
    expect(estimateTokens('x'.repeat(360))).toBe(100);
    expect(estimateTokens('x'.repeat(361))).toBe(101);
    expect(estimateTokens('')).toBe(0);
  });

  it('monta o prompt de um perfil real e separa parte estável (cache) da variável', () => {
    const profile = reg.agents.find((a) => a.id === 'editor_mercado')!;
    const meeting = reg.meetings.find((m) => m.id === 'D-mercado')!;
    const e = buildCallPrompt({ profile, meeting, role: 'participant_input', sectorMemory: ['glossário: CDB = certificado de depósito bancário'] });
    expect(e.sections.system).toContain('editor_mercado');
    expect(e.sections.system).toContain('"agent_id"');
    expect(e.sections.stableContext).toContain('glossário');
    expect(e.cacheReadTokens).toBeGreaterThan(0);
    expect(e.promptTokens).toBeGreaterThan(0);
    expect(e.estimatedBy).toMatch(/sem tokenizador/);
    // a síntese carrega os insumos na parte variável
    const withInputs = buildCallPrompt({
      profile, meeting, role: 'chair_synthesis',
      participantInputs: [{ agent_id: 'writer_mercado', summary: 'x'.repeat(720), blockers: [], evidence_refs: [], decisions: [] }],
    });
    expect(withInputs.promptTokens).toBeGreaterThan(e.promptTokens - 50);
    expect(withInputs.sections.variableContext).toContain('writer_mercado');
  });
});

describe('amostras de uso do gateway', () => {
  it('converte o usage do OpenRouter: entrada sem cache = prompt_tokens - cached_tokens', () => {
    const s = sampleFromResponse(
      { id: 'gen-real-1', model: 'anthropic/claude-haiku-5.5', usage: { cost: 0.0042, prompt_tokens: 5000, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 3500 } }, generation: { model: 'anthropic/claude-haiku-5.5', provider_name: 'Anthropic', upstream_id: 'up-1' } },
      { meeting_id: 'D-mercado', role: 'participant_input', route: 'economy', maxOutputTokens: 700 },
    )!;
    expect(s).toMatchObject({ promptTokens: 1500, cacheReadTokens: 3500, completionTokens: 300, costUsd: 0.0042, generationId: 'up-1', source: 'measured' });
  });

  it('resposta do cliente SIMULADO nunca vira amostra medida', async () => {
    const resp = await new SimulatedOpenRouterClient().chat({ model: 'anthropic/claude-haiku-5.5', messages: [], max_tokens: 10 } as never);
    const s = sampleFromResponse(resp, { meeting_id: 'D-mercado', role: 'participant_input', route: 'economy', maxOutputTokens: 700 })!;
    expect(s.source).toBe('simulated');
  });

  it('sem usage numérico ou sem evidência de geração, não há amostra (nada é inventado)', () => {
    const ctx = { meeting_id: 'D-mercado', role: 'participant_input' as const, route: 'economy', maxOutputTokens: 700 };
    expect(sampleFromResponse({ id: 'g', usage: {} }, ctx)).toBeNull();
    expect(sampleFromResponse({ usage: { prompt_tokens: 10, completion_tokens: 5 } }, ctx)).toBeNull();
    expect(sampleFromResponse({}, ctx)).toBeNull();
  });

  it('o registro é idempotente por generationId e recusa tokens inválidos', () => {
    const r = new UsageRecorder();
    const s = sample();
    expect(r.record(s)).toBe(true);
    expect(r.record(s)).toBe(false);
    expect(r.samples()).toHaveLength(1);
    expect(() => r.record(sample({ promptTokens: -1 }))).toThrow(/inválida/);
    expect(() => r.record(sample({ completionTokens: Number.NaN }))).toThrow(/inválida/);
    expect(() => r.record(sample({ maxOutputTokens: 0 }))).toThrow(/maxOutputTokens/);
  });
});

describe('estatística e calibração', () => {
  it('percentil e estatística', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(stat([])).toEqual({ n: 0, mean: 0, p50: 0, p95: 0, max: 0 });
  });

  it('sem amostras suficientes mantém as premissas e diz por quê (falha fechada)', () => {
    const r = new UsageRecorder();
    for (let i = 0; i < 29; i++) r.record(sample());
    const c = calibrateAssumptions(r);
    expect(c.calibrated).toBe(false);
    expect(c.assumptions).toEqual(DEFAULT_ASSUMPTIONS);
    expect(c.reasons.join(' ')).toMatch(/29 amostras medidas < mínimo 30/);
  });

  it('amostras simuladas ou estimadas não calibram, mesmo em grande número', () => {
    const r = new UsageRecorder();
    for (let i = 0; i < 100; i++) r.record(sample({ source: i % 2 ? 'simulated' : 'estimated' }));
    const c = calibrateAssumptions(r);
    expect(c.calibrated).toBe(false);
    expect(c.reasons.join(' ')).toMatch(/100 amostra\(s\) simulada\(s\)\/estimada\(s\) ignorada\(s\)/);
  });

  it('com 30+ amostras MEDIDAS calibra: p95 de entrada e cache, máx. de saída × 1,25, fração média', () => {
    const r = new UsageRecorder();
    for (let i = 0; i < 40; i++) r.record(sample({ promptTokens: 1000 + i * 10, cacheReadTokens: 2000, completionTokens: 300 + i, maxOutputTokens: 700 }));
    for (let i = 0; i < 30; i++) r.record(sample({ role: 'chair_synthesis', promptTokens: 4000, cacheReadTokens: 2500, completionTokens: 900, maxOutputTokens: 1500 }));
    r.record(sample({ source: 'simulated', promptTokens: 999_999 })); // ignorada
    const c = calibrateAssumptions(r);
    expect(c.calibrated).toBe(true);
    expect(c.assumptions.participantInput).toEqual({ promptTokens: 1370, cacheReadTokens: 2000, maxOutputTokens: Math.ceil(339 * 1.25) });
    expect(c.assumptions.chairSynthesis).toMatchObject({ promptTokens: 4000, cacheReadTokens: 2500, maxOutputTokens: Math.ceil(900 * 1.25), extraPromptTokensPerParticipant: 0 });
    expect(c.assumptions.expectedOutputFraction).toBeGreaterThan(0.5);
    expect(c.assumptions.expectedOutputFraction).toBeLessThanOrEqual(1);
    expect(c.reasons.join(' ')).toMatch(/1 amostra\(s\) simulada/);
  });

  it('calibra só o papel com amostras suficientes e recalcula o plano de custo', () => {
    const r = new UsageRecorder();
    for (let i = 0; i < 30; i++) r.record(sample({ promptTokens: 9000, cacheReadTokens: 12_000, completionTokens: 650, maxOutputTokens: 700 })); // bem acima da premissa
    const c = calibrateAssumptions(r);
    expect(c.calibrated).toBe(true);
    expect(c.assumptions.chairSynthesis).toEqual(DEFAULT_ASSUMPTIONS.chairSynthesis); // sem amostras: mantém
    expect(c.reasons.join(' ')).toMatch(/chair_synthesis: 0 amostras/);
    const base = buildRoutingPlan({ registries: reg, policy });
    const calibrated = buildRoutingPlan({ registries: reg, policy, assumptions: c.assumptions });
    expect(calibrated.totals.ceilingMicro).toBeGreaterThan(base.totals.ceilingMicro); // deriva visível: medição maior que a premissa
  });
});
