import { loadPolicyFile, type ModelPolicy } from '@ln/modelops';
import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { breakEvenTokenScale, BUSINESS_DAYS_PER_MONTH, COMBOS, costCombo, LIMIT_LADDER, SCENARIOS, STEPS, SUBSCRIPTION_LIMITS_UNVERIFIED, type ComboCost } from './cost-redesign';
import { POLICY_FIXTURE } from './paths';
import { buildRoutingPlan, DEFAULT_ASSUMPTIONS } from './routing-plan';

const policy = loadPolicyFile(POLICY_FIXTURE).policy as ModelPolicy;
const registries = loadRegistries();
const ritual = {
  api: buildRoutingPlan({ registries, policy }).totals.expectedMicro,
  api_digest: buildRoutingPlan({ registries, policy, assumptions: { ...DEFAULT_ASSUMPTIONS, digestForConsolidation: true } }).totals.expectedMicro,
};
const costs = new Map<string, ComboCost>(COMBOS.map((c) => [c.id, costCombo(c, policy, ritual)]));
const get = (id: string) => costs.get(id)!;
const CAP = 50_000_000;

describe('redesenho de custo por matéria (DP-27) — modelo paramétrico', () => {
  it('tem as combinações A, A0, B–G e os cenários 15/30/60 com 22 dias úteis', () => {
    expect(COMBOS.map((c) => c.id)).toEqual(['A', 'A0', 'B', 'C', 'D', 'E', 'F', 'G']);
    expect([...SCENARIOS]).toEqual([15, 30, 60]);
    expect(BUSINESS_DAYS_PER_MONTH).toBe(22);
    for (const c of costs.values()) for (const n of SCENARIOS) expect(c.scenarios[n]!.articlesPerMonth).toBe(n * 22);
  });

  it('o cache decide: sem cache a API sozinha custa mais por matéria (A0 > A)', () => {
    expect(get('A0').apiMicroPerArticle).toBeGreaterThan(get('A').apiMicroPerArticle * 1.4);
  });

  it('cada alavanca reduz o custo na API ou a demanda da assinatura, e a recomendada (G) é a mais barata em ambos', () => {
    // via OpenBot tira quase tudo da API (só a auditoria por amostragem fica)
    expect(get('B').apiMicroPerArticle).toBeLessThan(get('A').apiMicroPerArticle * 0.1);
    // determinístico reduz tokens na assinatura
    const sub = (id: string) => Object.values(get(id).subscriptionTokensPerArticle).reduce((a, b) => a + b, 0);
    expect(sub('C')).toBeLessThan(sub('B'));
    // checagem por modelo só em 30% das matérias reduz a via Codex
    expect(get('D').subscriptionTokensPerArticle.codex).toBeLessThan(get('B').subscriptionTokensPerArticle.codex);
    // gratuitos passam tokens da assinatura para a via gratuita
    expect(get('F').subscriptionTokensPerArticle.free).toBeGreaterThan(0);
    const claudeSide = (id: string) => get(id).subscriptionTokensPerArticle.claude + get(id).subscriptionTokensPerArticle.any;
    expect(claudeSide('F')).toBeLessThan(claudeSide('C'));
    // otimizada só-API é mais barata que a base, e a recomendada é a de menor demanda de assinatura
    expect(get('E').apiMicroPerArticle).toBeLessThan(get('A').apiMicroPerArticle);
    for (const id of ['B', 'C', 'D', 'F']) expect(sub('G')).toBeLessThanOrEqual(sub(id));
    expect(get('G').apiMicroPerArticle).toBeLessThanOrEqual(get('B').apiMicroPerArticle);
  });

  it('a auditoria pós-publicação fica SEMPRE na API (precisa de evidência independente), mesmo na via OpenBot', () => {
    for (const id of ['B', 'C', 'D', 'F', 'G']) {
      const audit = get(id).steps.find((s) => s.step === 'audit')!;
      expect(audit.executor, id).toBe('api');
      expect(audit.apiMicroPerArticle, id).toBeGreaterThan(0);
    }
    expect(STEPS.find((s) => s.id === 'audit')!.apiOnly).toBe(true);
    expect(STEPS.find((s) => s.id === 'audit')!.coverage).toBe(0.1);
  });

  it('a checagem de fatos nunca vai para modelo gratuito e roda em autor distinto do redator (Claude × Codex)', () => {
    for (const c of costs.values()) {
      expect(c.steps.find((s) => s.step === 'factcheck')!.executor).not.toBe('free');
      expect(c.steps.find((s) => s.step === 'review')!.executor).not.toBe('free');
    }
    expect(STEPS.find((s) => s.id === 'draft')!.lane).toBe('claude');
    expect(STEPS.find((s) => s.id === 'factcheck')!.lane).toBe('codex');
    expect(STEPS.find((s) => s.id === 'factcheck')!.apiModel).toBe('openai-text-review');
  });

  it('o custo mensal cresce com o volume, "cabe" bate com o teto de US$ 50 e o fixo entra uma vez', () => {
    for (const c of costs.values()) {
      const [a, b, d] = SCENARIOS.map((n) => c.scenarios[n]!);
      expect(b!.apiMonthlyMicro).toBeGreaterThanOrEqual(a!.apiMonthlyMicro);
      expect(d!.apiMonthlyMicro).toBeGreaterThanOrEqual(b!.apiMonthlyMicro);
      for (const n of SCENARIOS) expect(c.scenarios[n]!.fits).toBe(c.scenarios[n]!.apiMonthlyMicro <= CAP);
      expect(a!.apiMonthlyMicro).toBe(Math.round(c.apiMicroPerArticle * 15 * 22) + c.fixedMonthlyApiMicro);
    }
    // via OpenBot: o fixo é só o verificador (≈ US$ 0,50); nas outras entram os rituais
    expect(get('G').fixedMonthlyApiMicro).toBe(500_000);
    expect(get('A').fixedMonthlyApiMicro).toBe(500_000 + ritual.api);
    expect(get('E').fixedMonthlyApiMicro).toBe(500_000 + ritual.api_digest);
  });

  it('sensibilidade: a escala de tokens de equilíbrio reproduz exatamente o teto de US$ 50', () => {
    for (const id of ['A', 'A0', 'E']) {
      for (const n of SCENARIOS) {
        const c = get(id);
        const scale = breakEvenTokenScale(c, n, CAP)!;
        const atScale = c.apiMicroPerArticle * scale * n * 22 + c.fixedMonthlyApiMicro;
        expect(Math.abs(atScale - CAP)).toBeLessThan(2); // arredondamento em micro-USD
      }
    }
    // mais volume = menos margem; sem cache = menos margem
    expect(breakEvenTokenScale(get('A'), 60, CAP)!).toBeLessThan(breakEvenTokenScale(get('A'), 15, CAP)!);
    expect(breakEvenTokenScale(get('A0'), 30, CAP)!).toBeLessThan(breakEvenTokenScale(get('A'), 30, CAP)!);
    expect(breakEvenTokenScale(get('A'), 60, CAP)!).toBeGreaterThan(1); // com estas premissas leves A ainda cabe a 60/dia
  });

  it('os limites das assinaturas constam como NÃO verificados e a escada de limite termina em falha fechada', () => {
    for (const v of Object.values(SUBSCRIPTION_LIMITS_UNVERIFIED)) expect(v).toMatch(/NÃO verificados?/);
    expect(LIMIT_LADDER.map((l) => l.level)).toEqual([1, 2, 3, 4]);
    expect(LIMIT_LADDER[3]!.action).toMatch(/falha fechada.*não é publicada/);
    expect(LIMIT_LADDER[1]!.action).toMatch(/NUNCA é pulada nem feita pelo mesmo autor/);
  });

  it('falha fechada: modelo sem preço na política derruba o cálculo', () => {
    const noPrice = structuredClone(policy);
    delete (noPrice.models.find((m) => m.id === 'openai-text-review') as { binding?: unknown }).binding;
    expect(() => costCombo(COMBOS[0]!, noPrice, ritual)).toThrow(/preço ausente/);
  });
});
