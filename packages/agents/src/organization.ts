/**
 * Organização derivada dos registros: 7 diretorias, 10 redações (editor + redator + memória
 * setorial + interações com diretorias) e análise dos passos dos workflows.
 */
import { EDITORIAS as CONTRACT_EDITORIAS } from '@ln/contracts';
import type { LoadedRegistries } from './config';
import {
  DIRECTORATES,
  EDITORIAS,
  type AgentProfile,
  type Directorate,
  type DirectorateConfig,
  type Editoria,
  type NewsroomConfig,
  type Workflow,
} from './schemas';

/** Passos de workflow que não são agentes (portões automáticos e etapas determinísticas). */
export const NON_AGENT_STEPS: ReadonlySet<string> = new Set([
  'auto_gate_editor', 'auto_gate_social', 'auto_gate_data', 'auto_gate_sales', 'auto_gate_admin',
  'auto_gate_owner', 'auto_gate_ops', 'auto_gate_gate_if_needed', 'auto_gate_approval',
  'auto_gate_response', 'auto_gate_privacy',
  'validate_revision', 'transactional_publish', 'outbox', 'postpublication_audit', 'unpublish_if_failed',
  'esp_send', 'republish', 'social_reconcile', 'entity_rebuild', 'collect_providers', 'validate_periods',
  'aggregate', 'publish_snapshot', 'reconcile', 'budget_alert', 'recover', 'match_active_subscriptions',
  'dedupe', 'consent_check', 'notify', 'snapshot', 'structured_inputs', 'chair_synthesis',
  'challenge_if_needed', 'validate_decisions', 'transactional_actions', 'validate_authority', 'assign',
  'track_due_date', 'verify_evidence', 'escalate_overdue', 'refresh_catalog', 'offline_eval',
  'cost_review', 'security_review', 'canary', 'monitor_or_rollback', 'intake', 'preserve_evidence',
  'triage', 'errata', 'notify_owner_if_legal', 'verify_identity', 'restrict_processing',
  'rectify_or_remove',
]);

export type StepRef =
  | { kind: 'agent'; token: string; agents: string[] }
  | { kind: 'step'; token: string }
  | { kind: 'unknown'; token: string };

/** Quebra `a>b+c` em tokens (`>` sequência, `+` paralelo) e resolve `{editoria}` e `_if_enabled`. */
export function parseSteps(steps: string, agentIds: ReadonlySet<string>): StepRef[] {
  const out: StepRef[] = [];
  for (const raw of steps.split(/[>+]/)) {
    const token = raw.trim();
    if (!token) continue;
    if (token.includes('{editoria}')) {
      const agents = EDITORIAS.map((e) => token.replace('{editoria}', e));
      out.push(agents.every((a) => agentIds.has(a)) ? { kind: 'agent', token, agents } : { kind: 'unknown', token });
      continue;
    }
    const base = token.endsWith('_if_enabled') ? token.slice(0, -'_if_enabled'.length) : token;
    if (agentIds.has(base)) out.push({ kind: 'agent', token, agents: [base] });
    else if (NON_AGENT_STEPS.has(token)) out.push({ kind: 'step', token });
    else out.push({ kind: 'unknown', token });
  }
  return out;
}

/** Agentes citados por um workflow (dono + passos), com `{editoria}` expandido. */
export function workflowAgents(wf: Workflow, agentIds: ReadonlySet<string>): Set<string> {
  const s = new Set<string>([wf.owner]);
  for (const r of parseSteps(wf.steps, agentIds)) if (r.kind === 'agent') r.agents.forEach((a) => s.add(a));
  return s;
}

const DAILY_BY_DIRECTORATE: Record<Directorate, string> = {
  editorial: 'D-editorial',
  creative: 'D-creative',
  growth: 'D-growth',
  intelligence: 'D-intelligence',
  commercial: 'D-commercial',
  technology: 'D-technology',
  trust: 'D-trust',
};
const WEEKLY_BY_DIRECTORATE: Record<Directorate, string | null> = {
  editorial: 'W-pautas',
  creative: null,
  growth: 'W-performance',
  intelligence: 'W-intel',
  commercial: null,
  technology: 'W-finops',
  trust: 'W-trust',
};

export function buildDirectorates(agents: readonly AgentProfile[]): DirectorateConfig[] {
  return DIRECTORATES.map((dep) => {
    const members = agents.filter((a) => a.department === dep);
    return {
      id: dep,
      department: dep,
      director: `director_${dep}`,
      members: members.map((m) => m.id),
      reports_to: 'publisher' as const,
      daily_meeting: DAILY_BY_DIRECTORATE[dep],
      weekly_meeting: WEEKLY_BY_DIRECTORATE[dep],
    };
  });
}

/**
 * Interações de cada redação com as demais diretorias. Declaradas aqui e cruzadas pelo validador
 * com os passos reais dos workflows (todo agente listado precisa aparecer em ao menos um dos
 * workflows citados) — assim a declaração não deriva dos contratos.
 */
export const NEWSROOM_INTERACTION_TEMPLATE = [
  { directorate: 'editorial', agents: ['director_editorial', 'newsdesk'], workflows: ['WF01', 'WF02', 'WF03'], nature: 'pauta, triagem, aprovação e publicação' },
  { directorate: 'trust', agents: ['factcheck', 'rights'], workflows: ['WF02', 'WF08'], nature: 'checagem de fatos e direitos antes da aprovação; correções' },
  { directorate: 'intelligence', agents: ['discovery', 'people', 'company'], workflows: ['WF06'], nature: 'entidades e evidências geradas pela matéria aprovada' },
  { directorate: 'creative', agents: ['art', 'designer', 'media'], workflows: ['WF04'], nature: 'arte e mídia do pacote social da matéria publicada' },
  { directorate: 'growth', agents: ['linkedin', 'publisher_social'], workflows: ['WF04'], nature: 'distribuição social da matéria publicada' },
  { directorate: 'technology', agents: ['finops'], workflows: ['WF11'], nature: 'orçamento e custo de modelos da redação' },
] as const;

export function buildNewsrooms(reg: Pick<LoadedRegistries, 'agents' | 'meetings'>): NewsroomConfig[] {
  const byId = new Map(reg.agents.map((a) => [a.id, a]));
  return EDITORIAS.map((ed: Editoria) => {
    // Não lança: ids esperados por convenção; o validador reporta o que faltar (falha fechada).
    const editor = byId.get(`editor_${ed}`);
    return {
      editoria: ed,
      name: CONTRACT_EDITORIAS.find((e) => e.slug === ed)?.nome ?? ed,
      editor: `editor_${ed}`,
      writer: `writer_${ed}`,
      director: editor?.reports_to ?? 'director_editorial',
      daily_meeting: `D-${ed}`,
      memory_scope: ed,
      interactions: NEWSROOM_INTERACTION_TEMPLATE.map((i) => ({
        directorate: i.directorate,
        agents: [...i.agents],
        workflows: [...i.workflows],
        nature: i.nature,
      })),
    };
  });
}

export interface Organization {
  registries: LoadedRegistries;
  directorates: DirectorateConfig[];
  newsrooms: NewsroomConfig[];
}

export function buildOrganization(registries: LoadedRegistries): Organization {
  return {
    registries,
    directorates: buildDirectorates(registries.agents),
    newsrooms: buildNewsrooms(registries),
  };
}
