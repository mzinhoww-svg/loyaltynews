/**
 * Redesenho de custo por matéria (DP-27): quanto custa publicar uma matéria em cada combinação de execução e quantas
 * matérias por dia cabem no teto de US$ 50 em APIs tarifadas. Modelo PARAMÉTRICO e determinístico: sem chamadas, sem rede.
 *
 * ATENÇÃO — os perfis de tokens por etapa e as frações de economia (determinístico, amostragem) são PREMISSAS da Frente 07,
 * não medições; os limites de uso das assinaturas (Claude, Codex) NÃO foram verificados. O modelo diz quanto de uso cada
 * cenário exige; comparar com o limite real do plano é conferência a fazer (ver `SUBSCRIPTION_LIMITS_UNVERIFIED`).
 * Preços e IDs vêm da política de modelos (`@ln/modelops`).
 */
import { estimateMicro, usdToMicro, type ModelEntry, type ModelPolicy } from '@ln/modelops';

export interface StepProfile {
  promptTokens: number;
  cacheReadTokens: number;
  maxOutputTokens: number;
}

export interface StepDef {
  id: string;
  label: string;
  /** chamadas por matéria publicada (ex.: triagem de ~6 itens de fonte por matéria) */
  callsPerArticle: number;
  profile: StepProfile;
  /** modelo da API tarifada quando a etapa roda nela */
  apiModel: 'claude-haiku-5-5' | 'claude-sonnet-5-5' | 'openai-text-review';
  /** na via OpenBot: qual assinatura executa (a verificação independente exige AUTOR diferente do redator) */
  lane: 'claude' | 'codex' | 'any';
  /** fração das chamadas que um passo determinístico elimina (coleta, dedupe, whitelist de fontes, formatação) */
  deterministicShare: number;
  /** a etapa só pode sair da API se houver evidência independente (auditoria pós-publicação, verificador) */
  apiOnly?: boolean;
  /** fração das matérias que passa por esta etapa (auditoria por amostragem) */
  coverage?: number;
}

/** Etapas por matéria, de WF01–WF04/WF06 e da política v5 (rota economy/review). Perfis de token: PREMISSAS. */
export const STEPS: StepDef[] = [
  { id: 'triage', label: 'Triagem/relevância dos itens de fonte (WF01)', callsPerArticle: 6, profile: { promptTokens: 800, cacheReadTokens: 2_000, maxOutputTokens: 150 }, apiModel: 'claude-haiku-5-5', lane: 'any', deterministicShare: 0.7 },
  { id: 'draft', label: 'Redação (writer_*; WF02)', callsPerArticle: 1, profile: { promptTokens: 2_500, cacheReadTokens: 6_000, maxOutputTokens: 1_800 }, apiModel: 'claude-haiku-5-5', lane: 'claude', deterministicShare: 0 },
  { id: 'rights', label: 'Direitos e fontes (rights; WF02)', callsPerArticle: 1, profile: { promptTokens: 1_500, cacheReadTokens: 4_000, maxOutputTokens: 400 }, apiModel: 'claude-haiku-5-5', lane: 'any', deterministicShare: 0.8 },
  { id: 'factcheck', label: 'Checagem de fatos em autor distinto (factcheck; WF02)', callsPerArticle: 1, profile: { promptTokens: 4_000, cacheReadTokens: 5_000, maxOutputTokens: 1_200 }, apiModel: 'openai-text-review', lane: 'codex', deterministicShare: 0 },
  { id: 'review', label: 'Revisão independente do editor (gate WF02)', callsPerArticle: 1, profile: { promptTokens: 4_000, cacheReadTokens: 5_000, maxOutputTokens: 1_000 }, apiModel: 'openai-text-review', lane: 'codex', deterministicShare: 0 },
  { id: 'social', label: 'Pacote social: texto de LinkedIn (WF04)', callsPerArticle: 1, profile: { promptTokens: 1_500, cacheReadTokens: 3_000, maxOutputTokens: 600 }, apiModel: 'claude-haiku-5-5', lane: 'any', deterministicShare: 0 },
  { id: 'entity', label: 'Entidades e relações a partir de fonte pública (WF06)', callsPerArticle: 1, profile: { promptTokens: 2_500, cacheReadTokens: 4_000, maxOutputTokens: 700 }, apiModel: 'claude-haiku-5-5', lane: 'any', deterministicShare: 0 },
  { id: 'audit', label: 'Auditoria pós-publicação por amostragem (reserva de auditoria)', callsPerArticle: 1, profile: { promptTokens: 5_000, cacheReadTokens: 4_000, maxOutputTokens: 1_500 }, apiModel: 'openai-text-review', lane: 'codex', deterministicShare: 0, apiOnly: true, coverage: 0.1 },
];

