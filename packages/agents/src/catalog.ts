/**
 * CATÁLOGO dos 28 rituais e 19 workflows (Frente 07): dados normalizados + schema + validação. NADA RODA aqui:
 * é só configuração desligada (`enabled=false`), derivada dos contratos `meetings.registry.json` e `workflows.registry.json`
 * (protegidos, copiados byte a byte em `data/`) mais os esquemas PROPOSTOS de `catalog-schemas.ts` (entrada e saída de cada ritual,
 * gates explícitos e evidência por etapa), que o Chief Architect precisa ratificar. Não chama modelo, rede nem banco.
 *
 * Fonte oficial: Blueprint v2.1 §2 e §3, os registros acima e os itens R4-11/R4-12 do backlog.
 */
import { z } from 'zod';
import { CONSOLIDATION_RITUAL_IDS } from './routing-plan';
import { EDITORIAS, type AgentProfile, type Meeting, type Workflow } from './schemas';
import type { LoadedRegistries } from './config';
import type { OrgProfilesDraft, OrgProfileDraft, OrgTaskKind } from './org-profiles';
import { ARTIFACT_SCHEMAS, OUTPUT_LABEL_KIND, PROPOSED_GATES, RITUAL_FAMILIES, STAGE_EVIDENCE_KINDS, ritualFamily, type ArtifactKind, type StageEvidenceKind } from './catalog-schemas';

const ARTIFACT_KINDS = Object.keys(ARTIFACT_SCHEMAS) as [ArtifactKind, ...ArtifactKind[]];

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
  /** ENTRADA: insumo estruturado do participante, da família do ritual (`RITUAL_INPUT_SCHEMAS`); `X-incident` traz também o gatilho do evento */
  input: z.object({
    mode: z.string().min(1),
    agenda: z.string().min(1),
    family: z.enum(RITUAL_FAMILIES),
    participant_input: z.literal('ParticipantInput+payload'),
    event_trigger: z.literal('EVENT_TRIGGER_SCHEMA').nullable(),
    from_digest: z.boolean(),
    depends_on: z.array(z.string()),
    workflow: z.string().nullable(),
    silence_rule: z.string().min(1),
  }).strict(),
  /** SAÍDA: cada rótulo do registro tem um tipo de artefato com esquema (`ARTIFACT_SCHEMAS`) + ata persistida */
  output: z.object({
    artifacts: z.array(z.object({ label: z.string().min(1), kind: z.enum(ARTIFACT_KINDS) }).strict()).min(1),
    minutes: z.object({ persisted: z.literal(true), record: z.literal('MeetingOutcomeRecord'), fields: z.array(z.string()).min(1), decisions: z.literal(true), actions: z.literal('idempotent_with_owner_due_evidence') }).strict(),
  }).strict(),
  route: z.string().min(1),
  authority: z.string().min(1),
  enabled: z.literal(false),
}).strict();
export type RitualSpec = z.infer<typeof RitualSpecSchema>;

// --- workflows ---------------------------------------------------------------------------------------------------------

const StageTokenSchema = z.object({
  token: z.string().min(1),
  kind: z.enum(['agent', 'step', 'gate']),
  agents: z.array(z.string()),
  /** esquema de evidência que a etapa precisa gerar (`STAGE_EVIDENCE_SCHEMAS`) */
  evidence: z.enum(STAGE_EVIDENCE_KINDS),
}).strict();

const GateSchema = z.object({
  id: z.string().regex(/^auto_gate_[a-z_]+$/),
  /** token da etapa depois da qual o gate vale */
  after: z.string().min(1),
  /** bloqueios do registro que o gate cobre (fail-closed) */
  blockers: z.array(z.string()).min(1),
  /** `registry` = já está nas etapas do registro; `proposal` = PROPOSTA da frente (o registro protegido não tem gate neste workflow) */
  source: z.enum(['registry', 'proposal']),
}).strict();

export const WorkflowSpecSchema = z.object({
  id: z.string().regex(/^WF\d{2}$/),
  name: z.string().min(1),
  triggers: z.array(z.string().min(1)).min(1),
  /** agente responsável */
  owner: z.string().min(1),
  /** etapas em ordem; os tokens de uma mesma etapa (`+`) rodam em paralelo */
  stages: z.array(z.object({ order: z.number().int().min(1), tokens: z.array(StageTokenSchema).min(1) }).strict()).min(1),
  /** todo workflow tem pelo menos um gate explícito, e os gates cobrem todos os bloqueios */
  gates: z.array(GateSchema).min(1),
  /** EVIDÊNCIA: artefato de saída, bloqueios fail-closed e texto da política do registro; cada etapa tem o seu esquema (`stages[].tokens[].evidence`) */
  evidence: z.object({ artifact: z.string().min(1), fail_closed_blockers: z.array(z.string()).min(1), policy: z.string() }).strict(),
  channel_flags: z.object({ instagram_enabled: z.boolean().optional(), channel_enabled: z.boolean().optional(), provider: z.string().optional() }).strict(),
  enabled: z.literal(false),
}).strict();
export type WorkflowSpec = z.infer<typeof WorkflowSpecSchema>;

