/**
 * Plano de roteamento de modelos da organização agêntica dentro do teto de US$ 50.
 *
 * Cruza os 28 rituais (calendário real do mês) com a política de modelos v5 (`@ln/modelops`:
 * rotas, preços por faixa, verbas por provedor, sublimite de escalonamento) e projeta, por ritual,
 * o custo do mês: TETO (reserva: preço da faixa mais cara, saída máxima) e ESPERADO.
 *
 * ATENÇÃO — o volume de tokens por chamada NÃO foi medido: são PREMISSAS (`DEFAULT_ASSUMPTIONS`),
 * declaradas no resultado. O plano é determinístico e não chama modelo nem rede. Quem decide
 * (qualificação de modelos, R2-07/08) é o gateway; isto só dimensiona a organização.
 */
import { estimateMicro, usdToMicro, type ModelEntry, type ModelPolicy, type TokenEstimate } from '@ln/modelops';
import { addDays, createBrCalendar, type HolidayCalendar } from './calendar';
import type { LoadedRegistries } from './config';
import { occurrencesOn } from './scheduler';
import type { Meeting } from './schemas';

/** Rituais essenciais: continuam até o degrau 42 (ADR-015; igual a `ESSENTIAL_RITUALS` de @ln/modelops). */
export const ESSENTIAL_RITUAL_IDS: readonly string[] = ['D-editorial', 'D-trust', 'D-sync', 'X-incident'];

export interface CallProfile {
  /** entrada sem cache */
  promptTokens: number;
  /** entrada lida do cache de prompt (prompt_cache_required) */
  cacheReadTokens: number;
  /** limite de saída (max_tokens) */
  maxOutputTokens: number;
}

export interface RoutingAssumptions {
  /** Sempre este texto: nenhum destes números foi medido. */
  status: 'PREMISSAS NAO MEDIDAS (medir em R4)';
  /** insumo estruturado de um participante (async_structured_first) */
  participantInput: CallProfile;
  /** síntese do presidente; entrada cresce por insumo recebido */
  chairSynthesis: CallProfile & { extraPromptTokensPerParticipant: number };
  /** fração do limite de saída realmente usada no cálculo ESPERADO (o teto usa 100%) */
  expectedOutputFraction: number;
  /** ocorrências do ritual por evento (X-incident) no mês */
  incidentsPerMonth: number;
  /** nos rituais premium/strategic só a síntese do presidente usa a rota do ritual; participantes usam esta rota */
  participantRouteWhenRitualIsPremium: 'review' | 'economy';
  /**
   * `false` (conservador): todo participante gera um insumo por chamada de modelo.
   * `true`: nos rituais de CONSOLIDAÇÃO (`CONSOLIDATION_RITUAL_IDS`) os insumos dos participantes saem de um digest
   * determinístico (worker, ADR-014: insumos preparados às 05:30), sem modelo; só a síntese do presidente chama modelo.
   */
  digestForConsolidation: boolean;
}

/** Rituais que consolidam o que os dailies/diretorias já produziram (candidatos a insumo por digest). */
export const CONSOLIDATION_RITUAL_IDS: readonly string[] = [
  'D-editorial', 'D-sync', 'W-pautas', 'W-cross', 'W-performance', 'W-finops', 'W-trust', 'W-intel', 'M-board', 'M-model', 'M-commercial',
];

export const DEFAULT_ASSUMPTIONS: RoutingAssumptions = {
  status: 'PREMISSAS NAO MEDIDAS (medir em R4)',
  participantInput: { promptTokens: 1_500, cacheReadTokens: 6_000, maxOutputTokens: 700 },
  chairSynthesis: { promptTokens: 2_000, cacheReadTokens: 6_000, maxOutputTokens: 1_500, extraPromptTokensPerParticipant: 400 },
  expectedOutputFraction: 0.6,
  incidentsPerMonth: 2,
  participantRouteWhenRitualIsPremium: 'review',
  digestForConsolidation: false,
};

export interface CallCost {
  role: 'participant_input' | 'chair_synthesis';
  route: string;
  /** chamadas por ocorrência do ritual */
  callsPerOccurrence: number;
  /** modelo usado no cálculo esperado (primeiro elegível da rota) e no teto (o mais caro elegível) */
  modelExpected: string | null;
  modelCeiling: string | null;
  expectedMicroPerCall: number;
  ceilingMicroPerCall: number;
}

