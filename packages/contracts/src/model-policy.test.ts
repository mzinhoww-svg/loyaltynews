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
    expect(v6.rules.privacy.openrouter_data_policy_ref).toMatch(/openrouter-politica-dados-arquivada-2026-11-23\.md/);
    const semRef = { ...v6, rules: { ...v6.rules, production_enabled: true, privacy: { ...v6.rules.privacy, openrouter_data_policy_ref: null } } };
    expect(ModelPolicy.safeParse(semRef).success).toBe(false);
    const ok = { ...v6, rules: { ...v6.rules, production_enabled: true, privacy: { ...v6.rules.privacy, openrouter_data_policy_ref: 'arquivo e data (FinOps)' } } };
    expect(ModelPolicy.safeParse(ok).success).toBe(true);
  });
});

const v7 = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/model.policy.dp02-v7.json', import.meta.url)), 'utf-8'));

describe('política v7 (DP-27): OpenBot nas assinaturas como principal, API como complemento, ZDR não exigido', () => {
  it('a v7 valida: canal principal openbot_subscription fora do teto, complemento openrouter_metered dentro de US$ 50', () => {
    const p = ModelPolicy.parse(v7);
    expect(p.execution?.primary.channel).toBe('openbot_subscription');
    expect(p.execution?.primary.outside_monthly_cap).toBe(true);
    expect(p.execution?.complement.channel).toBe('openrouter_metered');
    expect(p.execution?.complement.inside_monthly_cap_usd).toBe(50);
    expect(p.rules.privacy?.unpublished_requires_listed_zdr).toBe(false);
    expect(p.qualification?.mode?.provider_zdr_per_call).toBe(false);
    expect(p.rules.production_enabled).toBe(false);
  });

  it('mantém DP-26 b/c: sem DeepSeek, Fable fora de toda rota; nunca publicar sem checagem distinta', () => {
    const p = ModelPolicy.parse(v7);
    const rotas = Object.values(p.routes).flat();
    expect(rotas.some((m) => m.startsWith('deepseek') || m.includes('fable'))).toBe(false);
    expect(p.execution?.never.join(' ')).toMatch(/checagem por provedor distinto/);
    expect(String((p.rules as Record<string, unknown>).editorial_draft_fallback)).toMatch(/sem modelo ALTERNATIVO/);
  });

  it('sem ZDR obrigatório, produção não exige a referência do OpenRouter; com a exigência ligada, exige', () => {
    const prod = { ...v7, rules: { ...v7.rules, production_enabled: true, privacy: { ...v7.rules.privacy, openrouter_data_policy_ref: null } } };
    expect(ModelPolicy.safeParse(prod).success).toBe(true);
    const exige = { ...prod, rules: { ...prod.rules, privacy: { ...prod.rules.privacy, openrouter_data_policy_archived_required: true } } };
    expect(ModelPolicy.safeParse(exige).success).toBe(false);
  });

  it('recusa: complemento acima do teto, canal principal sem checagem, ZDR exigido sem provider.zdr', () => {
    const ex = v7.execution;
    expect(ModelPolicy.safeParse({ ...v7, execution: { ...ex, complement: { ...ex.complement, inside_monthly_cap_usd: 60 } } }).success).toBe(false);
    const semChecagem = { ...ex.primary.by_task };
    delete semChecagem.fact_check;
    expect(ModelPolicy.safeParse({ ...v7, execution: { ...ex, primary: { ...ex.primary, by_task: semChecagem } } }).success).toBe(false);
    expect(ModelPolicy.safeParse({ ...v7, rules: { ...v7.rules, privacy: { ...v7.rules.privacy, unpublished_requires_listed_zdr: true, provider_zdr_per_call: false } } }).success).toBe(false);
  });

  it('a v6 continua válida (ZDR exigido) e o modo de qualificação da v7 continua só com candidatos e produção desligada', () => {
    expect(ModelPolicy.safeParse(v6).success).toBe(true);
    const p = ModelPolicy.parse({ ...v7, qualification: { ...v7.qualification, mode: { ...v7.qualification.mode, enabled: true } } });
    expect(qualificationCallAllowed(p, qreq)).toBe(true);
    expect(qualificationCallAllowed(p, { ...qreq, model: 'claude-fable-5-2' })).toBe(false);
  });
});

