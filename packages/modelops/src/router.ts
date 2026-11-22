// Roteador por tarefa e classe de dado. Decide o modelo primário e os fallbacks laterais, ou bloqueia (falha fechada).
// Não chama nada: só decide. Quem reserva orçamento e chama o provedor é o gateway.
import type { DataClass, ModelEntry, ModelPolicy, TaskClass } from './types';
import { DATA_CLASS_ORDER } from './types';
import type { Lane } from './ledger';

export interface TaskSpec {
  route: string; // rota de routing_by_task, ou 'deterministic'
  taskClass: TaskClass;
  lane: Lane;
  // Tarefas de revisão exigem autor de modelo diferente do redator (fact-check).
  requiresDistinctAuthor: boolean;
}

// Catálogo de tarefas. Rotas vêm da política; classes e exceções de ritual vêm de ADR-015.
// WF08/WF18/auditoria não estão mapeadas na política v4: mapeadas para 'review' com classe reserva. A confirmar pelo Chief Architect.
export const TASK_CATALOG: Record<string, TaskSpec> = {
  editorial_draft: { route: 'economy', taskClass: 'essential', lane: 'text', requiresDistinctAuthor: false },
  fact_check: { route: 'review', taskClass: 'essential', lane: 'text', requiresDistinctAuthor: true },
  classification: { route: 'economy', taskClass: 'non_essential', lane: 'text', requiresDistinctAuthor: false },
  daily: { route: 'economy', taskClass: 'non_essential', lane: 'text', requiresDistinctAuthor: false },
  entity_resolution: { route: 'economy', taskClass: 'non_essential', lane: 'text', requiresDistinctAuthor: false },
  monthly_board: { route: 'strategic', taskClass: 'premium', lane: 'text', requiresDistinctAuthor: false },
  complex_analysis: { route: 'premium', taskClass: 'premium', lane: 'text', requiresDistinctAuthor: false },
  concept_image: { route: 'image_fast', taskClass: 'premium', lane: 'image', requiresDistinctAuthor: false },
  source_ingestion: { route: 'deterministic', taskClass: 'non_essential', lane: 'text', requiresDistinctAuthor: false },
  creative_composition: { route: 'deterministic', taskClass: 'non_essential', lane: 'text', requiresDistinctAuthor: false },
  social_publish: { route: 'deterministic', taskClass: 'essential', lane: 'text', requiresDistinctAuthor: false },
  'WF08 correction': { route: 'review', taskClass: 'reserve', lane: 'text', requiresDistinctAuthor: true },
  'WF18 response/retraction': { route: 'review', taskClass: 'reserve', lane: 'text', requiresDistinctAuthor: true },
  'postpublication audit/unpublish': { route: 'review', taskClass: 'reserve', lane: 'text', requiresDistinctAuthor: true },
};

// Rituais que continuam até o degrau 42 (ADR-015). Os demais são não essenciais.
export const ESSENTIAL_RITUALS: readonly string[] = ['D-editorial', 'D-trust', 'D-sync', 'X-incident'];

// Modelos que contam como escalonamento (Opus/Fable): exigem motivo e sublimite.
const ESCALATION_MODELS: readonly string[] = ['claude-opus-5-5', 'claude-fable-5-2'];

export function isEscalation(modelId: string, taskClass: TaskClass): boolean {
  return ESCALATION_MODELS.includes(modelId) && taskClass !== 'reserve';
}

export interface RouteRequest {
  task: string;
  dataClasses: readonly string[]; // classe de cada entrada; a mais restrita vale
  unpublished: boolean; // trabalho editorial não publicado exige ZDR
  draftModelId?: string; // modelo que redigiu (para fact-check)
  ritualId?: string;
  escalationReason?: string;
  escalationsSoFar?: number;
  mode: 'production' | 'simulation';
  qualifiedModelIds: readonly string[]; // qualificação R2-07/08; vazio por padrão
  zdrVerifiedModelIds: readonly string[]; // ZDR confirmado por modelo; vazio por padrão
  now: Date;
  killGlobal?: boolean;
  killedRoutes?: readonly string[];
}

export type RouteDecision =
  | { status: 'deterministic'; route: string; taskClass: TaskClass }
  | {
      status: 'eligible';
      route: string;
      taskClass: TaskClass;
      lane: Lane;
      primary: string;
      fallbacks: string[];
      escalation: boolean;
      reasons: Record<string, string[]>;
    }
  | { status: 'blocked'; reason: string; detail: string; reasons?: Record<string, string[]> };

const blocked = (reason: string, detail: string): RouteDecision => ({ status: 'blocked', reason, detail });

// Autor do modelo: prefixo de provedor do identificador (ex.: "anthropic/claude-sonnet-5.5" -> anthropic).
function authorOf(modelId: string): string {
  return (modelId.split('/')[0] ?? '').trim();
}

// Classe de saída = a mais restrita entre todas as entradas. Qualquer classe desconhecida bloqueia.
function mostRestrictive(classes: readonly string[]): DataClass | null {
  if (classes.length === 0) return null;
  let worst = 0;
  for (const c of classes) {
    const i = DATA_CLASS_ORDER.indexOf(c as DataClass);
    if (i < 0) return null;
    worst = Math.max(worst, i);
  }
  return DATA_CLASS_ORDER[worst] ?? null;
}

