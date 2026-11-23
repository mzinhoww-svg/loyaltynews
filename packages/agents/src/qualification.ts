/**
 * Protocolo de QUALIFICAÇÃO de modelos (G2 / R2-07/08). SEM chamadas reais: este módulo define os casos de teste por
 * papel, os critérios de aprovação, o teto de custo da qualificação (dentro da DP-04) e as funções que avaliam os
 * resultados quando a qualificação for autorizada. Nada roda até o proprietário decidir a política de produção
 * (`production_enabled` segue `false`; flag `modelosHabilitados` desligada).
 *
 * Alinhado com `r0-preparacao/finops/proposta-politica-modelos-producao.md` (papéis e modelos) e com a política v5
 * (`@ln/modelops`). Limiares marcados `proposed: true` são sugestões da Frente 07, a ratificar (FinOps/QA/proprietário).
 */
import { estimateMicro, usdToMicro, type ModelEntry, type ModelPolicy, type TokenEstimate } from '@ln/modelops';
import { validateAgentOutput } from './output';
import type { AgentProfile } from './schemas';

export type QualRole =
  | 'editorial_draft'
  | 'fact_check'
  | 'editorial_review'
  | 'audit'
  | 'ritual_participant_input'
  | 'ritual_chair_synthesis'
  | 'premium_analysis';

export interface QualCase {
  id: string;
  role: QualRole;
  title: string;
  /** id do modelo na política v5 */
  models: string[];
  /** execuções por modelo */
  runsPerModel: number;
  /** chamadas por execução (ex.: par de cache = 2) */
  callsPerRun: number;
  profile: { promptTokens: number; cacheReadTokens: number; cacheWriteTokens: number; maxOutputTokens: number };
  /** classe do dado de entrada: SEMPRE `public` (conteúdo público já publicado, sintético ou sanitizado) */
  dataClass: 'public';
  /** o que o caso exige de insumo */
  input: string;
  /** o que decide aprovação */
  checks: string[];
  /** o que precisa existir antes de rodar */
  needs: string;
}

/**
 * Casos por papel. Entradas: SOMENTE conteúdo público e já publicado ou sanitizado (classe `public`); nenhum dado pessoal,
 * embargado ou confidencial, nenhum rascunho inédito. Chamadas com `data_collection: deny` e `provider.zdr` verificadas.
 */
