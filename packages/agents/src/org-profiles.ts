/**
 * RASCUNHO dos 64 perfis da organização completa com conta, modelo e backup de cada um, DENTRO DA POLÍTICA v7
 * (`2.1-dp02-v7-dp27`) e da DP-41. NADA É CRIADO nem chamado: é especificação para revisão (QA 3) e aval do PM.
 *
 * Regras da v7 usadas aqui (fonte: `execution.primary.by_task`, `rules.openai_text_scope`, `routes`, `execution.complement`):
 * - canal primário = assinatura pelo adaptador OpenBot (ADR-003), conta `claude` (Anthropic) ou `codex` (OpenAI), fora do teto;
 * - OpenAI só na rota `review`: `fact_check`, `editorial_review` e as verificações WF08, WF18 e auditoria pós-publicação;
 * - redação sem modelo ALTERNATIVO (DP-26 b); o complemento pela API tarifada é só "complemento de canal" dentro do teto de US$ 50,
 *   na ordem da ADR-015, e fica DESLIGADO no piloto (DP-41);
 * - nunca: publicar sem checagem por provedor distinto do redator, DeepSeek, Fable em trabalho não publicado, checagem por amostragem.
 * Sem Gemini (Antigravity) nem OpenCode: o PM os tirou também do piloto (DP-41: só Claude e Codex).
 */
import type { LoadedRegistries } from './config';
import type { AgentProfile, Department } from './schemas';

export const POLICY_V7_REF = {
  version: '2.1-dp02-v7-dp27',
  file: 'r0-preparacao/arquitetura/model.policy.proposto-DP02-v7.json',
  also_at: 'governanca-runtime/loyaltynews/packages/contracts/fixtures/model.policy.dp02-v7.json',
  sha256: '52377930d5cd9d50846209316fa2824fdc9d392e4d1424f62799fd98f0bb8fb6',
  status: 'proposta; contrato protegido sem a v7 até a cerimônia (commit raiz da v7 e baseline do trust.json)',
} as const;

export type OrgTaskKind =
  | 'editorial_draft' | 'editorial_review' | 'fact_check' | 'postpublication_audit'
  | 'ritual' | 'entity_extraction' | 'social_copy' | 'analysis' | 'deterministic' | 'concept_image'
  /** texto da correção do WF08, redigido no Claude pelo editor ou pelo redator da editoria (PM-2026-11-23-G) */
  | 'correction_draft';

export type OrgAccount = 'claude' | 'codex';

export interface OrgProfileDraft {
  id: string;
  name: string;
  department: Department;
  reports_to: string | null;
  /** editoria (redações) ou `internal` */
  scope: string;
  /** agente OpenBot proposto que hospeda o perfil (`openbot-profiles.draft.json`, hipótese de 8) */
  hosted_by: string;
  mission: string;
  default_route_hint: string;
  task_kind: OrgTaskKind;
  execution: {
    channel: 'openbot_subscription' | 'deterministic' | 'none';
    account: OrgAccount | null;
    provider: 'anthropic' | 'openai' | null;
    /** a v7 não fixa o modelo da assinatura: o OpenBot o declara no UsageReport e o id exato não foi verificado */
    model: string;
  };
  /** complemento pelo gateway do LN (OpenRouter), dentro do teto; DESLIGADO no piloto (DP-41) e sem produção */
  complement_api: { enabled: false; route: string; models: string[]; alternative_model_allowed: boolean } | null;
  backup: string;
  /** tarefa do perfil DENTRO de um workflow, quando difere da principal (ex.: o editor redige a correção no WF08, em Claude) */
  workflow_tasks: Record<string, { task_kind: OrgTaskKind; account: OrgAccount; provider: 'anthropic' | 'openai' }>;
  independence: string | null;
  data_class_allowed: 'public';
  blocked_until: string[];
  chairs_rituals: string[];
  participates_in_rituals: string[];
  owns_workflows: string[];
  first_needed_in_phase: string;
  enabled: false;
}

export interface OrgProfilesDraft {
  schema: 'ln.agents.organization-profiles-draft/1';
  status: 'RASCUNHO';
  created: false;
  approval_required_from: 'Program Manager';
  review_by: 'QA 3';
  policy: typeof POLICY_V7_REF;
  basis: string[];
  counts: Record<string, number>;
  open_decisions: string[];
  not_verified: string[];
  profiles: OrgProfileDraft[];
}

const FIRST_PHASE: Record<Department, string> = {
  editorial: 'F2', intelligence: 'F3', creative: 'F3', growth: 'F3', trust: 'F4', executivo: 'F4', technology: 'F5', commercial: 'F5',
};