export interface RitualCost {
  meeting_id: string;
  cycle: Meeting['cycle'];
  essential: boolean;
  route: string;
  occurrencesInMonth: number;
  calls: CallCost[];
  expectedMicro: number;
  ceilingMicro: number;
  /** teto do mês que cai em escalonamento (modelos Opus/Fable) */
  escalationCeilingMicro: number;
}

export interface PlanCheck {
  id: string;
  ok: boolean;
  /** `error` reprova o plano; `warning` só alerta (heurística AgentOps, não é regra da política) */
  severity: 'error' | 'warning';
  detail: string;
}

export interface RoutingPlan {
  policyVersion: string;
  monthKey: string;
  holidayCalendar: string;
  assumptions: RoutingAssumptions;
  rituals: RitualCost[];
  totals: {
    expectedMicro: number;
    ceilingMicro: number;
    essentialCeilingMicro: number;
    nonEssentialCeilingMicro: number;
    escalationCeilingMicro: number;
    byProviderCeilingMicro: Record<string, number>;
  };
  caps: { hardMonthlyMicro: number; anthropicAllocationMicro: number; openaiAllocationMicro: number; escalationSublimitMicro: number };
  /** Folga do teto (verba do provedor menos o que os rituais podem reservar): sobra para editorial e demais. */
  headroomMicro: { anthropic: number; openai: number; escalation: number };
  checks: PlanCheck[];
  ok: boolean;
}

const ESCALATION_MODELS: readonly string[] = ['claude-opus-5-5', 'claude-fable-5-2'];

/** Modelos elegíveis para o trabalho de ritual numa rota (exclui os restritos a revisão/auditoria, ex.: OpenAI). */
function eligibleModels(policy: ModelPolicy, route: string): ModelEntry[] {
  const ids = policy.routes[route] ?? [];
  const models: ModelEntry[] = [];
  for (const id of ids) {
    const m = policy.models.find((x) => x.id === id);
    if (!m) continue;
    // `allowed_tasks` presente = modelo restrito a tarefas listadas; 'daily'/'monthly_board'/... não estão nele.
    if (m.allowed_tasks && !m.allowed_tasks.includes('daily')) continue;
    models.push(m);
  }
  return models;
}

function tokens(p: CallProfile, outputFraction: number, uncertain: boolean): TokenEstimate {
  return {
    promptTokens: p.promptTokens,
    cacheWriteTokens: 0,
    cacheReadTokens: p.cacheReadTokens,
    maxOutputTokens: Math.round(p.maxOutputTokens * outputFraction),
    uncertain,
  };
}

interface Priced {
  expected: number | null;
  ceiling: number | null;
  modelExpected: string | null;
  modelCeiling: string | null;
}

function priceCall(policy: ModelPolicy, route: string, p: CallProfile, expectedFraction: number): Priced {
  const models = eligibleModels(policy, route);
  if (route === 'deterministic') return { expected: 0, ceiling: 0, modelExpected: null, modelCeiling: null };
  if (!models.length) return { expected: null, ceiling: null, modelExpected: null, modelCeiling: null };
  const first = models[0]!;
  const expected = estimateMicro(first, tokens(p, expectedFraction, false));
  let ceiling: number | null = 0;
  let modelCeiling: string | null = null;
  for (const m of models) {
    const c = estimateMicro(m, tokens(p, 1, true));
    if (c === null) {
      ceiling = null; // preço faltando = custo desconhecido = bloqueia (block_unknown_cost)
      modelCeiling = m.id;
      break;
    }
    if (ceiling !== null && c >= ceiling) {
      ceiling = c;
      modelCeiling = m.id;
    }
  }
  return { expected, ceiling, modelExpected: first.id, modelCeiling };
}

/** Datas locais do mês (AAAA-MM). */
function monthDays(monthKey: string): string[] {
  const days: string[] = [];
  let d = `${monthKey}-01`;
  while (d.startsWith(monthKey)) {
    days.push(d);
    d = addDays(d, 1);
  }
  return days;
}