export const QUAL_CASES: QualCase[] = [
  {
    id: 'Q-DRAFT', role: 'editorial_draft', title: 'Redação de matéria curta a partir de pacote de fontes públicas (1 por editoria, 2 repetições)',
    models: ['claude-haiku-5-5'], runsPerModel: 20, callsPerRun: 1,
    profile: { promptTokens: 2_500, cacheReadTokens: 6_000, cacheWriteTokens: 0, maxOutputTokens: 1_800 },
    dataClass: 'public',
    input: 'pacote de 3–5 fontes públicas por editoria (10 editorias), glossário e estilo da editoria',
    checks: ['QC-SCHEMA', 'QC-USAGE', 'QC-COST', 'QC-ZDR', 'QC-QUALITY-DRAFT'],
    needs: 'golden set PT-BR com rubrica da Editorial (fidelidade às fontes, citação, ausência de cópia literal)',
  },
  {
    id: 'Q-FACT', role: 'fact_check', title: 'Checagem de fatos em provedor distinto do redator, com erros plantados',
    models: ['openai-text-review', 'openai-text-review-alt'], runsPerModel: 20, callsPerRun: 1,
    profile: { promptTokens: 4_000, cacheReadTokens: 5_000, cacheWriteTokens: 0, maxOutputTokens: 1_200 },
    dataClass: 'public',
    input: 'rascunhos do Q-DRAFT (autor Anthropic): 10 limpos e 10 com 2 erros plantados cada (número, atribuição, afirmação sem fonte, direito autoral)',
    checks: ['QC-SCHEMA', 'QC-USAGE', 'QC-COST', 'QC-ZDR', 'QC-DISTINCT-AUTHOR', 'QC-SEEDED-RECALL', 'QC-FALSE-POSITIVE'],
    needs: 'rascunhos do Q-DRAFT aprovados e o gabarito dos erros plantados (escrito por humano, fora do modelo)',
  },
  {
    id: 'Q-REVIEW', role: 'editorial_review', title: 'Revisão editorial independente de rascunho (gate WF02)',
    models: ['openai-text-review', 'openai-text-review-alt'], runsPerModel: 10, callsPerRun: 1,
    profile: { promptTokens: 4_000, cacheReadTokens: 5_000, cacheWriteTokens: 0, maxOutputTokens: 1_200 },
    dataClass: 'public',
    input: '10 rascunhos do Q-DRAFT (autor Anthropic). Sonnet 5.5 NÃO entra: é do mesmo autor do redator e não vale para o gate WF02 (ele só serve às rotas de ritual)',
    checks: ['QC-SCHEMA', 'QC-USAGE', 'QC-COST', 'QC-ZDR', 'QC-DISTINCT-AUTHOR-GATE'],
    needs: 'rubrica de revisão (estrutura, tom, títulos, copy literal) da Editorial',
  },
  {
    id: 'Q-AUDIT', role: 'audit', title: 'Correção, retratação e auditoria pós-publicação (WF08/WF18/postpublication_audit)',
    models: ['openai-text-review', 'openai-text-review-alt'], runsPerModel: 6, callsPerRun: 1,
    profile: { promptTokens: 5_000, cacheReadTokens: 4_000, cacheWriteTokens: 0, maxOutputTokens: 1_500 },
    dataClass: 'public',
    input: '6 cenários sintéticos sobre matérias já públicas: erro factual, pedido de retratação, falha de atribuição, imagem sem direito, dado desatualizado, correção correta',
    checks: ['QC-SCHEMA', 'QC-USAGE', 'QC-COST', 'QC-ZDR', 'QC-DISTINCT-AUTHOR', 'QC-SEEDED-RECALL'],
    needs: 'cenários e gabarito escritos pela Trust; nenhuma despublicação real',
  },
  {
    id: 'Q-RITUAL-IN', role: 'ritual_participant_input', title: 'Insumo estruturado de participante de ritual (contrato do perfil)',
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5'], runsPerModel: 12, callsPerRun: 1,
    profile: { promptTokens: 1_500, cacheReadTokens: 6_000, cacheWriteTokens: 0, maxOutputTokens: 700 },
    dataClass: 'public',
    input: 'pautas e blocos de status sintéticos/públicos para 12 perfis variados (editor, diretor, trust, growth, intelligence…)',
    checks: ['QC-SCHEMA', 'QC-USAGE', 'QC-COST', 'QC-ZDR'],
    needs: 'perfis do registro (output_contract) — já existem',
  },
  {
    id: 'Q-RITUAL-SYN', role: 'ritual_chair_synthesis', title: 'Síntese do presidente: decisões com responsável e prazo, rejeição de autoridade inválida',
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'], runsPerModel: 6, callsPerRun: 1,
    profile: { promptTokens: 6_000, cacheReadTokens: 6_000, cacheWriteTokens: 0, maxOutputTokens: 1_500 },
    dataClass: 'public',
    input: '6 conjuntos de insumos sintéticos (incluindo um com responsável inexistente e um com decisão protegida)',
    checks: ['QC-SCHEMA', 'QC-USAGE', 'QC-COST', 'QC-ZDR', 'QC-DECISION-SHAPE'],
    needs: 'ParticipantInput e DecisionInput (schemas.ts) — já existem',
  },
  {
    id: 'Q-PREMIUM', role: 'premium_analysis', title: 'Análise premium / board mensal em Opus (escalonamento)',
    models: ['claude-opus-5-5'], runsPerModel: 3, callsPerRun: 1,
    profile: { promptTokens: 10_000, cacheReadTokens: 6_000, cacheWriteTokens: 0, maxOutputTokens: 2_500 },
    dataClass: 'public',
    input: '3 pacotes públicos de análise setorial (sem dado de negócio interno)',
    checks: ['QC-SCHEMA', 'QC-USAGE', 'QC-COST', 'QC-ZDR'],
    needs: 'motivo de escalonamento registrado por execução (política: motivo + sublimite)',
  },
  {
    id: 'Q-CACHE', role: 'editorial_draft', title: 'Cache de prompt: mesma base estável duas vezes na janela do cache; a 2ª deve ler do cache',
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'openai-text-review', 'openai-text-review-alt'], runsPerModel: 5, callsPerRun: 2,
    profile: { promptTokens: 500, cacheReadTokens: 6_000, cacheWriteTokens: 6_000, maxOutputTokens: 200 },
    dataClass: 'public',
    input: 'prefixo estável de ~6.000 tokens (acima do mínimo cacheável do modelo, a verificar) + pergunta curta que muda',
    checks: ['QC-CACHE-HIT', 'QC-USAGE', 'QC-COST'],
    needs: 'mínimo de tokens cacheável e TTL por modelo (verificar no catálogo/documentação do provedor)',
  },
];

