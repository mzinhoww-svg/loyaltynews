import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isEnabled, ModelPolicy, modelCallsAllowed } from './index';

const original = JSON.parse(readFileSync(fileURLToPath(new URL('../../../contracts/model.policy.json', import.meta.url)), 'utf-8'));

describe('política de modelos', () => {
  it('valida o contracts/model.policy.json do pacote 2.1', () => {
    const p = ModelPolicy.parse(original);
    expect(p.rules.production_enabled).toBe(false);
    expect(p.rules.hard_monthly_budget_usd).toBe(50);
  });
  it('recusa teto diferente de 50 e rota com modelo inexistente', () => {
    expect(ModelPolicy.safeParse({ ...original, rules: { ...original.rules, hard_monthly_budget_usd: 300 } }).success).toBe(false);
    expect(ModelPolicy.safeParse({ ...original, routes: { ...original.routes, review: ['nao-existe'] } }).success).toBe(false);
  });
  it('gate de chamada real exige política e flag', () => {
    const p = ModelPolicy.parse(original);
    expect(modelCallsAllowed(p, isEnabled('modelosHabilitados'))).toBe(false);
    expect(modelCallsAllowed({ rules: { ...p.rules, production_enabled: true } }, false)).toBe(false);
    expect(modelCallsAllowed({ rules: { ...p.rules, production_enabled: true } }, true)).toBe(true);
  });
});