export interface Catalog {
  schema: 'ln.agents.catalog/2';
  status: 'CATALOGO_DESLIGADO';
  /** nada roda nem chama modelo */
  runs: false;
  counts: { rituals: number; workflows: number };
  rituals: RitualSpec[];
  workflows: WorkflowSpec[];
  independence: EditorialIndependenceRule[];
}

/** Papéis de um workflow editorial que precisam ser de provedores diferentes do autor (v7 + PM-2026-11-23-G). */
export interface EditorialIndependenceRule {
  workflow: string;
  /** quem redige o texto (ou o autor do conteúdo checado, na auditoria) */
  authors: string[];
  checkers: string[];
  reviewers: string[];
  note: string;
}

export const EDITORIAL_INDEPENDENCE: EditorialIndependenceRule[] = [
  { workflow: 'WF02', authors: ['writer_{editoria}'], checkers: ['factcheck'], reviewers: ['editor_{editoria}'], note: 'redação ≠ checagem ≠ revisão como perfis; checagem e revisão de provedor diferente do redator (gate WF02); checagem e revisão podem dividir o provedor (v7)' },
  { workflow: 'WF03', authors: ['writer_{editoria}'], checkers: ['audit'], reviewers: [], note: 'auditoria pós-publicação por provedor diferente do autor do conteúdo publicado' },
  { workflow: 'WF05', authors: ['newsletter'], checkers: ['factcheck'], reviewers: [], note: 'checagem da newsletter por provedor diferente do autor do texto' },
  { workflow: 'WF08', authors: ['editor_{editoria}', 'writer_{editoria}'], checkers: ['factcheck'], reviewers: [], note: 'PM-2026-11-23-G: o texto da correção é redigido no Claude pelo editor (ou pelo redator) da editoria; a checagem fica no Codex; também difere do autor do conteúdo sob correção' },
];

/** Regra geral (PM-2026-11-23-G, item 2): quem checa um texto nunca está no mesmo provedor de quem o escreveu. */
export const WRITE_KINDS: readonly OrgTaskKind[] = ['editorial_draft', 'social_copy', 'correction_draft'];
export const CHECK_KINDS: readonly OrgTaskKind[] = ['fact_check', 'editorial_review', 'postpublication_audit'];

const expand = (id: string): string[] => (id.includes('{editoria}') ? EDITORIAS.map((e) => id.replace('{editoria}', e)) : [id]);

const NON_AGENT_GATE = /^auto_gate_/;

function ritualSpec(m: Meeting): RitualSpec {
  const labels = m.outputs;
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
      family: ritualFamily(m.id, m.cycle),
      participant_input: 'ParticipantInput+payload',
      event_trigger: m.cycle === 'event' ? 'EVENT_TRIGGER_SCHEMA' : null,
      from_digest: CONSOLIDATION_RITUAL_IDS.includes(m.id),
      depends_on: [...(m.depends_on ?? [])],
      workflow: m.workflow ?? null,
      silence_rule: m.silence_rule,
    },
    output: {
      // rótulo sem tipo vira kind 'minutes' só para o schema parsear; o validador o acusa em `OUTPUT_LABEL`
      artifacts: labels.map((label) => ({ label, kind: OUTPUT_LABEL_KIND[label] ?? 'minutes' })),
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
      const evidence: StageEvidenceKind = kind === 'agent' ? 'agent_output' : kind === 'gate' ? 'gate_verdict' : 'deterministic_step';
      return { token, kind, agents, evidence };
    }),
  }));
  // gates: os `auto_gate_*` do registro cobrem todos os bloqueios do workflow; sem eles, vale a proposta da frente
  const tokens = stages.flatMap((s) => s.tokens);
  const gates: WorkflowSpec['gates'] = tokens.flatMap((t, i) => (t.kind === 'gate' ? [{ id: t.token, after: tokens[i - 1]?.token ?? t.token, blockers: [...w.blockers], source: 'registry' as const }] : []));
  if (gates.length === 0 && PROPOSED_GATES[w.id]) {
    const p = PROPOSED_GATES[w.id]!;
    gates.push({ id: p.id, after: p.after, blockers: [...p.blockers], source: 'proposal' });
  }
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
    gates,
    evidence: { artifact: w.output, fail_closed_blockers: [...w.blockers], policy: (w as unknown as { policy?: string }).policy ?? '' },
    channel_flags: flags,
    enabled: false,
  };
}