// --- critérios -------------------------------------------------------------------------------------------------------

export interface QualCriterion {
  id: string;
  text: string;
  measure: string;
  threshold: string;
  /** limiar sugerido pela Frente 07 (não vem da política): a ratificar */
  proposed: boolean;
}

export const QUAL_CRITERIA: QualCriterion[] = [
  { id: 'QC-SCHEMA', text: 'Saída dentro do contrato do perfil (R4-04)', measure: 'validateAgentOutput sobre cada saída', threshold: '≥ 95% válidas na qualificação, 0 inválidas aceitas; operação monitora ≥ 99%', proposed: true },
  { id: 'QC-USAGE', text: 'Cada chamada traz usage e evidência de geração (custo conciliável)', measure: 'sampleFromResponse != null e generation id presente', threshold: '100% das chamadas', proposed: false },
  { id: 'QC-COST', text: 'Custo real por chamada coerente com o preço de lista e nunca acima da reserva', measure: 'usage.cost (conciliado com /generation) x tokens × preço; custo ≤ teto da reserva', threshold: 'desvio ≤ 10% (esperado) e 0 chamadas acima da reserva', proposed: true },
  { id: 'QC-ZDR', text: 'Endpoint de ZDR de fato usado', measure: 'provider.zdr=true na chamada e provider_name da geração ∈ endpoints ZDR listados do modelo', threshold: '100% das chamadas', proposed: false },
  { id: 'QC-CACHE-HIT', text: 'Cache de prompt funciona', measure: 'na 2ª chamada de cada par, prompt_tokens_details.cached_tokens > 0 e cache_read cobrado ao preço de leitura', threshold: 'cached_tokens > 0 em 5 de 5 pares por modelo; senão a rota para (cache_failure)', proposed: false },
  { id: 'QC-DISTINCT-AUTHOR', text: 'Checagem em provedor distinto do redator', measure: 'autor = prefixo de generation.model da tentativa bem-sucedida (não o provedor de hospedagem)', threshold: '100% dos pares com autor diferente; sem autor distinto: bloqueia', proposed: false },
  { id: 'QC-DISTINCT-AUTHOR-GATE', text: 'Revisor do gate WF02 distinto do redator', measure: 'idem; Sonnet (Anthropic) nunca aprova o gate de rascunho Anthropic', threshold: '100% dos revisores do gate com autor diferente', proposed: false },
  { id: 'QC-SEEDED-RECALL', text: 'Detecta os erros plantados', measure: 'erros plantados apontados / erros plantados', threshold: '≥ 90% e nenhum erro crítico (número, atribuição) perdido', proposed: true },
  { id: 'QC-FALSE-POSITIVE', text: 'Não acusa erro em rascunho limpo', measure: 'rascunhos limpos com alerta / rascunhos limpos', threshold: '≤ 20%', proposed: true },
  { id: 'QC-QUALITY-DRAFT', text: 'Qualidade PT-BR da redação frente ao golden set', measure: 'avaliação cega por 2 editores com rubrica (fidelidade, clareza, ausência de cópia literal)', threshold: 'nota média ≥ referência acordada; limiar numérico a definir com a Editorial', proposed: true },
  { id: 'QC-DECISION-SHAPE', text: 'Síntese respeita autoridade', measure: 'responsável inexistente → decisão rejeitada; decisão protegida → pending_verifier', threshold: '100% dos casos de armadilha tratados', proposed: true },
];