export type Executor = 'api' | 'openbot' | 'free' | 'deterministic';

export interface Combo {
  id: string;
  title: string;
  /** por etapa: onde roda */
  executors: Record<string, Executor>;
  /** `true`: passos determinísticos eliminam parte das chamadas (deterministicShare) */
  deterministic: boolean;
  /** fração das matérias que recebe checagem de fatos por MODELO (o resto: só checagem determinística de números/fontes) */
  factcheckSample: number;
  /** nas matérias de baixo risco, checagem e revisão viram uma chamada única */
  mergeCheckAndReview: boolean;
  /** fator sobre o prompt de entrada (prompts menores, evidência empacotada) */
  promptScale: number;
  /** `true`: o cache de prompt funciona (política: obrigatório); `false`: o cache falha e a leitura cobra como entrada */
  cacheWorks: boolean;
  /** rituais: onde rodam */
  rituals: 'api' | 'openbot' | 'api_digest';
}

const allApi: Record<string, Executor> = Object.fromEntries(STEPS.map((s) => [s.id, 'api']));
const openbotMain: Record<string, Executor> = { ...Object.fromEntries(STEPS.map((s) => [s.id, 'openbot'])), audit: 'api' };

export const COMBOS: Combo[] = [
  { id: 'A', title: 'A. Base DP-26: tudo na API tarifada (como no desenho atual)', executors: allApi, deterministic: false, factcheckSample: 1, mergeCheckAndReview: false, promptScale: 1, cacheWorks: true, rituals: 'api' },
  { id: 'A0', title: 'A0. Base DP-26 com falha de cache (referência de risco)', executors: allApi, deterministic: false, factcheckSample: 1, mergeCheckAndReview: false, promptScale: 1, cacheWorks: false, rituals: 'api' },
  { id: 'B', title: 'B. OpenBot nas assinaturas como via principal (DP-27); API só na auditoria', executors: openbotMain, deterministic: false, factcheckSample: 1, mergeCheckAndReview: false, promptScale: 1, cacheWorks: true, rituals: 'openbot' },
  { id: 'C', title: 'C. B + etapas determinísticas no lugar de modelo (coleta, dedupe, whitelist de fontes, números/fontes)', executors: openbotMain, deterministic: true, factcheckSample: 1, mergeCheckAndReview: false, promptScale: 1, cacheWorks: true, rituals: 'openbot' },
  { id: 'D', title: 'D. B + checagem de fatos por modelo só nas de maior risco (30%)', executors: openbotMain, deterministic: false, factcheckSample: 0.3, mergeCheckAndReview: true, promptScale: 1, cacheWorks: true, rituals: 'openbot' },
  { id: 'E', title: 'E. Só API, otimizada: determinístico + amostragem + prompts 25% menores + digest nos rituais', executors: allApi, deterministic: true, factcheckSample: 0.3, mergeCheckAndReview: true, promptScale: 0.75, cacheWorks: true, rituals: 'api_digest' },
  { id: 'F', title: 'F. C + modelos gratuitos (OpenCode free) em triagem, social e entidades (qualidade NÃO verificada)', executors: { ...openbotMain, triage: 'free', social: 'free', entity: 'free' }, deterministic: true, factcheckSample: 1, mergeCheckAndReview: false, promptScale: 1, cacheWorks: true, rituals: 'openbot' },
  { id: 'G', title: 'G. RECOMENDADA: OpenBot principal + determinístico + checagem por risco + prompts menores; API só auditoria, verificador e excedente', executors: openbotMain, deterministic: true, factcheckSample: 0.3, mergeCheckAndReview: true, promptScale: 0.75, cacheWorks: true, rituals: 'openbot' },
];