const ENTITY_IDS = new Set(['people', 'company', 'graph', 'discovery', 'orgchart', 'moves']);
const SOCIAL_IDS = new Set(['social', 'linkedin', 'instagram', 'community', 'newsletter', 'seo']);
const DRAFTER_IDS = new Set(['newsdesk', 'agenda', 'talks']);

export function taskKindOf(a: AgentProfile): OrgTaskKind {
  if (a.default_route_hint === 'deterministic') return 'deterministic';
  if (a.id === 'image') return 'concept_image';
  if (a.id === 'factcheck') return 'fact_check';
  if (a.id === 'audit') return 'postpublication_audit';
  if (a.department === 'editorial' && a.id.startsWith('editor_')) return 'editorial_review';
  if (a.id.startsWith('writer_') || DRAFTER_IDS.has(a.id)) return 'editorial_draft';
  if (ENTITY_IDS.has(a.id)) return 'entity_extraction';
  if (SOCIAL_IDS.has(a.id)) return 'social_copy';
  if (a.id === 'publisher' || a.id.startsWith('director_')) return 'ritual';
  return 'analysis';
}

const OPENAI_KINDS: readonly OrgTaskKind[] = ['fact_check', 'editorial_review', 'postpublication_audit'];

const BLOCKED: Record<string, string[]> = {
  image: ['a rota `image_fast` da v7 não tem modelo (lista vazia): o perfil fica desligado até a política habilitar imagem'],
  privacy: ['dado pessoal: bloqueado até base legal e operador aprovados (v7, classes de dado)'],
  people: ['dado pessoal além de nome, cargo e empresa de fonte pública: bloqueado até operador aprovado (exceção P4/DP-11)'],
  moves: ['só nome, cargo e empresa de fonte pública (exceção P4/DP-11); o resto é dado pessoal bloqueado'],
  orgchart: ['só nome, cargo e empresa de fonte pública (exceção P4/DP-11); o resto é dado pessoal bloqueado'],
  sales: ['insumo comercial confidencial: bloqueado até operador aprovado (v7, classes de dado)'],
  pricing: ['insumo comercial confidencial: bloqueado até operador aprovado (v7, classes de dado)'],
  account: ['insumo comercial confidencial: bloqueado até operador aprovado (v7, classes de dado)'],
};