/** Aprovação por modelo e papel: todos os critérios dos casos em que o modelo participa precisam passar. */
export function criteriaFor(modelId: string): string[] {
  return [...new Set(QUAL_CASES.filter((c) => c.models.includes(modelId)).flatMap((c) => c.checks))];
}

// --- orçamento da qualificação ----------------------------------------------------------------------------------------

export const QUAL_BUDGET_PROPOSAL = {
  /** teto proposto da qualificação inteira, em USD (≈ 10% do teto mensal de US$ 50) */
  hardCapUsd: 5,
  /** reexecuções permitidas por falha transitória (política: max_attempts = 3 → até 20% a mais de chamadas) */
  retryAllowance: 0.2,
  /** fração do sublimite de escalonamento (US$ 5) que a qualificação do Opus pode consumir */
  escalationShareOfSublimit: 0.2,
  /** a qualificação nunca toca a reserva de US$ 8 (exclusiva de auditoria e errata) */
  usesAuditReserve: false,
} as const;

export interface QualCost {
  caseId: string;
  model: string;
  provider: string;
  calls: number;
  ceilingMicro: number;
  expectedMicro: number;
}

export interface QualificationPlan {
  policyVersion: string;
  cases: QualCase[];
  costs: QualCost[];
  totals: {
    calls: number;
    ceilingMicro: number;
    ceilingWithRetriesMicro: number;
    expectedMicro: number;
    byProviderCeilingWithRetriesMicro: Record<string, number>;
    escalationCeilingWithRetriesMicro: number;
  };
  caps: { hardCapMicro: number; anthropicAllocationMicro: number; openaiAllocationMicro: number; escalationLimitMicro: number; monthlyCapMicro: number };
  checks: { id: string; ok: boolean; detail: string }[];
  ok: boolean;
}

const ESCALATION: readonly string[] = ['claude-opus-5-5', 'claude-fable-5-2'];

function tok(p: QualCase['profile'], fraction: number, uncertain: boolean, firstOfPair: boolean): TokenEstimate {
  return {
    promptTokens: p.promptTokens,
    // 1ª chamada do par grava o prefixo no cache; as demais leem
    cacheWriteTokens: firstOfPair ? p.cacheWriteTokens : 0,
    cacheReadTokens: firstOfPair ? 0 : p.cacheReadTokens,
    maxOutputTokens: Math.round(p.maxOutputTokens * fraction),
    uncertain,
  };
}