describe('v7: autor distinto verificável no contrato e teto por etapa (QA 2 + decisões do PM T10/T11)', () => {
  const ex = v7.execution;
  const comTask = (k: string, val: unknown) => ({ ...v7, execution: { ...ex, primary: { ...ex.primary, by_task: { ...ex.primary.by_task, [k]: val } } } });
  const comModo = (mode: object) => ({ ...v7, qualification: { ...v7.qualification, mode: { ...v7.qualification.mode, ...mode } } });

  it('recusa checagem ou editor do mesmo provedor da redação', () => {
    expect(ModelPolicy.safeParse(comTask('fact_check', { account: 'claude', provider: 'anthropic' })).success).toBe(false);
    expect(ModelPolicy.safeParse(comTask('editorial_review', { account: 'claude', provider: 'anthropic' })).success).toBe(false);
  });

  it('recusa checador em branco, conta desconhecida ou texto solto no lugar da estrutura', () => {
    expect(ModelPolicy.safeParse(comTask('fact_check', { account: ' ', provider: 'openai' })).success).toBe(false);
    expect(ModelPolicy.safeParse(comTask('fact_check', { account: 'outro', provider: 'openai' })).success).toBe(false);
    expect(ModelPolicy.safeParse(comTask('fact_check', 'codex (assinatura OpenAI)')).success).toBe(false);
  });

  it('teto por etapa: v7 tem etapa 1 = 5 e etapa 2 = 10; etapa acima de 10 ou sem teto nenhum é recusado', () => {
    const p = ModelPolicy.parse(v7);
    expect(p.qualification?.mode?.stage_caps_usd).toEqual({ '1': 5, '2': 10 });
    expect(ModelPolicy.safeParse(comModo({ stage_caps_usd: { '1': 5, '2': 11 } })).success).toBe(false);
    expect(ModelPolicy.safeParse(comModo({ stage_caps_usd: {} })).success).toBe(false);
    expect(ModelPolicy.safeParse(v6).success).toBe(true); // v6 continua com cap_usd único
  });

  it('golden set só na verba OpenAI, nunca na reserva de auditoria', () => {
    expect(ModelPolicy.parse(v7).qualification?.mode?.golden_set_labeling_budget).toBe('openai_allocation');
    expect(ModelPolicy.safeParse(comModo({ golden_set_labeling_budget: 'audit_errata_reserve' })).success).toBe(false);
  });
});

describe('v7: reconferência do QA 2 (conta amarra o provedor; teto de cada etapa; v7 sem teto legado)', () => {
  const ex = v7.execution;
  const comTask = (k: string, val: unknown) => ({ ...v7, execution: { ...ex, primary: { ...ex.primary, by_task: { ...ex.primary.by_task, [k]: val } } } });
  const comModo = (mode: object) => ({ ...v7, qualification: { ...v7.qualification, mode: { ...v7.qualification.mode, ...mode } } });

  it('recusa conta Claude declarando OpenAI (e Codex declarando Anthropic) e a mesma conta da redação na checagem', () => {
    expect(ModelPolicy.safeParse(comTask('fact_check', { account: 'claude', provider: 'openai' })).success).toBe(false);
    expect(ModelPolicy.safeParse(comTask('social_copy', { account: 'codex', provider: 'anthropic' })).success).toBe(false);
  });

  it('etapa 1 acima de 5, etapa desconhecida ou só o teto legado numa v7 são recusados', () => {
    expect(ModelPolicy.safeParse(comModo({ stage_caps_usd: { '1': 10, '2': 10 } })).success).toBe(false);
    expect(ModelPolicy.safeParse(comModo({ stage_caps_usd: { '1': 5, '3': 1 } })).success).toBe(false);
    expect(ModelPolicy.safeParse(comModo({ stage_caps_usd: undefined, cap_usd: 5 })).success).toBe(false);
    expect(ModelPolicy.safeParse(comModo({ stage_caps_usd: { '1': 5 } })).success).toBe(true);
  });
});
