// Carregador e validador da política de modelos. Falha fechada: política inválida não é usada.
import { readFileSync } from 'node:fs';
import { ModelPolicy as ContractModelPolicy, modelCallsAllowed } from '@ln/contracts';
import type { ModelPolicy, PolicyCheck } from './types';

// Gate de chamada real do contrato (production_enabled E flag). O contrato só lê rules.production_enabled;
// o cast cobre apenas a forma do objeto (a política local tem esse campo com o mesmo tipo).
export function realCallsAllowed(policy: { rules: { production_enabled: boolean } }, flagModelosHabilitados: boolean): boolean {
  return modelCallsAllowed(policy as unknown as Pick<ContractModelPolicy, 'rules'>, flagModelosHabilitados);
}

const KNOWN_PROVIDERS = ['anthropic', 'openai', 'deepseek'];

// Tarefas que precisam de rota em routing_by_task (DP-02 v5). A política v4 não as tinha.
const REQUIRED_ROUTING_KEYS = ['wf08_correction', 'wf18_response_retraction', 'postpublication_audit', 'editorial_review'];

// Invariantes de segurança: se qualquer um mudar, a política é rejeitada.
const MUST_BE_TRUE = [
  'block_unknown_cost',
  'prompt_cache_required',
  'monthly_cap_immutable_by_agents',
  'refill_does_not_increment_monthly_cap',
  'cross_provider_independent_review',
  'fact_check_provider_must_differ_from_draft',
];

const STEP_KEYS = ['35', '40', '42', '50'];