export function buildQualificationPlan(policy: ModelPolicy, cases: readonly QualCase[] = QUAL_CASES): QualificationPlan {
  const byId = new Map<string, ModelEntry>(policy.models.map((m) => [m.id, m]));
  const costs: QualCost[] = [];
  const unknown: string[] = [];
  for (const c of cases) {
    for (const mid of c.models) {
      const m = byId.get(mid);
      const calls = c.runsPerModel * c.callsPerRun;
      let ceiling = 0;
      let expected = 0;
      for (let i = 0; i < c.callsPerRun; i++) {
        const first = c.callsPerRun > 1 ? i === 0 : false;
        // sem par de cache: toda chamada lê o cache estável (premissa do plano de custo)
        const profile = c.callsPerRun > 1 ? c.profile : { ...c.profile, cacheWriteTokens: 0 };
        const worst = m ? estimateMicro(m, tok(profile, 1, true, first)) : null;
        const exp = m ? estimateMicro(m, tok(profile, 0.6, false, first)) : null;
        if (worst === null || exp === null) {
          unknown.push(`${c.id}/${mid}`);
          continue;
        }
        ceiling += worst * c.runsPerModel;
        expected += exp * c.runsPerModel;
      }
      costs.push({ caseId: c.id, model: mid, provider: m?.provider ?? 'unknown', calls, ceilingMicro: ceiling, expectedMicro: expected });
    }
  }
  const retry = 1 + QUAL_BUDGET_PROPOSAL.retryAllowance;
  const sum = (f: (c: QualCost) => number) => costs.reduce((s, c) => s + f(c), 0);
  const byProvider: Record<string, number> = {};
  for (const c of costs) byProvider[c.provider] = (byProvider[c.provider] ?? 0) + Math.ceil(c.ceilingMicro * retry);
  const totals = {
    calls: sum((c) => c.calls),
    ceilingMicro: sum((c) => c.ceilingMicro),
    ceilingWithRetriesMicro: Math.ceil(sum((c) => c.ceilingMicro) * retry),
    expectedMicro: sum((c) => c.expectedMicro),
    byProviderCeilingWithRetriesMicro: byProvider,
    escalationCeilingWithRetriesMicro: Math.ceil(costs.filter((c) => ESCALATION.includes(c.model)).reduce((s, c) => s + c.ceilingMicro, 0) * retry),
  };
  const alloc = policy.rules.budget_allocation_usd;
  const caps = {
    hardCapMicro: usdToMicro(QUAL_BUDGET_PROPOSAL.hardCapUsd),
    anthropicAllocationMicro: usdToMicro(alloc.anthropic),
    openaiAllocationMicro: usdToMicro(alloc.openai),
    escalationLimitMicro: Math.floor(usdToMicro(alloc.anthropic_escalation_opus_fable_included) * QUAL_BUDGET_PROPOSAL.escalationShareOfSublimit),
    monthlyCapMicro: usdToMicro(policy.rules.hard_monthly_budget_usd),
  };
  const checks = [
    { id: 'no_unknown_cost', ok: unknown.length === 0 && !('unknown' in byProvider), detail: unknown.length ? `preço/modelo ausente: ${unknown.join(', ')}` : 'todo modelo do protocolo tem ID e preço na política' },
    { id: 'qualification_cap', ok: totals.ceilingWithRetriesMicro <= caps.hardCapMicro, detail: `teto com reexecuções ${totals.ceilingWithRetriesMicro} <= teto proposto ${caps.hardCapMicro} micro-USD` },
    { id: 'within_monthly_cap', ok: totals.ceilingWithRetriesMicro <= caps.monthlyCapMicro, detail: 'cabe no teto mensal de US$ 50 (a qualificação consome o teto do mês em que roda)' },
    { id: 'anthropic_allocation', ok: (byProvider.anthropic ?? 0) <= caps.anthropicAllocationMicro, detail: `anthropic ${byProvider.anthropic ?? 0} <= ${caps.anthropicAllocationMicro}` },
    { id: 'openai_allocation', ok: (byProvider.openai ?? 0) <= caps.openaiAllocationMicro, detail: `openai ${byProvider.openai ?? 0} <= ${caps.openaiAllocationMicro}` },
    { id: 'opus_escalation_share', ok: totals.escalationCeilingWithRetriesMicro <= caps.escalationLimitMicro, detail: `Opus ${totals.escalationCeilingWithRetriesMicro} <= ${caps.escalationLimitMicro} (20% do sublimite de US$ 5)` },
    { id: 'no_fable_no_deepseek_no_images', ok: !costs.some((c) => c.model === 'claude-fable-5-2' || c.provider === 'deepseek') && !cases.some((c) => c.role.startsWith('image')), detail: 'Fable (sem ZDR listado), DeepSeek e imagens (verba zero) fora da qualificação' },
    { id: 'audit_reserve_untouched', ok: !QUAL_BUDGET_PROPOSAL.usesAuditReserve, detail: 'a reserva de US$ 8 é só de auditoria e errata' },
    { id: 'public_data_only', ok: cases.every((c) => c.dataClass === 'public'), detail: 'toda entrada é classe public (publicada, sintética ou sanitizada); nenhum dado pessoal, embargado ou confidencial' },
  ];
  return { policyVersion: policy.version, cases: [...cases], costs, totals, caps, checks, ok: checks.every((c) => c.ok) };
}