// Verba do provedor, lida de forma tipada (openai, anthropic, deepseek). Provedor desconhecido: sem verba.
function allocationFor(policy: ModelPolicy, provider: string): number | undefined {
  const a = policy.rules.budget_allocation_usd;
  if (provider === 'anthropic') return a.anthropic;
  if (provider === 'openai') return a.openai;
  if (provider === 'deepseek') return a.deepseek;
  return undefined;
}

export function route(policy: ModelPolicy, req: RouteRequest): RouteDecision {
  // 1. Kill switch global e por rota (emergency_stop).
  if (req.killGlobal) return blocked('kill_global', 'parada global ativa');

  // 2. Tarefa conhecida.
  const spec = TASK_CATALOG[req.task];
  if (!spec) return blocked('unknown_task', `tarefa sem mapeamento: ${req.task}`);
  if (req.killedRoutes?.includes(spec.route)) return blocked('kill_route', `rota ${spec.route} parada`);

  // 3. Classe de dado: só classe pública vai ao OpenRouter (DP-11/P1).
  const worst = mostRestrictive(req.dataClasses);
  if (worst === null) return blocked('unknown_class', 'classe de dado ausente ou desconhecida');
  if (worst !== 'public') {
    const reason = worst === 'personal' ? 'personal_no_approved_processor' : 'data_class_not_approved';
    return blocked(reason, `classe ${worst} não aprovada no processador`);
  }

  // 4. Tarefa determinística: sem modelo, sem orçamento.
  if (spec.route === 'deterministic') {
    return { status: 'deterministic', route: 'deterministic', taskClass: spec.taskClass };
  }

  // 5. Degraus de ritual: rituais essenciais sobem para a classe essencial.
  let taskClass = spec.taskClass;
  if (req.task === 'daily' && req.ritualId && ESSENTIAL_RITUALS.includes(req.ritualId)) {
    taskClass = 'essential';
  }

  const candidates = policy.routes[spec.route] ?? [];
  if (candidates.length === 0) return blocked('no_candidates', `rota ${spec.route} vazia`);

  // 6. Produção desligada: nenhuma chamada sai, mesmo com candidatos elegíveis.
  if (req.mode === 'production' && policy.rules.production_enabled !== true) {
    return blocked('production_disabled', 'production_enabled = false na política');
  }

  // 7. Avaliação de cada candidato. Motivos ficam registrados para auditoria.
  const maxAttempts = policy.rules.max_attempts;
  const reasons: Record<string, string[]> = {};
  const eligible: { id: string; escalation: boolean }[] = [];

  // Fact-check sem autor do redator: falha fechada.
  if (spec.requiresDistinctAuthor && !req.draftModelId) {
    return blocked('draft_author_unknown', 'revisão exige o modelo que redigiu');
  }
  const draftAuthor = req.draftModelId ? authorOf(req.draftModelId) : undefined;

  for (const id of candidates) {
    const model: ModelEntry | undefined = policy.models.find((m) => m.id === id);
    const why: string[] = [];
    if (!model) {
      reasons[id] = ['modelo_desconhecido'];
      continue;
    }

    if (model.allowed_tasks && !model.allowed_tasks.includes(req.task)) why.push('task_not_allowed');

    if (!req.qualifiedModelIds.includes(id)) why.push('not_qualified');

    const providerAlloc = allocationFor(policy, model.provider);
    if (providerAlloc === undefined || providerAlloc === 0) why.push('zero_allocation');

    if (!model.binding) {
      why.push('no_price');
    } else {
      const asOf = Date.parse(model.binding.price_as_of);
      const ageDays = (req.now.getTime() - asOf) / 86_400_000;
      if (!(ageDays <= policy.rules.price_expiry_days)) why.push('price_expired');
    }

    const zdrRequired = req.unpublished && taskClass === 'essential' && spec.route !== 'deterministic';
    if (zdrRequired && !req.zdrVerifiedModelIds.includes(id)) why.push('zdr_unverified');

    // Autor = provedor do modelo, comparado com o prefixo do modelo que redigiu.
    if (spec.requiresDistinctAuthor && draftAuthor !== undefined && model.provider === draftAuthor) {
      why.push('same_author_as_draft');
    }

    const escalation = isEscalation(id, taskClass);
    if (escalation) {
      if (!req.escalationReason) why.push('escalation_reason_missing');
      if ((req.escalationsSoFar ?? 0) >= policy.rules.max_escalations) why.push('max_escalations');
    }

    reasons[id] = why.length === 0 ? ['eligible'] : why;
    if (why.length === 0) eligible.push({ id, escalation });
  }

  if (eligible.length === 0) {
    return { status: 'blocked', reason: 'no_eligible_candidate', detail: 'nenhum candidato elegível', reasons };
  }

  // 8. Limite de tentativas (max_attempts): primário mais fallbacks laterais da mesma classe.
  const chosen = eligible.slice(0, maxAttempts);
  const primary = chosen[0];
  if (!primary) {
    return { status: 'blocked', reason: 'no_eligible_candidate', detail: 'nenhum candidato elegível', reasons };
  }

  return {
    status: 'eligible',
    route: spec.route,
    taskClass,
    lane: spec.lane,
    primary: primary.id,
    fallbacks: chosen.slice(1).map((c) => c.id),
    escalation: primary.escalation,
    reasons,
  };
}
