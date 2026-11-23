/**
 * Harness de medição de tokens por chamada (R4). SEM chamadas reais: este módulo só
 *  1) monta o prompt de uma chamada de ritual com os dados reais dos perfis e estima o tamanho
 *     (ESTIMATIVA por caracteres, sem tokenizador; serve de linha de base, não de medição);
 *  2) registra amostras de uso devolvidas pelo gateway (campo `usage` do OpenRouter), separando o que é
 *     MEDIDO do que é SIMULADO/ESTIMADO — só amostras medidas calibram premissas;
 *  3) resume (média, p50, p95, máx.) e calibra `RoutingAssumptions`, recalculando o plano de custo.
 * Calibrar exige amostras mínimas por papel; sem elas, mantém as premissas (falha fechada).
 */
import type { AgentProfile, Meeting, ParticipantInput } from './schemas';
import { DEFAULT_ASSUMPTIONS, type CallProfile, type RoutingAssumptions } from './routing-plan';

/** Caracteres por token em PT-BR: valor ESTIMADO (sem tokenizador do provedor); a medição real vem do `usage`. */
export const CHARS_PER_TOKEN_ESTIMATE = 3.6;
export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);

export type CallRole = 'participant_input' | 'chair_synthesis';

export interface PromptSections {
  /** missão, contrato de saída e política de ferramentas: estável, elegível ao cache de prompt */
  system: string;
  /** memória setorial e glossário da editoria: estável dentro do dia, elegível ao cache */
  stableContext: string;
  /** insumos já recebidos e pauta do dia: muda a cada chamada */
  variableContext: string;
  task: string;
}

export interface PromptEstimate {
  sections: PromptSections;
  /** parte estável (system + stableContext), tratada como cache read nas chamadas seguintes */
  cacheReadTokens: number;
  /** parte variável (variableContext + task), entrada sem cache */
  promptTokens: number;
  estimatedBy: 'chars/3.6 (sem tokenizador)';
}

export function buildCallPrompt(input: {
  profile: AgentProfile;
  meeting: Pick<Meeting, 'id' | 'title' | 'purpose' | 'outputs' | 'max_rounds'>;
  role: CallRole;
  /** entradas da memória setorial da editoria (texto) */
  sectorMemory?: readonly string[];
  /** insumos já recebidos (síntese do presidente) */
  participantInputs?: readonly ParticipantInput[];
}): PromptEstimate {
  const { profile, meeting, role } = input;
  const system = [
    `Perfil: ${profile.id} (${profile.name}). Missão: ${profile.mission}`,
    `KPI: ${profile.kpi}. Ferramentas permitidas: ${profile.allowed_tools.join(', ')}. ${profile.tools_policy}`,
    `Contrato de saída (JSON Schema): ${JSON.stringify(profile.output_contract)}`,
  ].join('\n');
  const stableContext = (input.sectorMemory ?? []).join('\n');
  const variableContext = (input.participantInputs ?? []).map((i) => JSON.stringify(i)).join('\n');
  const task =
    role === 'participant_input'
      ? `Ritual ${meeting.id} (${meeting.title}). Objetivo: ${meeting.purpose}. Produza o insumo estruturado do seu papel. Rodadas máximas: ${meeting.max_rounds}.`
      : `Ritual ${meeting.id} (${meeting.title}). Sintetize os insumos, proponha decisões com responsável e prazo. Saídas esperadas: ${meeting.outputs.join('; ')}.`;
  return {
    sections: { system, stableContext, variableContext, task },
    cacheReadTokens: estimateTokens(system) + estimateTokens(stableContext),
    promptTokens: estimateTokens(variableContext) + estimateTokens(task),
    estimatedBy: 'chars/3.6 (sem tokenizador)',
  };
}

// --- amostras de uso --------------------------------------------------------------------------

export interface UsageSample {
  meeting_id: string;
  role: CallRole;
  route: string;
  /** modelo que respondeu (generation.model) */
  model: string;
  generationId: string;
  /** entrada sem cache */
  promptTokens: number;
  cacheReadTokens: number;
  /** o OpenRouter não informa gravação de cache no `usage` do chat: 0 aqui NÃO prova que não houve */
  cacheWriteTokens: number;
  completionTokens: number;
  maxOutputTokens: number;
  costUsd: number | null;
  /** measured = resposta de provedor real com evidência de geração; simulated = cliente SIMULADO; estimated = por caracteres */
  source: 'measured' | 'simulated' | 'estimated';
}