export const SCENARIOS = [15, 30, 60] as const;
export const BUSINESS_DAYS_PER_MONTH = 22;

/** Limites das assinaturas: NÃO verificados. O modelo só calcula a demanda; o limite real vem do plano contratado. */
export const SUBSCRIPTION_LIMITS_UNVERIFIED = {
  claude: 'limite de uso do plano Claude contratado (janelas de uso e teto semanal): NÃO verificado',
  codex: 'limite de uso do plano Codex contratado (janelas de uso e teto semanal): NÃO verificado',
  free: 'limites e política de dados dos modelos gratuitos (OpenCode free): NÃO verificados',
} as const;

export interface StepCost {
  step: string;
  executor: Executor;
  callsPerArticle: number;
  apiMicroPerArticle: number;
  /** tokens (entrada + cache + saída) por matéria na via OpenBot ou gratuita */
  subscriptionTokensPerArticle: number;
  lane: StepDef['lane'];
}

export interface ComboCost {
  combo: Combo;
  steps: StepCost[];
  /** custo da API tarifada por matéria (esperado) */
  apiMicroPerArticle: number;
  subscriptionTokensPerArticle: { claude: number; codex: number; any: number; free: number };
  subscriptionCallsPerArticle: number;
  /** custo mensal fixo na API (rituais, verificador) que não depende do volume */
  fixedMonthlyApiMicro: number;
  scenarios: Record<number, { articlesPerMonth: number; apiMonthlyMicro: number; fits: boolean; subscriptionTokensPerDay: { claude: number; codex: number; any: number; free: number } }>;
  /** matérias por dia útil que cabem em US$ 50 só com a API (considerando o custo fixo); infinito se a API não escala com o volume */
  maxArticlesPerDayWithinCap: number | null;
}

const EXPECTED_OUTPUT_FRACTION = 0.6;

function apiCostMicro(model: ModelEntry, p: StepProfile, scale: number, cacheWorks: boolean): number | null {
  const prompt = Math.round(p.promptTokens * scale);
  const cache = Math.round(p.cacheReadTokens * scale);
  return estimateMicro(model, {
    promptTokens: cacheWorks ? prompt : prompt + cache,
    cacheWriteTokens: 0,
    cacheReadTokens: cacheWorks ? cache : 0,
    maxOutputTokens: Math.round(p.maxOutputTokens * EXPECTED_OUTPUT_FRACTION),
    uncertain: false,
  });
}

/** Custo fixo mensal na API (US$): rituais e aceites do verificador (≈ US$ 0,50 informado pelo PM). */
export function fixedMonthlyApiMicro(rituals: Combo['rituals'], ritualCostsMicro: { api: number; api_digest: number }): number {
  const verifier = usdToMicro(0.5);
  if (rituals === 'openbot') return verifier;
  return verifier + (rituals === 'api_digest' ? ritualCostsMicro.api_digest : ritualCostsMicro.api);
}

