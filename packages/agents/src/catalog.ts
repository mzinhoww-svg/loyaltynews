/**
 * CATÁLOGO dos 28 rituais e 19 workflows (Frente 07): dados normalizados + schema + validação. NADA RODA aqui:
 * é só configuração desligada (`enabled=false`), derivada dos contratos `meetings.registry.json` e `workflows.registry.json`
 * (protegidos, copiados byte a byte em `data/`). Não chama modelo, rede nem banco.
 *
 * Fonte oficial: Blueprint v2.1 §2 e §3, os registros acima e os itens R4-11/R4-12 do backlog. O Blueprint é resumido: o que ele
 * não diz (formato de entrada de cada ritual, esquema de cada saída, evidência por passo) aparece como LACUNA em `catalog-gaps.md`,
 * não como dado inventado.
 */
import { z } from 'zod';
import { CONSOLIDATION_RITUAL_IDS } from './routing-plan';
import { EDITORIAS, type AgentProfile, type Meeting, type Workflow } from './schemas';
import type { LoadedRegistries } from './config';
import type { OrgProfilesDraft } from './org-profiles';

// --- rituais -----------------------------------------------------------------------------------------------------------

export const RitualSpecSchema = z.object({
  id: z.string().regex(/^[DWMX]-[a-z]+$/),
  title: z.string().min(1),
  cycle: z.enum(['weekday', 'weekly', 'monthly', 'event']),
  cadence: z.object({ schedule_local: z.string().min(1), timezone: z.literal('America/Sao_Paulo'), holiday_calendar: z.string().min(1) }).strict(),
  chair: z.string().min(1),
  participants: z.array(z.string().min(1)).min(2),
  quorum: z.object({ minimum: z.number().int().min(2), chair_required: z.literal(true) }).strict(),
  max_rounds: z.literal(2),
  /** ENTRADA: o registro só traz `mode` e `purpose`; o formato é derivado e a lacuna fica declarada */
  input: z.object({
    mode: z.string().min(1),
    agenda: z.string().min(1),
    participant_inputs: z.literal('structured_parallel'),
    from_digest: z.boolean(),
    depends_on: z.array(z.string()),
    workflow: z.string().nullable(),
    silence_rule: z.string().min(1),
  }).strict(),
  /** SAÍDA: rótulos de texto do registro (sem esquema por ritual) + ata persistida */
  output: z.object({
    artifacts: z.array(z.string().min(1)).min(1),
    minutes: z.object({ persisted: z.literal(true), record: z.literal('MeetingOutcomeRecord'), fields: z.array(z.string()).min(1), decisions: z.literal(true), actions: z.literal('idempotent_with_owner_due_evidence') }).strict(),
  }).strict(),
  route: z.string().min(1),
  authority: z.string().min(1),
  enabled: z.literal(false),
}).strict();
export type RitualSpec = z.infer<typeof RitualSpecSchema>;

// --- workflows ---------------------------------------------------------------------------------------------------------

const StageTokenSchema = z.object({ token: z.string().min(1), kind: z.enum(['agent', 'step', 'gate']), agents: z.array(z.string()) }).strict();

export const WorkflowSpecSchema = z.object({
  id: z.string().regex(/^WF\d{2}$/),
  name: z.string().min(1),
  triggers: z.array(z.string().min(1)).min(1),
  /** agente responsável */
  owner: z.string().min(1),
  /** etapas em ordem; os tokens de uma mesma etapa (`+`) rodam em paralelo */
  stages: z.array(z.object({ order: z.number().int().min(1), tokens: z.array(StageTokenSchema).min(1) }).strict()).min(1),
  /** gates automáticos (`auto_gate_*`) das etapas; vazio = sem gate explícito (lacuna declarada) */
  gates: z.array(z.string()),
  /** EVIDÊNCIA: artefato de saída, bloqueios fail-closed e texto da política do registro */
  evidence: z.object({ artifact: z.string().min(1), fail_closed_blockers: z.array(z.string()).min(1), policy: z.string() }).strict(),
  channel_flags: z.object({ instagram_enabled: z.boolean().optional(), channel_enabled: z.boolean().optional(), provider: z.string().optional() }).strict(),
  enabled: z.literal(false),
}).strict();
export type WorkflowSpec = z.infer<typeof WorkflowSpecSchema>;