// --- avaliação dos resultados (usada quando a qualificação for autorizada) ---------------------------------------------

export interface UsageInfo {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  costUsd: number | null;
}

export interface Verdict {
  criterion: string;
  status: 'pass' | 'fail' | 'inconclusive';
  detail: string;
}

const v = (criterion: string, status: Verdict['status'], detail: string): Verdict => ({ criterion, status, detail });

/** QC-CACHE-HIT: em cada par, a 2ª chamada precisa de cached_tokens > 0. */
export function evalCacheHit(pairs: readonly { first: UsageInfo; second: UsageInfo }[], requiredPairs = 5): Verdict {
  if (pairs.length < requiredPairs) return v('QC-CACHE-HIT', 'inconclusive', `${pairs.length} pares < ${requiredPairs}`);
  const misses = pairs.filter((p) => !(p.second.cachedTokens > 0));
  return misses.length === 0
    ? v('QC-CACHE-HIT', 'pass', `cached_tokens > 0 em ${pairs.length} de ${pairs.length} pares`)
    : v('QC-CACHE-HIT', 'fail', `${misses.length} de ${pairs.length} pares sem cached_tokens na 2ª chamada: a rota deve parar (cache_failure)`);
}

/** QC-COST: custo informado vs preço de lista × tokens, e nunca acima da reserva. */
export function evalCost(calls: readonly { usage: UsageInfo; expectedMicro: number; reservedMicro: number }[], tolerance = 0.1): Verdict {
  if (calls.length === 0) return v('QC-COST', 'inconclusive', 'sem chamadas');
  if (calls.some((c) => c.usage.costUsd === null)) return v('QC-COST', 'fail', 'chamada sem custo informado (custo desconhecido bloqueia)');
  const over = calls.filter((c) => usdToMicro(c.usage.costUsd as number) > c.reservedMicro);
  if (over.length) return v('QC-COST', 'fail', `${over.length} chamada(s) acima da reserva`);
  const worst = Math.max(...calls.map((c) => Math.abs(usdToMicro(c.usage.costUsd as number) - c.expectedMicro) / Math.max(c.expectedMicro, 1)));
  return worst <= tolerance ? v('QC-COST', 'pass', `desvio máximo ${(worst * 100).toFixed(1)}% <= ${(tolerance * 100).toFixed(0)}%`) : v('QC-COST', 'fail', `desvio máximo ${(worst * 100).toFixed(1)}% > ${(tolerance * 100).toFixed(0)}%`);
}

/** Autor = prefixo de `generation.model` (não o provedor de hospedagem). */
export const authorOf = (generationModel: string): string => generationModel.split('/')[0] ?? '';

export function evalDistinctAuthor(pairs: readonly { draftGenerationModel: string; checkGenerationModel: string }[], criterion: 'QC-DISTINCT-AUTHOR' | 'QC-DISTINCT-AUTHOR-GATE' = 'QC-DISTINCT-AUTHOR'): Verdict {
  if (pairs.length === 0) return v(criterion, 'inconclusive', 'sem pares');
  const same = pairs.filter((p) => !authorOf(p.draftGenerationModel) || authorOf(p.draftGenerationModel) === authorOf(p.checkGenerationModel));
  return same.length === 0 ? v(criterion, 'pass', `${pairs.length} de ${pairs.length} pares com autor distinto`) : v(criterion, 'fail', `${same.length} par(es) com o mesmo autor ou autor desconhecido: deveria bloquear`);
}