export function buildOrgProfiles(registries: Pick<LoadedRegistries, 'agents' | 'meetings' | 'workflows'>): OrgProfilesDraft {
  const profiles: OrgProfileDraft[] = registries.agents.map((a) => {
    const kind = taskKindOf(a);
    const det = kind === 'deterministic';
    const none = kind === 'concept_image';
    const account: OrgAccount | null = det || none ? null : OPENAI_KINDS.includes(kind) ? 'codex' : 'claude';
    const hint = a.default_route_hint;
    let models: string[] = [];
    if (account === 'codex') models = ['openai-text-review', 'openai-text-review-alt'];
    else if (account === 'claude') models = hint === 'premium' || hint === 'strategic' ? ['claude-opus-5-5'] : hint === 'review' ? ['claude-sonnet-5-5'] : ['claude-haiku-5-5'];
    const complementRoute = account === 'codex' ? 'review' : hint;
    let backup: string;
    if (det) backup = 'não se aplica: etapa determinística, sem modelo (a execução com escopo é do serviço de publicação ou de operação)';
    else if (none) backup = 'nenhum: sem modelo de imagem na v7';
    else if (kind === 'editorial_draft') backup = 'sem modelo ALTERNATIVO (DP-26 b). No limite da assinatura a tarefa volta a `pending` e espera a janela; o único complemento é o mesmo claude-haiku-5-5 pela API tarifada, dentro do teto e fora do piloto (DP-41)';
    else if (account === 'codex') backup = 'no limite do Codex a tarefa fica `pending`; complemento pela API tarifada na rota `review` com outro autor que o do conteúdo (fallback lateral só entre autores distintos; sem autor distinto = bloqueio, falha fechada); desligado no piloto (DP-41)';
    else backup = 'no limite do Claude a tarefa volta a `pending` e espera a janela; complemento pela API tarifada na rota do perfil, dentro do teto e na ordem de corte da ADR-015 (premium e rituais param primeiro); desligado no piloto (DP-41)';
    const independence = kind === 'fact_check' || kind === 'editorial_review'
      ? 'autor do modelo diferente do autor do rascunho (redação em Claude, checagem e revisão em Codex); mesmo autor ou autor desconhecido = bloqueio'
      : kind === 'postpublication_audit'
        ? 'autor do modelo diferente do autor do conteúdo auditado; verba só da reserva de auditoria e erratas'
        : kind === 'editorial_draft'
          ? 'o rascunho só segue com checagem e revisão de outro provedor (Codex); a checagem nunca é por amostragem'
          : null;
    return {
      id: a.id,
      name: a.name,
      department: a.department,
      reports_to: a.reports_to ?? null,
      scope: a.scope,
      hosted_by: `ln_${a.department}`,
      mission: a.mission,
      default_route_hint: hint,
      task_kind: kind,
      execution: det
        ? { channel: 'deterministic', account: null, provider: null, model: 'nenhum (determinístico)' }
        : none
          ? { channel: 'none', account: null, provider: null, model: 'nenhum (sem modelo de imagem na v7)' }
          : account === 'codex'
            ? { channel: 'openbot_subscription', account, provider: 'openai', model: 'Codex/OpenAI pela assinatura; modelo informado pelo OpenBot no UsageReport (id exato não verificado)' }
            : { channel: 'openbot_subscription', account: 'claude', provider: 'anthropic', model: 'Claude pela assinatura; modelo informado pelo OpenBot no UsageReport (id exato não verificado)' },
      complement_api: det || none ? null : { enabled: false, route: complementRoute, models, alternative_model_allowed: kind !== 'editorial_draft' },
      backup,
      workflow_tasks: (a.id.startsWith('editor_') && a.department === 'editorial' ? { WF08: { task_kind: 'correction_draft', account: 'claude', provider: 'anthropic' } } : {}) as OrgProfileDraft['workflow_tasks'],
      independence,
      data_class_allowed: 'public',
      blocked_until: BLOCKED[a.id] ?? [],
      chairs_rituals: registries.meetings.filter((m) => m.chair === a.id).map((m) => m.id),
      participates_in_rituals: registries.meetings.filter((m) => m.participants.includes(a.id)).map((m) => m.id),
      owns_workflows: registries.workflows.filter((w) => w.owner === a.id).map((w) => w.id),
      first_needed_in_phase: FIRST_PHASE[a.department],
      enabled: false,
    };
  });
  const count = (f: (p: OrgProfileDraft) => boolean) => profiles.filter(f).length;
  return {
    schema: 'ln.agents.organization-profiles-draft/1',
    status: 'RASCUNHO',
    created: false,
    approval_required_from: 'Program Manager',
    review_by: 'QA 3',
    policy: POLICY_V7_REF,
    basis: [
      'model.policy 2.1-dp02-v7-dp27 (canal primário = assinatura OpenBot; complemento pela API dentro do teto de US$ 50)',
      'DP-27 (assinaturas como canal primário), DP-30 (risco dos termos aceito), DP-41 (piloto no staging só com Claude e Codex, sem API tarifada, sem publicação), DP-26 (b)(c)',
      'ADR-003 (adaptador pull com lease), ADR-004 (perfis = contratos sob demanda), ADR-015 (ordem de corte 35/40/42), ADR-021',
      'agents.registry.json: 64 perfis (copiado byte a byte em packages/agents/data)',
    ],
    counts: {
      profiles: profiles.length,
      claude: count((p) => p.execution.account === 'claude'),
      codex: count((p) => p.execution.account === 'codex'),
      deterministic: count((p) => p.execution.channel === 'deterministic'),
      no_model_available: count((p) => p.execution.channel === 'none'),
      with_blockers: count((p) => p.blocked_until.length > 0),
    },
    open_decisions: [
      'A rota `image_fast` da v7 não tem modelo: o perfil `image` fica sem canal até a política habilitar imagem.',
      'Perfis com insumo pessoal ou comercial confidencial ficam bloqueados até o operador ser aprovado (v7, classes de dado).',
      'Volume de uso da assinatura por perfil e por ritual NÃO foi medido: a organização completa só liga depois de o piloto medir janelas e limites de Claude e Codex (uma conta por provedor, sem separar produto e implementação).',
      'Hipótese de 8 agentes OpenBot (um por diretoria mais Publisher) segue sem medição; ver `openbot-profiles.draft.json`.',
    ],
    not_verified: [
      'id exato do modelo de cada assinatura e capacidades (declarados pelo OpenBot no UsageReport)',
      'limites reais de Claude e Codex e a hora de retomada informada pelo OpenBot',
      'termos das assinaturas para uso automatizado (risco aceito na DP-30, não verificado)',
      'qualidade dos 64 perfis em PT-BR (nenhuma chamada de modelo foi feita)',
    ],
    profiles,
  };
}