export interface Catalog {
  schema: 'ln.agents.catalog/1';
  status: 'CATALOGO_DESLIGADO';
  /** nada roda nem chama modelo */
  runs: false;
  counts: { rituals: number; workflows: number };
  rituals: RitualSpec[];
  workflows: WorkflowSpec[];
  independence: EditorialIndependenceRule[];
}

/** Papéis de um workflow editorial que precisam ser de provedores diferentes (v7: `fact_check_provider_must_differ_from_draft`). */
export interface EditorialIndependenceRule {
  workflow: string;
  /** quem redige (ou o autor do conteúdo que está sendo checado, na correção/auditoria) */
  authors: string[];
  checkers: string[];
  reviewers: string[];
  note: string;
}

export const EDITORIAL_INDEPENDENCE: EditorialIndependenceRule[] = [
  { workflow: 'WF02', authors: ['writer_{editoria}'], checkers: ['factcheck'], reviewers: ['editor_{editoria}'], note: 'redação ≠ checagem ≠ revisão; checagem e revisão de provedor diferente do redator (gate WF02)' },
  { workflow: 'WF03', authors: ['writer_{editoria}'], checkers: ['audit'], reviewers: [], note: 'auditoria pós-publicação por provedor diferente do autor do conteúdo publicado' },
  { workflow: 'WF05', authors: ['newsletter'], checkers: ['factcheck'], reviewers: [], note: 'checagem da newsletter por provedor diferente do autor do texto' },
  { workflow: 'WF08', authors: ['writer_{editoria}'], checkers: ['factcheck'], reviewers: ['editor_{editoria}'], note: 'checagem da correção por provedor diferente do autor do conteúdo sob correção (v7: wf08_correction)' },
];

const expand = (id: string): string[] => (id.includes('{editoria}') ? EDITORIAS.map((e) => id.replace('{editoria}', e)) : [id]);

const NON_AGENT_GATE = /^auto_gate_/;

function ritualSpec(m: Meeting): RitualSpec {
  return {
    id: m.id,
    title: m.title,
    cycle: m.cycle,
    cadence: { schedule_local: m.schedule_local, timezone: m.timezone as 'America/Sao_Paulo', holiday_calendar: m.holiday_calendar },
    chair: m.chair,
    participants: [...m.participants],
    quorum: { minimum: m.quorum.minimum, chair_required: true },
    max_rounds: 2,
    input: {
      mode: m.mode,
      agenda: m.purpose,
      participant_inputs: 'structured_parallel',
      from_digest: CONSOLIDATION_RITUAL_IDS.includes(m.id),
      depends_on: [...(m.depends_on ?? [])],
      workflow: m.workflow ?? null,
      silence_rule: m.silence_rule,
    },
    output: {
      artifacts: [...m.outputs],
      minutes: { persisted: true, record: 'MeetingOutcomeRecord', fields: ['summary', 'blockers', 'evidence_refs', 'outputs', 'notes'], decisions: true, actions: 'idempotent_with_owner_due_evidence' },
    },
    route: m.route,
    authority: m.authority,
    enabled: false,
  };
}

function workflowSpec(w: Workflow, agentIds: ReadonlySet<string>): WorkflowSpec {
  const stages = w.steps.split('>').map((group, i) => ({
    order: i + 1,
    tokens: group.split('+').map((raw) => {
      const token = raw.trim();
      const base = token.endsWith('_if_enabled') ? token.slice(0, -'_if_enabled'.length) : token;
      const agents = expand(base).filter((a) => agentIds.has(a));
      const kind: 'agent' | 'step' | 'gate' = NON_AGENT_GATE.test(token) ? 'gate' : agents.length > 0 ? 'agent' : 'step';
      return { token, kind, agents };
    }),
  }));
  const flags: WorkflowSpec['channel_flags'] = {};
  const raw = w as unknown as { provider?: string; instagram_enabled?: boolean; channel_enabled?: boolean };
  if (raw.provider !== undefined) flags.provider = raw.provider;
  if (raw.instagram_enabled !== undefined) flags.instagram_enabled = raw.instagram_enabled;
  if (raw.channel_enabled !== undefined) flags.channel_enabled = raw.channel_enabled;
  return {
    id: w.id,
    name: w.name,
    triggers: w.trigger.split('/').map((t) => t.trim()).filter(Boolean),
    owner: w.owner,
    stages,
    gates: stages.flatMap((s) => s.tokens.filter((t) => t.kind === 'gate').map((t) => t.token)),
    evidence: { artifact: w.output, fail_closed_blockers: [...w.blockers], policy: (w as unknown as { policy?: string }).policy ?? '' },
    channel_flags: flags,
    enabled: false,
  };
}