/** Subconjunto de `OpenRouterResponse` de @ln/modelops (estrutura igual; evita depender do gateway aqui). */
export interface UsageResponseLike {
  id?: string;
  model?: string;
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  generation?: { model?: string; provider_name?: string; upstream_id?: string };
}

/** Converte a resposta do gateway em amostra. Resposta sem `usage` numérico não vira amostra (nada é inventado). */
export function sampleFromResponse(resp: UsageResponseLike, ctx: { meeting_id: string; role: CallRole; route: string; maxOutputTokens: number }): UsageSample | null {
  const u = resp.usage;
  if (!u || !Number.isFinite(u.prompt_tokens) || !Number.isFinite(u.completion_tokens)) return null;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const simulated = resp.generation?.provider_name === 'SIMULADO' || (resp.id ?? '').startsWith('sim-');
  const generationId = resp.generation?.upstream_id ?? resp.id;
  if (!generationId) return null; // sem evidência de geração não há medição
  return {
    meeting_id: ctx.meeting_id,
    role: ctx.role,
    route: ctx.route,
    model: resp.generation?.model ?? resp.model ?? 'desconhecido',
    generationId,
    promptTokens: Math.max((u.prompt_tokens as number) - cached, 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
    completionTokens: u.completion_tokens as number,
    maxOutputTokens: ctx.maxOutputTokens,
    costUsd: Number.isFinite(u.cost) ? (u.cost as number) : null,
    source: simulated ? 'simulated' : 'measured',
  };
}

export interface Stat {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(idx, 0)]!;
}

export function stat(values: readonly number[]): Stat {
  const s = [...values].sort((a, b) => a - b);
  const sum = s.reduce((x, y) => x + y, 0);
  return { n: s.length, mean: s.length ? sum / s.length : 0, p50: percentile(s, 0.5), p95: percentile(s, 0.95), max: s.length ? s[s.length - 1]! : 0 };
}

export class UsageRecorder {
  private readonly all: UsageSample[] = [];
  private readonly seen = new Set<string>();

  /** Idempotente por `generationId`; recusa números negativos ou não finitos. */
  record(s: UsageSample): boolean {
    for (const v of [s.promptTokens, s.cacheReadTokens, s.cacheWriteTokens, s.completionTokens, s.maxOutputTokens]) {
      if (!Number.isFinite(v) || v < 0) throw new Error('amostra inválida: tokens devem ser números finitos não negativos');
    }
    if (s.maxOutputTokens === 0) throw new Error('amostra inválida: maxOutputTokens deve ser > 0');
    if (this.seen.has(s.generationId)) return false;
    this.seen.add(s.generationId);
    this.all.push(structuredClone(s));
    return true;
  }
  samples(filter?: Partial<Pick<UsageSample, 'role' | 'route' | 'source' | 'meeting_id'>>): UsageSample[] {
    return this.all.filter((s) => (Object.keys(filter ?? {}) as (keyof typeof filter)[]).every((k) => s[k] === filter![k]));
  }
  /** Só amostras MEDIDAS entram em estatística de calibração. */
  measured(role?: CallRole): UsageSample[] {
    return this.all.filter((s) => s.source === 'measured' && (!role || s.role === role));
  }
}

export interface RoleSummary {
  role: CallRole;
  prompt: Stat;
  cacheRead: Stat;
  completion: Stat;
  outputFractionMean: number;
}

export function summarizeRole(samples: readonly UsageSample[], role: CallRole): RoleSummary {
  const s = samples.filter((x) => x.role === role && x.source === 'measured');
  return {
    role,
    prompt: stat(s.map((x) => x.promptTokens)),
    cacheRead: stat(s.map((x) => x.cacheReadTokens)),
    completion: stat(s.map((x) => x.completionTokens)),
    outputFractionMean: s.length ? s.reduce((a, x) => a + x.completionTokens / x.maxOutputTokens, 0) / s.length : 0,
  };
}