export interface OrgIssue { code: string; message: string }

/** Falha fechada: cobertura dos 64, contas permitidas pela v7, independência, nada ligado, sem backup fora da política. */
export function validateOrgProfiles(draft: OrgProfilesDraft, registries: Pick<LoadedRegistries, 'agents' | 'meetings' | 'workflows'>): OrgIssue[] {
  const issues: OrgIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  if (draft.created !== false) add('CREATED', 'o rascunho não pode afirmar criação de agente');
  if (draft.status !== 'RASCUNHO') add('STATUS', 'status deve ser RASCUNHO');
  if (draft.profiles.length !== registries.agents.length) add('COUNT', `esperados ${registries.agents.length} perfis, encontrados ${draft.profiles.length}`);
  const seen = new Set<string>();
  for (const p of draft.profiles) {
    if (seen.has(p.id)) add('DUP', `perfil repetido: ${p.id}`);
    seen.add(p.id);
    if (!registries.agents.some((a) => a.id === p.id)) add('UNKNOWN', `perfil inexistente: ${p.id}`);
    if (p.enabled !== false) add('ENABLED', `${p.id}: deve estar desligado`);
    if (p.execution.account && !['claude', 'codex'].includes(p.execution.account)) add('ACCOUNT', `${p.id}: conta fora de Claude e Codex (DP-41)`);
    if (p.execution.account === 'codex' && !OPENAI_KINDS.includes(p.task_kind)) add('OPENAI_SCOPE', `${p.id}: OpenAI só na rota de revisão (v7: openai_text_scope)`);
    if (OPENAI_KINDS.includes(p.task_kind) && p.execution.account !== 'codex') add('REVIEW_ACCOUNT', `${p.id}: verificação independente deve rodar no Codex (autor distinto do redator Claude)`);
    if (p.task_kind === 'editorial_draft' && p.execution.account !== 'claude') add('DRAFT_ACCOUNT', `${p.id}: redação só em Claude`);
    if (p.task_kind === 'editorial_draft' && p.complement_api?.alternative_model_allowed) add('DRAFT_FALLBACK', `${p.id}: redação não admite modelo alternativo (DP-26 b)`);
    if ((p.task_kind === 'fact_check' || p.task_kind === 'editorial_review' || p.task_kind === 'postpublication_audit') && !p.independence) add('INDEPENDENCE', `${p.id}: regra de independência ausente`);
    for (const [wf, t] of Object.entries(p.workflow_tasks)) {
      if (t.task_kind === 'correction_draft' && (t.account !== 'claude' || t.provider !== 'anthropic')) add('WORKFLOW_TASK', `${p.id}/${wf}: o texto da correção é redigido no Claude`);
      if (!['claude', 'codex'].includes(t.account)) add('ACCOUNT', `${p.id}/${wf}: conta fora de Claude e Codex (DP-41)`);
    }
    if (p.complement_api && p.complement_api.enabled !== false) add('COMPLEMENT_ON', `${p.id}: complemento pela API deve estar desligado`);
    if (/gemini|antigravity|opencode|deepseek|fable/i.test(JSON.stringify({ e: p.execution, c: p.complement_api, b: p.backup })) && !/Fable em trabalho|DeepSeek/.test(p.backup)) add('OFF_POLICY', `${p.id}: modelo ou conta fora da política v7`);
    if (p.execution.channel === 'deterministic' && p.execution.account !== null) add('DET', `${p.id}: determinístico não tem conta`);
    if (p.data_class_allowed !== 'public') add('DATA_CLASS', `${p.id}: só classe public`);
    if (!p.backup) add('BACKUP', `${p.id}: backup vazio`);
  }
  for (const a of registries.agents) if (!seen.has(a.id)) add('MISSING', `perfil sem rascunho: ${a.id}`);
  for (const m of registries.meetings) {
    const n = draft.profiles.filter((p) => p.chairs_rituals.includes(m.id)).length;
    if (n !== 1) add('CHAIR', `ritual ${m.id} presidido por ${n} perfil(is)`);
  }
  for (const w of registries.workflows) {
    const n = draft.profiles.filter((p) => p.owns_workflows.includes(w.id)).length;
    if (n !== 1) add('WORKFLOW_OWNER', `workflow ${w.id} com ${n} dono(s)`);
  }
  if (/sk-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{10,}|(api[_-]?key|password|secret)\s*[:=]\s*\S+/i.test(JSON.stringify(draft))) add('SECRET_LIKE', 'texto com aparência de segredo');
  return issues;
}
