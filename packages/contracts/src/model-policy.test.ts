import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isEnabled, ModelPolicy, modelCallsAllowed, qualificationCallAllowed } from './index';

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

const v6 = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/model.policy.dp02-v6.json', import.meta.url)), 'utf-8'));
const qreq = { model: 'claude-haiku-5-5', task: 'model_qualification', dataClass: 'public' };
const ligado = (p: typeof v6) => ({ ...p, qualification: { ...p.qualification, mode: { ...p.qualification.mode, enabled: true } } });

describe('política v6 (DP-26) e modo de qualificação (T6, ADR-021)', () => {
  it('a v6 valida, sem DeepSeek nas rotas, Fable fora de toda rota, produção desligada e qualificação desligada', () => {
    const p = ModelPolicy.parse(v6);
    const rotas = Object.values(p.routes).flat();
    expect(rotas.some((m) => m.startsWith('deepseek') || m.includes('fable'))).toBe(false);
    expect(p.data_classes.public).not.toContain('deepseek');
    expect(p.rules.production_enabled).toBe(false);
    expect(p.qualification?.mode?.enabled).toBe(false);
    expect(qualificationCallAllowed(p, qreq)).toBe(false);
  });

  it('modo ligado: só candidato, tarefa model_qualification, classe public, com produção desligada', () => {
    const p = ModelPolicy.parse(ligado(v6));
    expect(qualificationCallAllowed(p, qreq)).toBe(true);
    expect(qualificationCallAllowed(p, { ...qreq, model: 'claude-fable-5-2' })).toBe(false);
    expect(qualificationCallAllowed(p, { ...qreq, task: 'editorial_draft' })).toBe(false);
    expect(qualificationCallAllowed(p, { ...qreq, dataClass: 'internal' })).toBe(false);
    expect(qualificationCallAllowed({ ...p, rules: { ...p.rules, production_enabled: true } }, qreq)).toBe(false);
  });

  it('recusa: teto acima de US$ 5, reserva de auditoria, fallback, candidato excluído e qualificação com produção ligada', () => {
    const m = v6.qualification.mode;
    const com = (mode: object, rules: object = {}) => ({ ...v6, rules: { ...v6.rules, ...rules }, qualification: { ...v6.qualification, mode: { ...m, ...mode } } });
    expect(ModelPolicy.safeParse(com({ cap_usd: 6 })).success).toBe(false);
    expect(ModelPolicy.safeParse(com({ uses_audit_reserve: true })).success).toBe(false);
    expect(ModelPolicy.safeParse(com({ allow_fallbacks: true })).success).toBe(false);
    expect(ModelPolicy.safeParse(com({ candidates: [...m.candidates, 'claude-fable-5-2'] })).success).toBe(false);
    expect(ModelPolicy.safeParse(com({ enabled: true }, { production_enabled: true, privacy: { ...v6.rules.privacy, openrouter_data_policy_ref: 'x' } })).success).toBe(false);
  });

  it('produção exige a política de dados do OpenRouter arquivada (DP-26 a)', () => {
    expect(ModelPolicy.safeParse({ ...v6, rules: { ...v6.rules, production_enabled: true } }).success).toBe(false);
    const ok = { ...v6, rules: { ...v6.rules, production_enabled: true, privacy: { ...v6.rules.privacy, openrouter_data_policy_ref: 'arquivo e data (FinOps)' } } };
    expect(ModelPolicy.safeParse(ok).success).toBe(true);
  });
});