export interface CalibrationOptions {
  /** amostras MEDIDAS mínimas por papel para calibrar (padrão 30) */
  minSamplesPerRole?: number;
  /** margem sobre o máximo observado de saída para o limite max_tokens (padrão 1.25) */
  outputHeadroom?: number;
}

export interface CalibrationResult {
  calibrated: boolean;
  assumptions: RoutingAssumptions;
  reasons: string[];
  summaries: { participant_input: RoleSummary; chair_synthesis: RoleSummary };
}

/**
 * Calibra as premissas do plano de custo com amostras MEDIDAS: entrada sem cache e cache read no p95,
 * limite de saída = máx. observado × margem, fração de saída esperada = média observada.
 * Papel sem amostras suficientes mantém a premissa anterior e entra em `reasons`.
 */
export function calibrateAssumptions(recorder: UsageRecorder, base: RoutingAssumptions = DEFAULT_ASSUMPTIONS, opts: CalibrationOptions = {}): CalibrationResult {
  const min = opts.minSamplesPerRole ?? 30;
  const head = opts.outputHeadroom ?? 1.25;
  const all = recorder.samples();
  const reasons: string[] = [];
  const sp = summarizeRole(all, 'participant_input');
  const sc = summarizeRole(all, 'chair_synthesis');
  const ignored = all.filter((s) => s.source !== 'measured').length;
  if (ignored) reasons.push(`${ignored} amostra(s) simulada(s)/estimada(s) ignorada(s): só medição real calibra`);

  const next: RoutingAssumptions = structuredClone(base);
  let calibrated = false;
  const apply = (sum: RoleSummary, label: string): CallProfile | null => {
    if (sum.prompt.n < min) {
      reasons.push(`${label}: ${sum.prompt.n} amostras medidas < mínimo ${min}; premissa mantida`);
      return null;
    }
    calibrated = true;
    return { promptTokens: Math.ceil(sum.prompt.p95), cacheReadTokens: Math.ceil(sum.cacheRead.p95), maxOutputTokens: Math.ceil(sum.completion.max * head) };
  };
  const p = apply(sp, 'participant_input');
  if (p) next.participantInput = p;
  const c = apply(sc, 'chair_synthesis');
  if (c) next.chairSynthesis = { ...c, extraPromptTokensPerParticipant: 0 }; // o p95 medido já inclui os insumos
  const fractions = [sp, sc].filter((x) => x.prompt.n >= min).map((x) => x.outputFractionMean);
  if (fractions.length) next.expectedOutputFraction = Math.min(1, fractions.reduce((a, b) => a + b, 0) / fractions.length);
  return { calibrated, assumptions: next, reasons, summaries: { participant_input: sp, chair_synthesis: sc } };
}

/** Protocolo de medição de R4 (texto único usado no artefato e no plano de ativação). */
export const MEASUREMENT_PROTOCOL = {
  objective: 'Trocar as premissas de tokens do plano de custo por medição real, sem estourar o teto.',
  preconditions: ['G2 (modelos qualificados) e G4 (ledger persistido) atendidos', 'flag modelosHabilitados ligada somente em staging', 'tudo pelo gateway do LN → OpenRouter (nenhuma chamada direta ao provedor)'],
  sampling: { minSamplesPerRolePerRoute: 30, strata: ['participant_input', 'chair_synthesis'], routes: ['economy', 'review', 'premium', 'strategic'], note: 'rituais premium/strategic têm poucas ocorrências por mês: medir com ocorrências de ensaio em staging, dentro do sublimite de escalonamento' },
  recordedFields: ['generationId', 'model (generation.model)', 'promptTokens (sem cache)', 'cacheReadTokens', 'completionTokens', 'maxOutputTokens', 'cost (usage.cost)'],
  limitations: ['o usage do chat do OpenRouter não informa gravação de cache: o custo de escrita no cache é conciliado por /generation', 'amostras SIMULADAS e estimadas por caracteres nunca calibram'],
  outputs: ['premissas calibradas (p95 de entrada, máx. de saída × 1,25, fração de saída média)', 'plano de custo recalculado e deriva frente às premissas atuais'],
} as const;