export function buildCatalog(registries: Pick<LoadedRegistries, 'agents' | 'meetings' | 'workflows'>): Catalog {
  const ids = new Set(registries.agents.map((a: AgentProfile) => a.id));
  return {
    schema: 'ln.agents.catalog/1',
    status: 'CATALOGO_DESLIGADO',
    runs: false,
    counts: { rituals: registries.meetings.length, workflows: registries.workflows.length },
    rituals: registries.meetings.map(ritualSpec),
    workflows: registries.workflows.map((w) => workflowSpec(w, ids)),
    independence: EDITORIAL_INDEPENDENCE,
  };
}

// --- validação ----------------------------------------------------------------------------------------------------------

export interface CatalogIssue { code: string; message: string }

export const CATALOG_EXPECTED = { rituals: 28, workflows: 19 } as const;

/**
 * Falha fechada: exatamente 28 e 19; ids únicos; schema; todo participante, presidente, dono e agente de passo é um dos 64 perfis;
 * tudo desligado; e a independência dos workflows editoriais (papéis distintos e provedores diferentes, com os provedores vindos do
 * rascunho dos 64 perfis na política v7).
 */
export function validateCatalog(catalog: Catalog, registries: Pick<LoadedRegistries, 'agents'>, org: Pick<OrgProfilesDraft, 'profiles'>): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  const ids = new Set(registries.agents.map((a) => a.id));
  if (catalog.rituals.length !== CATALOG_EXPECTED.rituals) add('COUNT_RITUALS', `esperados ${CATALOG_EXPECTED.rituals} rituais, encontrados ${catalog.rituals.length}`);
  if (catalog.workflows.length !== CATALOG_EXPECTED.workflows) add('COUNT_WORKFLOWS', `esperados ${CATALOG_EXPECTED.workflows} workflows, encontrados ${catalog.workflows.length}`);
  if (catalog.runs !== false) add('RUNS', 'o catálogo não pode rodar nada');
  for (const [kind, list] of [['ritual', catalog.rituals], ['workflow', catalog.workflows]] as const) {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.id)) add('ID_DUP', `${kind} ${x.id} repetido`);
      seen.add(x.id);
    }
  }
  for (const r of catalog.rituals) {
    const p = RitualSpecSchema.safeParse(r);
    if (!p.success) add('RITUAL_SCHEMA', `${r.id}: ${p.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    if (!ids.has(r.chair)) add('RITUAL_CHAIR', `${r.id}: presidente ${r.chair} não é um dos 64 perfis`);
    if (!r.participants.includes(r.chair)) add('RITUAL_CHAIR', `${r.id}: presidente fora dos participantes`);
    for (const a of r.participants) if (!ids.has(a)) add('RITUAL_PARTICIPANT', `${r.id}: participante ${a} não é um dos 64 perfis`);
    if (new Set(r.participants).size !== r.participants.length) add('RITUAL_PARTICIPANT', `${r.id}: participante repetido`);
    if (r.quorum.minimum > r.participants.length) add('RITUAL_QUORUM', `${r.id}: quórum maior que os participantes`);
    for (const d of r.input.depends_on) if (!catalog.rituals.some((x) => x.id === d)) add('RITUAL_DEPENDS', `${r.id}: depende de ${d}, inexistente`);
    if (r.input.workflow && !catalog.workflows.some((w) => w.id === r.input.workflow)) add('RITUAL_WORKFLOW', `${r.id}: workflow ${r.input.workflow} inexistente`);
  }
  for (const w of catalog.workflows) {
    const p = WorkflowSpecSchema.safeParse(w);
    if (!p.success) add('WORKFLOW_SCHEMA', `${w.id}: ${p.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    if (!ids.has(w.owner)) add('WORKFLOW_OWNER', `${w.id}: responsável ${w.owner} não é um dos 64 perfis`);
    for (const s of w.stages) for (const t of s.tokens) {
      if (t.kind === 'agent') for (const a of t.agents) if (!ids.has(a)) add('WORKFLOW_AGENT', `${w.id}: agente ${a} não é um dos 64 perfis`);
    }
  }
  // independência dos workflows editoriais
  const profile = new Map(org.profiles.map((p) => [p.id, p]));
  const provider = (id: string) => profile.get(id)?.execution.provider ?? null;
  for (const rule of catalog.independence) {
    const wf = catalog.workflows.find((w) => w.id === rule.workflow);
    if (!wf) { add('INDEPENDENCE_WORKFLOW', `${rule.workflow}: workflow inexistente`); continue; }
    const inWf = new Set(wf.stages.flatMap((s) => s.tokens.flatMap((t) => t.agents)));
    for (const edKey of EDITORIAS) {
      const sub = (id: string) => id.replace('{editoria}', edKey);
      const authors = rule.authors.map(sub);
      const checkers = rule.checkers.map(sub);
      const reviewers = rule.reviewers.map(sub);
      const all = [...authors, ...checkers, ...reviewers];
      if (new Set(all).size !== all.length) add('INDEPENDENCE_ROLES', `${rule.workflow}/${edKey}: papéis repetidos (${all.join(', ')}); redação, checagem e revisão devem ser perfis diferentes`);
      for (const a of all) if (!ids.has(a)) add('INDEPENDENCE_PROFILE', `${rule.workflow}/${edKey}: perfil ${a} inexistente`);
      // checagem e revisão precisam fazer parte das etapas do workflow (o autor pode ser o conteúdo já produzido antes dele, como na
      // correção e na auditoria); a auditoria pós-publicação do WF03 é o passo `postpublication_audit`, não um perfil nas etapas
      for (const a of [...checkers, ...reviewers]) {
        const stepOnly = rule.workflow === 'WF03' && a === 'audit';
        if (!stepOnly && !inWf.has(a)) add('INDEPENDENCE_STEP', `${rule.workflow}/${edKey}: ${a} não aparece nas etapas do workflow`);
      }
      const authorProviders = new Set(authors.map(provider));
      if (authorProviders.has(null) || authors.length === 0) add('INDEPENDENCE_PROVIDER', `${rule.workflow}/${edKey}: autor sem provedor definido`);
      for (const c of [...checkers, ...reviewers]) {
        const pc = provider(c);
        if (pc === null) add('INDEPENDENCE_PROVIDER', `${rule.workflow}/${edKey}: ${c} sem provedor definido`);
        else if (authorProviders.has(pc)) add('INDEPENDENCE_PROVIDER', `${rule.workflow}/${edKey}: ${c} usa o mesmo provedor (${pc}) do autor do conteúdo`);
      }
    }
  }
  for (const id of new Set(catalog.independence.map((r) => r.workflow))) {
    if (catalog.independence.filter((r) => r.workflow === id).length !== 1) add('INDEPENDENCE_RULE', `${id}: mais de uma regra`);
  }
  return issues;
}

/** Informativo: workflows em que checagem e revisão usam o MESMO provedor (permitido pela v7: ambos só precisam diferir do redator). */
export function checkReviewSameProvider(catalog: Catalog, org: Pick<OrgProfilesDraft, 'profiles'>): string[] {
  const provider = (id: string) => org.profiles.find((p) => p.id === id)?.execution.provider ?? null;
  const out: string[] = [];
  for (const rule of catalog.independence) {
    if (rule.checkers.length === 0 || rule.reviewers.length === 0) continue;
    const c = rule.checkers.map((x) => provider(x.replace('{editoria}', 'mercado')));
    const r = rule.reviewers.map((x) => provider(x.replace('{editoria}', 'mercado')));
    if (c.some((p) => p !== null && r.includes(p))) out.push(rule.workflow);
  }
  return out;
}