export function buildRoutingPlan(input: {
  registries: Pick<LoadedRegistries, 'agents' | 'meetings'>;
  policy: ModelPolicy;
  monthKey?: string;
  calendar?: HolidayCalendar;
  assumptions?: RoutingAssumptions;
}): RoutingPlan {
  const { registries, policy } = input;
  const monthKey = input.monthKey ?? '2026-12';
  const calendar = input.calendar ?? createBrCalendar();
  const a = input.assumptions ?? DEFAULT_ASSUMPTIONS;
  const agentHint = new Map(registries.agents.map((x) => [x.id, x.default_route_hint]));

  const counts = new Map<string, number>();
  for (const day of monthDays(monthKey)) {
    for (const occ of occurrencesOn(registries.meetings, day, calendar)) counts.set(occ.meeting.id, (counts.get(occ.meeting.id) ?? 0) + 1);
  }

  const rituals: RitualCost[] = registries.meetings.map((m) => {
    const occurrences = m.cycle === 'event' ? a.incidentsPerMonth : (counts.get(m.id) ?? 0);
    const premium = m.route === 'premium' || m.route === 'strategic';
    const participantRoute = premium ? a.participantRouteWhenRitualIsPremium : m.route;
    // participantes que geram chamada: os de perfil não determinístico, exceto o presidente (que faz a síntese)
    const digest = a.digestForConsolidation && CONSOLIDATION_RITUAL_IDS.includes(m.id);
    const allCallers = m.participants.filter((p) => p !== m.chair && agentHint.get(p) !== 'deterministic');
    // com digest os insumos entram na síntese (prompt maior), mas não geram chamada própria
    const callers = digest ? [] : allCallers;
    const synthesisProfile: CallProfile = {
      promptTokens: a.chairSynthesis.promptTokens + a.chairSynthesis.extraPromptTokensPerParticipant * allCallers.length,
      cacheReadTokens: a.chairSynthesis.cacheReadTokens,
      maxOutputTokens: a.chairSynthesis.maxOutputTokens,
    };
    const pIn = priceCall(policy, participantRoute, a.participantInput, a.expectedOutputFraction);
    const pSyn = priceCall(policy, m.route, synthesisProfile, a.expectedOutputFraction);
    const calls: CallCost[] = [
      { role: 'participant_input', route: participantRoute, callsPerOccurrence: callers.length, modelExpected: pIn.modelExpected, modelCeiling: pIn.modelCeiling, expectedMicroPerCall: pIn.expected ?? -1, ceilingMicroPerCall: pIn.ceiling ?? -1 },
      { role: 'chair_synthesis', route: m.route, callsPerOccurrence: 1, modelExpected: pSyn.modelExpected, modelCeiling: pSyn.modelCeiling, expectedMicroPerCall: pSyn.expected ?? -1, ceilingMicroPerCall: pSyn.ceiling ?? -1 },
    ];
    const sum = (key: 'expectedMicroPerCall' | 'ceilingMicroPerCall') => calls.reduce((s, c) => s + Math.max(c[key], 0) * c.callsPerOccurrence, 0) * occurrences;
    const escalationCeiling = calls
      .filter((c) => c.modelCeiling && ESCALATION_MODELS.includes(c.modelCeiling))
      .reduce((s, c) => s + Math.max(c.ceilingMicroPerCall, 0) * c.callsPerOccurrence, 0) * occurrences;
    return {
      meeting_id: m.id,
      cycle: m.cycle,
      essential: ESSENTIAL_RITUAL_IDS.includes(m.id),
      route: m.route,
      occurrencesInMonth: occurrences,
      calls,
      expectedMicro: sum('expectedMicroPerCall'),
      ceilingMicro: sum('ceilingMicroPerCall'),
      escalationCeilingMicro: escalationCeiling,
    };
  });

  const providerOf = (modelId: string | null): string => policy.models.find((x) => x.id === modelId)?.provider ?? 'unknown';
  const byProvider: Record<string, number> = {};
  for (const r of rituals) {
    for (const c of r.calls) {
      if (!c.modelCeiling) continue;
      const p = providerOf(c.modelCeiling);
      byProvider[p] = (byProvider[p] ?? 0) + Math.max(c.ceilingMicroPerCall, 0) * c.callsPerOccurrence * r.occurrencesInMonth;
    }
  }
  const totals = {
    expectedMicro: rituals.reduce((s, r) => s + r.expectedMicro, 0),
    ceilingMicro: rituals.reduce((s, r) => s + r.ceilingMicro, 0),
    essentialCeilingMicro: rituals.filter((r) => r.essential).reduce((s, r) => s + r.ceilingMicro, 0),
    nonEssentialCeilingMicro: rituals.filter((r) => !r.essential).reduce((s, r) => s + r.ceilingMicro, 0),
    escalationCeilingMicro: rituals.reduce((s, r) => s + r.escalationCeilingMicro, 0),
    byProviderCeilingMicro: byProvider,
  };

  const alloc = policy.rules.budget_allocation_usd;
  const caps = {
    hardMonthlyMicro: usdToMicro(policy.rules.hard_monthly_budget_usd),
    anthropicAllocationMicro: usdToMicro(alloc.anthropic),
    openaiAllocationMicro: usdToMicro(alloc.openai),
    // v6/v7 renomeia para `anthropic_escalation_opus_included` (só Opus); a v5 usa `..._opus_fable_included` (igual a modelops/budget.ts)
    escalationSublimitMicro: usdToMicro(alloc.anthropic_escalation_opus_included ?? alloc.anthropic_escalation_opus_fable_included ?? 0),
  };
  const headroomMicro = {
    anthropic: caps.anthropicAllocationMicro - (byProvider.anthropic ?? 0),
    openai: caps.openaiAllocationMicro - (byProvider.openai ?? 0),
    escalation: caps.escalationSublimitMicro - totals.escalationCeilingMicro,
  };

  const unknownCost = rituals.flatMap((r) => r.calls.filter((c) => c.callsPerOccurrence > 0 && r.occurrencesInMonth > 0 && (c.ceilingMicroPerCall < 0 || c.expectedMicroPerCall < 0)).map((c) => `${r.meeting_id}/${c.role}/${c.route}`));
  const unknownProvider = Object.keys(byProvider).includes('unknown');
  const checks: PlanCheck[] = [
    { id: 'no_unknown_cost', severity: 'error', ok: unknownCost.length === 0 && !unknownProvider, detail: unknownCost.length ? `custo desconhecido (bloqueia): ${unknownCost.join(', ')}` : 'toda chamada de ritual tem rota, modelo elegível e preço' },
    { id: 'hard_cap', severity: 'error', ok: totals.ceilingMicro <= caps.hardMonthlyMicro, detail: `teto dos rituais ${totals.ceilingMicro} <= ${caps.hardMonthlyMicro} micro-USD (US$ 50)` },
    { id: 'anthropic_allocation', severity: 'error', ok: headroomMicro.anthropic >= 0, detail: `anthropic ${byProvider.anthropic ?? 0} <= verba ${caps.anthropicAllocationMicro}` },
    { id: 'openai_not_used_by_rituals', severity: 'error', ok: (byProvider.openai ?? 0) === 0, detail: 'OpenAI só na rota de revisão (fact-check, auditoria): rituais não a usam' },
    { id: 'escalation_sublimit', severity: 'error', ok: headroomMicro.escalation >= 0, detail: `escalonamento (Opus/Fable) ${totals.escalationCeilingMicro} <= sublimite ${caps.escalationSublimitMicro}` },
    { id: 'no_images_no_deepseek', severity: 'error', ok: (byProvider.deepseek ?? 0) === 0 && !rituals.some((r) => r.route.startsWith('image')), detail: 'imagens e DeepSeek têm verba zero (DP-04)' },
    // Heurística AgentOps (não é regra da política): os rituais não devem consumir mais da metade da verba da Anthropic.
    { id: 'rituals_leave_room_for_editorial', severity: 'warning', ok: (byProvider.anthropic ?? 0) <= caps.anthropicAllocationMicro / 2, detail: `HEURISTICA AgentOps: rituais (teto) <= 50% da verba Anthropic, para sobrar ao editorial; teto dos rituais ${byProvider.anthropic ?? 0} de ${caps.anthropicAllocationMicro}` },
  ];

  return {
    policyVersion: policy.version,
    monthKey,
    holidayCalendar: calendar.version,
    assumptions: a,
    rituals,
    totals,
    caps,
    headroomMicro,
    checks,
    ok: checks.every((c) => c.ok || c.severity === 'warning'),
  };
}