export function buildCatalog(registries: Pick<LoadedRegistries, 'agents' | 'meetings' | 'workflows'>): Catalog {
  const ids = new Set(registries.agents.map((a: AgentProfile) => a.id));
  return {
    schema: 'ln.agents.catalog/2',
    status: 'CATALOGO_DESLIGADO',
    runs: false,
    counts: { rituals: registries.meetings.length, workflows: registries.workflows.length },
    rituals: registries.meetings.map(ritualSpec),
    workflows: registries.workflows.map((w) => workflowSpec(w, ids)),
    independence: EDITORIAL_INDEPENDENCE,
  };
}

// --- provedor e tarefa de cada perfil, dentro de um workflow -----------------------------------------------------------------

type OrgLike = Pick<OrgProfilesDraft, 'profiles'>;
const find = (org: OrgLike, id: string): OrgProfileDraft | undefined => org.profiles.find((p) => p.id === id);
/** provedor do perfil NO workflow (o editor redige a correção do WF08 em Claude, e revisa nos demais em Codex) */
export const providerIn = (org: OrgLike, id: string, wf: string): string | null => find(org, id)?.workflow_tasks[wf]?.provider ?? find(org, id)?.execution.provider ?? null;
export const kindIn = (org: OrgLike, id: string, wf: string): OrgTaskKind | null => find(org, id)?.workflow_tasks[wf]?.task_kind ?? find(org, id)?.task_kind ?? null;

export interface WriteCheckPair { workflow: string; writer: string; checker: string; writerProvider: string | null; checkerProvider: string | null }

/** Todo passo de escrita seguido de um passo de checagem, em cada workflow, derivado das etapas e dos perfis (regra geral do PM). */
export function writeCheckPairs(catalog: Catalog, org: OrgLike): WriteCheckPair[] {
  const out: WriteCheckPair[] = [];
  for (const w of catalog.workflows) {
    const writers: string[] = [];
    for (const stage of w.stages) {
      const agents = stage.tokens.flatMap((t) => (t.kind === 'agent' ? t.agents : []));
      for (const checker of agents) {
        if (!CHECK_KINDS.includes(kindIn(org, checker, w.id) as OrgTaskKind)) continue;
        for (const writer of writers) out.push({ workflow: w.id, writer, checker, writerProvider: providerIn(org, writer, w.id), checkerProvider: providerIn(org, checker, w.id) });
      }
      for (const a of agents) if (WRITE_KINDS.includes(kindIn(org, a, w.id) as OrgTaskKind)) writers.push(a);
    }
  }
  return out;
}

// --- validação ----------------------------------------------------------------------------------------------------------

export interface CatalogIssue { code: string; message: string }

export const CATALOG_EXPECTED = { rituals: 28, workflows: 19 } as const;

/**
 * Falha fechada: exatamente 28 e 19; ids únicos; schema; todo participante, presidente, dono e agente de passo é um dos 64 perfis;
 * tudo desligado; todo rótulo de saída tem esquema; todo workflow tem gate explícito que cobre os bloqueios; toda etapa tem esquema de
 * evidência; e a independência editorial (papéis distintos, provedores diferentes, e a regra geral "quem checa não está no provedor de
 * quem escreveu") calculada sobre os 64 perfis na política v7.
 */