/** QC-ZDR: o provedor que atendeu precisa estar na lista de endpoints ZDR do modelo. */
export function evalZdr(calls: readonly { openrouterModel: string; providerName: string; zdrRequested: boolean }[], zdrEndpoints: ReadonlyMap<string, ReadonlySet<string>>): Verdict {
  if (calls.length === 0) return v('QC-ZDR', 'inconclusive', 'sem chamadas');
  const bad = calls.filter((c) => !c.zdrRequested || !(zdrEndpoints.get(c.openrouterModel)?.has(c.providerName) ?? false));
  return bad.length === 0 ? v('QC-ZDR', 'pass', `${calls.length} de ${calls.length} chamadas em endpoint ZDR listado`) : v('QC-ZDR', 'fail', `${bad.length} chamada(s) sem zdr solicitado ou em provedor fora da lista`);
}

export function evalSchema(outputs: readonly unknown[], profile: AgentProfile, minRate = 0.95): Verdict {
  if (outputs.length === 0) return v('QC-SCHEMA', 'inconclusive', 'sem saídas');
  const valid = outputs.filter((o) => validateAgentOutput(profile, o).ok).length;
  const rate = valid / outputs.length;
  return rate >= minRate ? v('QC-SCHEMA', 'pass', `${valid}/${outputs.length} válidas (${(rate * 100).toFixed(1)}%)`) : v('QC-SCHEMA', 'fail', `${valid}/${outputs.length} válidas (${(rate * 100).toFixed(1)}%) < ${(minRate * 100).toFixed(0)}%`);
}

/** QC-SEEDED-RECALL e QC-FALSE-POSITIVE sobre erros plantados. `critical` = ids de erros críticos que não podem ser perdidos. */
export function evalSeededErrors(items: readonly { seeded: readonly string[]; flagged: readonly string[]; critical?: readonly string[] }[], minRecall = 0.9, maxFalsePositive = 0.2): Verdict[] {
  const dirty = items.filter((i) => i.seeded.length > 0);
  const clean = items.filter((i) => i.seeded.length === 0);
  const out: Verdict[] = [];
  if (dirty.length === 0) out.push(v('QC-SEEDED-RECALL', 'inconclusive', 'sem itens com erro plantado'));
  else {
    const total = dirty.reduce((s, i) => s + i.seeded.length, 0);
    const found = dirty.reduce((s, i) => s + i.seeded.filter((e) => i.flagged.includes(e)).length, 0);
    const missedCritical = dirty.flatMap((i) => (i.critical ?? []).filter((e) => !i.flagged.includes(e)));
    const recall = found / total;
    out.push(recall >= minRecall && missedCritical.length === 0 ? v('QC-SEEDED-RECALL', 'pass', `recall ${(recall * 100).toFixed(1)}% (${found}/${total}), nenhum crítico perdido`) : v('QC-SEEDED-RECALL', 'fail', `recall ${(recall * 100).toFixed(1)}% (${found}/${total}); críticos perdidos: ${missedCritical.length}`));
  }
  if (clean.length === 0) out.push(v('QC-FALSE-POSITIVE', 'inconclusive', 'sem itens limpos'));
  else {
    const fp = clean.filter((i) => i.flagged.length > 0).length / clean.length;
    out.push(fp <= maxFalsePositive ? v('QC-FALSE-POSITIVE', 'pass', `falso positivo ${(fp * 100).toFixed(1)}%`) : v('QC-FALSE-POSITIVE', 'fail', `falso positivo ${(fp * 100).toFixed(1)}% > ${(maxFalsePositive * 100).toFixed(0)}%`));
  }
  return out;
}

/** Um modelo só é qualificado se TODOS os critérios aplicáveis passarem; qualquer 'inconclusive' impede a aprovação. */
export function decide(modelId: string, verdicts: readonly Verdict[]): { qualified: boolean; missing: string[]; failed: string[]; inconclusive: string[] } {
  const required = criteriaFor(modelId);
  const byId = new Map(verdicts.map((x) => [x.criterion, x]));
  const missing = required.filter((c) => !byId.has(c));
  const failed = required.filter((c) => byId.get(c)?.status === 'fail');
  const inconclusive = required.filter((c) => byId.get(c)?.status === 'inconclusive');
  return { qualified: missing.length === 0 && failed.length === 0 && inconclusive.length === 0, missing, failed, inconclusive };
}