export function costCombo(combo: Combo, policy: ModelPolicy, ritualCostsMicro: { api: number; api_digest: number }): ComboCost {
  const models = new Map(policy.models.map((m) => [m.id, m]));
  const steps: StepCost[] = [];
  let apiMicro = 0;
  let callsOpenbot = 0;
  const tokens = { claude: 0, codex: 0, any: 0, free: 0 };
  for (const s of STEPS) {
    const executor = combo.executors[s.id] ?? 'api';
    let calls = s.callsPerArticle * (s.coverage ?? 1);
    if (combo.deterministic) calls *= 1 - s.deterministicShare;
    if (s.id === 'factcheck') calls *= combo.factcheckSample;
    // com checagem+revisão fundidas, o revisor das matérias de baixo risco absorve a checagem: 1 chamada em vez de 2
    if (s.id === 'review' && combo.mergeCheckAndReview) calls *= 1; // a revisão continua em 100%; a checagem separada é que cai
    const model = models.get(s.apiModel);
    const perCallApi = model ? apiCostMicro(model, s.profile, combo.promptScale, combo.cacheWorks) : null;
    if (perCallApi === null) throw new Error(`preço ausente para ${s.apiModel}`);
    const tokensPerCall = Math.round((s.profile.promptTokens + s.profile.cacheReadTokens) * combo.promptScale + s.profile.maxOutputTokens * EXPECTED_OUTPUT_FRACTION);
    const effectiveExecutor: Executor = s.apiOnly ? 'api' : executor;
    const api = effectiveExecutor === 'api' ? calls * perCallApi : 0;
    const subTokens = effectiveExecutor === 'openbot' || effectiveExecutor === 'free' ? calls * tokensPerCall : 0;
    if (effectiveExecutor === 'openbot') {
      callsOpenbot += calls;
      tokens[s.lane] += subTokens;
    } else if (effectiveExecutor === 'free') tokens.free += subTokens;
    apiMicro += api;
    steps.push({ step: s.id, executor: effectiveExecutor, callsPerArticle: calls, apiMicroPerArticle: api, subscriptionTokensPerArticle: subTokens, lane: s.lane });
  }
  const fixed = fixedMonthlyApiMicro(combo.rituals, ritualCostsMicro);
  const capMicro = usdToMicro(policy.rules.hard_monthly_budget_usd);
  const scenarios: ComboCost['scenarios'] = {};
  for (const perDay of SCENARIOS) {
    const perMonth = perDay * BUSINESS_DAYS_PER_MONTH;
    const apiMonthly = Math.round(apiMicro * perMonth) + fixed;
    scenarios[perDay] = {
      articlesPerMonth: perMonth,
      apiMonthlyMicro: apiMonthly,
      fits: apiMonthly <= capMicro,
      subscriptionTokensPerDay: { claude: Math.round(tokens.claude * perDay), codex: Math.round(tokens.codex * perDay), any: Math.round(tokens.any * perDay), free: Math.round(tokens.free * perDay) },
    };
  }
  const maxPerDay = apiMicro > 0 ? Math.floor((capMicro - fixed) / (apiMicro * BUSINESS_DAYS_PER_MONTH)) : null;
  return { combo, steps, apiMicroPerArticle: Math.round(apiMicro), subscriptionTokensPerArticle: tokens, subscriptionCallsPerArticle: callsOpenbot, fixedMonthlyApiMicro: fixed, scenarios, maxArticlesPerDayWithinCap: maxPerDay };
}

/**
 * Sensibilidade: por quanto os tokens por matéria podem ser multiplicados (todos os perfis de uma vez) antes de a API
 * estourar o teto. O custo é linear nos tokens (preços lineares), então: escala = (teto - fixo) / (custo por matéria × volume).
 * `null` se a API não paga nada por matéria nessa combinação.
 */
export function breakEvenTokenScale(c: ComboCost, perDay: number, capMicro: number): number | null {
  if (c.apiMicroPerArticle <= 0) return null;
  const vol = perDay * BUSINESS_DAYS_PER_MONTH;
  return Math.max(0, (capMicro - c.fixedMonthlyApiMicro) / (c.apiMicroPerArticle * vol));
}

/** Degraus quando a assinatura bate o limite (desenho proposto; nenhum foi implementado). */
export const LIMIT_LADDER = [
  { level: 1, trigger: 'a assinatura de uma via (Claude ou Codex) devolve limite de uso ou aviso de janela', action: 'o adaptador marca a via como esgotada até o reinício informado e para de despachar a ela; etapas de baixa prioridade (social, entidades, triagem extra) ficam em fila' },
  { level: 2, trigger: 'a via esgotada é a de redação ou a de verificação, e há matéria na fila', action: 'a etapa passa à API tarifada pelo gateway, dentro do orçamento (degraus 35/40/42 da política); a checagem de fatos NUNCA é pulada nem feita pelo mesmo autor do redator' },
  { level: 3, trigger: 'a API também atinge o degrau não essencial (US$ 40) ou o teto', action: 'só o que é essencial continua (redação com checagem independente de matérias de alto risco); o resto espera a próxima janela' },
  { level: 4, trigger: 'não há via disponível para a checagem independente', action: 'falha fechada: a matéria não é publicada; fica em fila com aviso (a publicação pausa, como no ADR-003)' },
] as const;