export function validateCatalog(catalog: Catalog, registries: Pick<LoadedRegistries, 'agents'>, org: OrgLike): CatalogIssue[] {
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
    if ((r.cycle === 'event') !== (r.input.event_trigger !== null)) add('RITUAL_TRIGGER', `${r.id}: só o ritual por evento tem gatilho de evento`);
    if (r.input.family !== ritualFamily(r.id, r.cycle)) add('RITUAL_FAMILY', `${r.id}: família de entrada incoerente com o ciclo`);
    for (const a of r.output.artifacts) if (!(a.label in OUTPUT_LABEL_KIND)) add('OUTPUT_LABEL', `${r.id}: saída "${a.label}" sem esquema de artefato`);
  }
  for (const w of catalog.workflows) {
    const p = WorkflowSpecSchema.safeParse(w);
    if (!p.success) add('WORKFLOW_SCHEMA', `${w.id}: ${p.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    if (!ids.has(w.owner)) add('WORKFLOW_OWNER', `${w.id}: responsável ${w.owner} não é um dos 64 perfis`);
    const tokens = new Set(w.stages.flatMap((s) => s.tokens.map((t) => t.token)));
    for (const s of w.stages) for (const t of s.tokens) {
      if (t.kind === 'agent') for (const a of t.agents) if (!ids.has(a)) add('WORKFLOW_AGENT', `${w.id}: agente ${a} não é um dos 64 perfis`);
      const want: StageEvidenceKind = t.kind === 'agent' ? 'agent_output' : t.kind === 'gate' ? 'gate_verdict' : 'deterministic_step';
      if (t.evidence !== want) add('STAGE_EVIDENCE', `${w.id}/${t.token}: esquema de evidência ${t.evidence} incoerente com o tipo ${t.kind}`);
    }
    // gates: pelo menos um; cada um cobre bloqueios do registro, está depois de uma etapa existente, e juntos cobrem todos
    if (w.gates.length === 0) add('GATE_MISSING', `${w.id}: sem gate explícito`);
    const covered = new Set<string>();
    for (const g of w.gates) {
      if (!tokens.has(g.after)) add('GATE_AFTER', `${w.id}/${g.id}: etapa "${g.after}" inexistente`);
      for (const b of g.blockers) {
        if (!w.evidence.fail_closed_blockers.includes(b)) add('GATE_BLOCKER', `${w.id}/${g.id}: bloqueio ${b} não está no registro`);
        covered.add(b);
      }
      if (g.source === 'proposal' && tokens.has(g.id)) add('GATE_SOURCE', `${w.id}/${g.id}: gate proposto já existe nas etapas do registro`);
    }
    for (const b of w.evidence.fail_closed_blockers) if (!covered.has(b)) add('GATE_COVERAGE', `${w.id}: bloqueio ${b} sem gate que o cubra`);
  }

  // independência editorial por papel (regras explícitas, por editoria)
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
      // checagem e revisão precisam fazer parte das etapas (o autor pode ser o conteúdo produzido antes do workflow, como na auditoria)
      for (const a of [...checkers, ...reviewers]) {
        const stepOnly = rule.workflow === 'WF03' && a === 'audit';
        if (!stepOnly && !inWf.has(a)) add('INDEPENDENCE_STEP', `${rule.workflow}/${edKey}: ${a} não aparece nas etapas do workflow`);
      }
      const authorProviders = new Set(authors.map((a) => providerIn(org, a, rule.workflow)));
      if (authorProviders.has(null) || authors.length === 0) add('INDEPENDENCE_PROVIDER', `${rule.workflow}/${edKey}: autor sem provedor definido`);
      for (const c of [...checkers, ...reviewers]) {
        const pc = providerIn(org, c, rule.workflow);
        if (pc === null) add('INDEPENDENCE_PROVIDER', `${rule.workflow}/${edKey}: ${c} sem provedor definido`);
        else if (authorProviders.has(pc)) add('INDEPENDENCE_PROVIDER', `${rule.workflow}/${edKey}: ${c} usa o mesmo provedor (${pc}) do autor do conteúdo`);
      }
    }
  }
  for (const id of new Set(catalog.independence.map((r) => r.workflow))) {
    if (catalog.independence.filter((r) => r.workflow === id).length !== 1) add('INDEPENDENCE_RULE', `${id}: mais de uma regra`);
  }
  // regra geral: todo passo de escrita seguido de checagem, em TODOS os workflows
  for (const pair of writeCheckPairs(catalog, org)) {
    if (pair.writerProvider === null || pair.checkerProvider === null) add('WRITE_CHECK_PROVIDER', `${pair.workflow}: ${pair.writer} → ${pair.checker} sem provedor definido`);
    else if (pair.writerProvider === pair.checkerProvider) add('WRITE_CHECK_SAME_PROVIDER', `${pair.workflow}: ${pair.checker} checa o texto de ${pair.writer} no mesmo provedor (${pair.checkerProvider})`);
    if (pair.writer === pair.checker) add('WRITE_CHECK_SAME_AGENT', `${pair.workflow}: ${pair.checker} checa o próprio texto`);
  }
  return issues;
}

/** Informativo: workflows em que checagem e revisão usam o MESMO provedor (permitido: ambos só precisam diferir do redator, PM-2026-11-23-G). */
export function checkReviewSameProvider(catalog: Catalog, org: OrgLike): string[] {
  const out: string[] = [];
  for (const rule of catalog.independence) {
    if (rule.checkers.length === 0 || rule.reviewers.length === 0) continue;
    const c = rule.checkers.map((x) => providerIn(org, x.replace('{editoria}', 'mercado'), rule.workflow));
    const r = rule.reviewers.map((x) => providerIn(org, x.replace('{editoria}', 'mercado'), rule.workflow));
    if (c.some((p) => p !== null && r.includes(p))) out.push(rule.workflow);
  }
  return out;
}