const AUDIT_EXCLUSIVE_TASKS = [
  'WF08 correction',
  'WF18 response/retraction',
  'postpublication audit/unpublish',
];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonNeg = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function validatePolicy(raw: unknown): PolicyCheck {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['policy: documento não é objeto'] };

  // Estrutura pelo schema do contrato (@ln/contracts). Depois, as invariantes semânticas abaixo.
  const schema = ContractModelPolicy.safeParse(raw);
  if (!schema.success) {
    return {
      ok: false,
      errors: schema.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
    };
  }

  const rules = isObj(raw.rules) ? raw.rules : undefined;
  if (!rules) errors.push('rules: ausente');

  // Teto e invariantes.
  if (rules) {
    if (rules.hard_monthly_budget_usd !== 50) {
      errors.push('rules.hard_monthly_budget_usd: teto deve ser 50 (DP-04)');
    }
    for (const key of MUST_BE_TRUE) {
      if (rules[key] !== true) errors.push(`rules.${key}: deve ser true`);
    }
    if (typeof rules.production_enabled !== 'boolean') {
      errors.push('rules.production_enabled: deve ser booleano');
    }
    if (rules.fact_check_same_provider_fallback !== false) {
      errors.push('rules.fact_check_same_provider_fallback: deve ser false');
    }
    if (rules.fact_check_no_distinct_provider_available !== 'block (fail closed)') {
      errors.push('rules.fact_check_no_distinct_provider_available: deve ser "block (fail closed)"');
    }
  }

  // Verbas: não negativas e somando o teto com a reserva.
  // Na v4, verbas e degraus ficam dentro de rules (rules.budget_allocation_usd, rules.budget_steps_usd).
  const alloc = rules && isObj(rules.budget_allocation_usd) ? rules.budget_allocation_usd : undefined;
  if (!alloc) {
    errors.push('budget_allocation_usd: ausente');
  } else {
    for (const key of ['openai', 'anthropic', 'images', 'deepseek', 'audit_errata_reserve']) {
      if (!isNonNeg(alloc[key])) errors.push(`budget_allocation_usd.${key}: deve ser número não negativo`);
    }
    if (
      isNonNeg(alloc.openai) &&
      isNonNeg(alloc.anthropic) &&
      isNonNeg(alloc.images) &&
      isNonNeg(alloc.deepseek) &&
      isNonNeg(alloc.audit_errata_reserve)
    ) {
      const total = alloc.openai + alloc.anthropic + alloc.images + alloc.deepseek + alloc.audit_errata_reserve;
      if (total !== 50) errors.push(`budget_allocation_usd: soma ${total} difere do teto 50`);
      const escalation = alloc.anthropic_escalation_opus_fable_included;
      if (!isNonNeg(escalation) || escalation > alloc.anthropic) {
        errors.push('budget_allocation_usd.anthropic_escalation_opus_fable_included: deve caber dentro de anthropic');
      }
    }
  }

  // Degraus em ordem crescente, terminando no teto.
  const steps = rules && isObj(rules.budget_steps_usd) ? rules.budget_steps_usd : undefined;
  if (!steps) {
    errors.push('budget_steps_usd: ausente');
  } else {
    const keys = Object.keys(steps);
    if (keys.join(',') !== STEP_KEYS.join(',')) {
      errors.push(`budget_steps_usd: chaves devem ser ${STEP_KEYS.join(', ')} nesta ordem`);
    }
    const numeric = keys.map((k) => Number(k));
    for (let i = 1; i < numeric.length; i++) {
      if (!((numeric[i] ?? 0) > (numeric[i - 1] ?? 0))) errors.push('budget_steps_usd: degraus fora de ordem crescente');
    }
  }

  // Modelos.
  const models = Array.isArray(raw.models) ? raw.models : undefined;
  const ids = new Set<string>();
  if (!models) {
    errors.push('models: ausente');
  } else {
    for (const m of models) {
      if (!isObj(m) || typeof m.id !== 'string') {
        errors.push('models: entrada sem id');
        continue;
      }
      if (ids.has(m.id)) errors.push(`models: id duplicado ${m.id}`);
      ids.add(m.id);
      if (typeof m.provider !== 'string' || !KNOWN_PROVIDERS.includes(m.provider)) {
        errors.push(`models.${m.id}: provedor desconhecido ${String(m.provider)}`);
      }
      if (m.binding !== undefined) {
        if (!isObj(m.binding)) {
          errors.push(`models.${m.id}.binding: não é objeto`);
          continue;
        }
        const price = isObj(m.binding.price_usd_per_mtok) ? m.binding.price_usd_per_mtok : undefined;
        if (!price || !isNonNeg(price.input) || !isNonNeg(price.output)) {
          errors.push(`models.${m.id}.binding: preço de entrada/saída ausente (custo desconhecido)`);
        }
        if (typeof m.binding.price_as_of !== 'string' || Number.isNaN(Date.parse(m.binding.price_as_of))) {
          errors.push(`models.${m.id}.binding.price_as_of: data inválida`);
        }
        if (typeof m.binding.openrouter_id !== 'string') {
          errors.push(`models.${m.id}.binding.openrouter_id: ausente`);
        }
      }
    }
  }

  // Rotas só apontam para modelos existentes.
  const routes = isObj(raw.routes) ? raw.routes : undefined;
  if (!routes) {
    errors.push('routes: ausente');
  } else {
    for (const [name, list] of Object.entries(routes)) {
      if (!Array.isArray(list)) {
        errors.push(`routes.${name}: não é lista`);
        continue;
      }
      for (const id of list) {
        if (typeof id !== 'string' || !ids.has(id)) errors.push(`routes.${name}: modelo desconhecido ${String(id)}`);
      }
    }
  }

  // Roteamento por tarefa aponta para rota existente (ou deterministic).
  const byTask = isObj(raw.routing_by_task) ? raw.routing_by_task : undefined;
  if (!byTask) {
    errors.push('routing_by_task: ausente');
  } else {
    for (const key of REQUIRED_ROUTING_KEYS) {
      if (!(key in byTask)) errors.push(`routing_by_task: falta a tarefa ${key} (DP-02 v5)`);
    }
  }
  if (byTask && routes) {
    for (const [task, value] of Object.entries(byTask)) {
      const routeName = typeof value === 'string' ? (value.split(';')[0] ?? '').trim() : '';
      if (routeName !== 'deterministic' && !(routeName in routes)) {
        errors.push(`routing_by_task.${task}: rota desconhecida "${routeName}"`);
      }
    }
  }

  // Processador: OpenRouter só para classe pública.
  const classes = isObj(raw.data_classes) ? raw.data_classes : undefined;
  const processors = classes && isObj(classes.processors) ? classes.processors : undefined;
  const openrouter = processors && isObj(processors.openrouter) ? processors.openrouter : undefined;
  const notApproved = openrouter && Array.isArray(openrouter.not_approved_for) ? openrouter.not_approved_for : [];
  for (const cls of ['personal', 'internal', 'commercial_confidential', 'restricted', 'secret']) {
    if (!notApproved.includes(cls)) {
      errors.push(`data_classes.processors.openrouter: deve excluir a classe ${cls}`);
    }
  }

  // Tarefas de auditoria exclusivas da reserva devem estar listadas.
  const exclusive = rules && isObj(rules.budget_enforcement) ? rules.budget_enforcement.audit_errata_reserve_exclusive_to : undefined;
  if (!Array.isArray(exclusive)) {
    errors.push('rules.budget_enforcement.audit_errata_reserve_exclusive_to: ausente');
  } else {
    for (const task of AUDIT_EXCLUSIVE_TASKS) {
      if (!exclusive.includes(task)) errors.push(`reserva exclusiva sem a tarefa "${task}"`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], policy: raw as unknown as ModelPolicy };
}

// Lê e valida um arquivo JSON de política. Erro de leitura ou de JSON vira resultado de falha.
export function loadPolicyFile(path: string): PolicyCheck {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    return { ok: false, errors: [`leitura: ${(err as Error).message}`] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`JSON inválido: ${(err as Error).message}`] };
  }
  return validatePolicy(raw);
}
