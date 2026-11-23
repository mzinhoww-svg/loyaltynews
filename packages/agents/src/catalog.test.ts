import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { buildOrgProfiles } from './org-profiles';
import { buildCatalog, checkReviewSameProvider, runIndependenceIssues, validateCatalog, validateStageEvidence, writeCheckPairs, RitualSpecSchema, WorkflowSpecSchema, type Catalog } from './catalog';
import { buildCatalogArtifacts } from './catalog-doc';
import { ARTIFACT_SCHEMAS, EVENT_KIND_RULES, EVENT_TRIGGER_SCHEMA, OUTPUT_LABEL_KIND, PROPOSED_GATES, RITUAL_INPUT_SCHEMAS, STAGE_EVIDENCE_SCHEMAS, eventTriggerKey, ritualFamily } from './catalog-schemas';

const registries = loadRegistries();
const org = buildOrgProfiles(registries);
const catalog = buildCatalog(registries);
const issues = (c: Catalog, o = org) => validateCatalog(c, registries, o).map((i) => i.code);
const sha = 'a'.repeat(64);

describe('catálogo dos 28 rituais e 19 workflows (desligado, nada roda)', () => {
  it('tem exatamente 28 rituais e 19 workflows, ids únicos, tudo desligado, sem validação com erro', () => {
    expect(catalog.rituals).toHaveLength(28);
    expect(catalog.workflows).toHaveLength(19);
    expect(new Set(catalog.rituals.map((r) => r.id)).size).toBe(28);
    expect(new Set(catalog.workflows.map((w) => w.id)).size).toBe(19);
    expect(catalog.runs).toBe(false);
    expect(catalog.status).toBe('CATALOGO_DESLIGADO');
    expect(catalog.rituals.every((r) => r.enabled === false)).toBe(true);
    expect(catalog.workflows.every((w) => w.enabled === false)).toBe(true);
    expect(validateCatalog(catalog, registries, org)).toEqual([]);
    const byCycle = (c: string) => catalog.rituals.filter((r) => r.cycle === c).length;
    expect([byCycle('weekday'), byCycle('weekly'), byCycle('monthly'), byCycle('event')]).toEqual([18, 6, 3, 1]);
  });

  it('todo participante, presidente, responsável e agente de passo é um dos 64 perfis; schemas estritos passam', () => {
    const ids = new Set(registries.agents.map((a) => a.id));
    expect(ids.size).toBe(64);
    for (const r of catalog.rituals) {
      expect(RitualSpecSchema.safeParse(r).success, r.id).toBe(true);
      expect(ids.has(r.chair), r.id).toBe(true);
      expect(r.participants.every((p) => ids.has(p)), r.id).toBe(true);
      expect(r.participants).toContain(r.chair);
      expect(r.output.minutes.persisted).toBe(true);
    }
    for (const w of catalog.workflows) {
      expect(WorkflowSpecSchema.safeParse(w).success, w.id).toBe(true);
      expect(ids.has(w.owner), w.id).toBe(true);
      for (const s of w.stages) for (const t of s.tokens) expect(t.agents.every((a) => ids.has(a))).toBe(true);
    }
  });

  it('cadência, entrada, saída e ata de rituais; etapas, gate e evidência de workflows', () => {
    const sync = catalog.rituals.find((r) => r.id === 'D-sync')!;
    expect(sync.cadence).toMatchObject({ schedule_local: '07:25', timezone: 'America/Sao_Paulo' });
    expect(sync.input.depends_on).toEqual(['D-trust', 'D-intelligence', 'D-editorial', 'D-creative', 'D-growth']);
    expect(catalog.rituals.find((r) => r.id === 'W-pautas')!.input.workflow).toBe('WF12');
    expect(catalog.rituals.find((r) => r.id === 'M-board')!.input.from_digest).toBe(true);
    const wf02 = catalog.workflows.find((w) => w.id === 'WF02')!;
    expect(wf02.owner).toBe('director_editorial');
    expect(wf02.gates).toEqual([expect.objectContaining({ id: 'auto_gate_editor', source: 'registry', after: 'editor_{editoria}' })]);
    expect(wf02.stages.map((s) => s.tokens.map((t) => t.token))).toEqual([['writer_{editoria}'], ['factcheck', 'rights'], ['editor_{editoria}'], ['auto_gate_editor']]);
    expect(wf02.stages[0]!.tokens[0]!.agents).toHaveLength(10);
    expect(wf02.evidence.fail_closed_blockers).toContain('cross_provider_check_failed');
    expect(catalog.workflows.find((w) => w.id === 'WF04')!.channel_flags).toMatchObject({ instagram_enabled: false });
    expect(catalog.workflows.find((w) => w.id === 'WF05')!.channel_flags).toMatchObject({ channel_enabled: false });
  });
});

describe('lacunas fechadas: entrada e saída por ritual, gate explícito e evidência por etapa', () => {
  it('cada ritual tem família de entrada; o X-incident tem gatilho; as famílias casam com o ciclo', () => {
    const fam = (id: string) => catalog.rituals.find((r) => r.id === id)!.input.family;
    expect(fam('D-mercado')).toBe('newsroom_daily');
    expect(fam('D-editorial')).toBe('directorate_daily');
    expect(fam('D-sync')).toBe('sync');
    expect(fam('W-trust')).toBe('weekly');
    expect(fam('M-board')).toBe('monthly');
    expect(fam('X-incident')).toBe('event');
    expect(catalog.rituals.filter((r) => r.input.event_trigger !== null).map((r) => r.id)).toEqual(['X-incident']);
    expect(catalog.rituals.filter((r) => r.input.family === 'newsroom_daily')).toHaveLength(10);
    expect(ritualFamily('D-trust', 'weekday')).toBe('directorate_daily');
  });

  it('as entradas de cada família validam um exemplo bom e recusam o ruim (campo a mais, sem evidência)', () => {
    const base = { agent_id: 'writer_mercado', summary: 'ok', blockers: [], evidence_refs: [], decisions: [] };
    expect(RITUAL_INPUT_SCHEMAS.newsroom_daily.safeParse({ ...base, payload: { candidates: [{ topic: 't', source_ref: 's1', evidence_refs: ['e1'] }] } }).success).toBe(true);
    expect(RITUAL_INPUT_SCHEMAS.newsroom_daily.safeParse({ ...base, payload: { candidates: [{ topic: 't', source_ref: 's1', evidence_refs: [] }] } }).success).toBe(false);
    expect(RITUAL_INPUT_SCHEMAS.newsroom_daily.safeParse({ ...base, payload: { candidates: [], extra: 1 } }).success).toBe(false);
    expect(RITUAL_INPUT_SCHEMAS.directorate_daily.safeParse({ ...base, payload: { status: 'ok', kpi_observations: [{ kpi: 'k', value: 1, source_ref: 'm1' }], escalations: [] } }).success).toBe(true);
    expect(RITUAL_INPUT_SCHEMAS.sync.safeParse({ ...base, payload: { priorities: ['a'], dependencies: [{ on: 'D-trust', state: 'ok' }] } }).success).toBe(true);
    expect(RITUAL_INPUT_SCHEMAS.weekly.safeParse({ ...base, payload: { topics: [{ subject: 's', evidence_refs: ['e'] }] } }).success).toBe(true);
    expect(RITUAL_INPUT_SCHEMAS.monthly.safeParse({ ...base, payload: { assessment: 'a', metrics: [{ metric: 'receita', value: 10, period: '2026-10', source_ref: 'm2' }] } }).success).toBe(true);
    expect(RITUAL_INPUT_SCHEMAS.event.safeParse({ ...base, payload: { containment_proposals: [{ text: 'isolar', evidence_refs: ['e1'] }] } }).success).toBe(true);
    expect(EVENT_TRIGGER_SCHEMA.safeParse({ kind: 'incident', ref: 'inc-1', raised_at: '2026-11-24T08:00:00-03:00', severity: 'high' }).success).toBe(true);
    expect(EVENT_TRIGGER_SCHEMA.safeParse({ kind: 'outro', ref: 'x', raised_at: 'y' }).success).toBe(false);
  });

  it('todo rótulo de saída dos 28 rituais tem tipo e esquema de artefato; exemplos válidos e inválidos', () => {
    const labels = new Set(catalog.rituals.flatMap((r) => r.output.artifacts.map((a) => a.label)));
    expect(labels.size).toBe(35);
    for (const l of labels) expect(OUTPUT_LABEL_KIND[l], l).toBeDefined();
    expect(Object.keys(OUTPUT_LABEL_KIND)).toHaveLength(35);
    for (const r of catalog.rituals) for (const a of r.output.artifacts) expect(a.kind in ARTIFACT_SCHEMAS, `${r.id}/${a.label}`).toBe(true);
    const task = { title: 't', owner: 'writer_mercado', due_in_business_days: 1, evidence_refs: ['e'], risk: 'low', authority_class: 'automatic' };
    expect(ARTIFACT_SCHEMAS.task_list.safeParse({ items: [task] }).success).toBe(true);
    expect(ARTIFACT_SCHEMAS.task_list.safeParse({ items: [{ ...task, evidence_refs: [] }] }).success).toBe(false); // tarefa sem evidência
    expect(ARTIFACT_SCHEMAS.task_list.safeParse({ items: [{ ...task, risk: 'x' }] }).success).toBe(false);
    expect(ARTIFACT_SCHEMAS.priority_list.safeParse({ items: [] }).success).toBe(false); // pauta vazia não é pauta
    expect(ARTIFACT_SCHEMAS.status_report.safeParse({ state: 'status_only', summary: 'sem fatos novos', evidence_refs: [] }).success).toBe(true);
    expect(ARTIFACT_SCHEMAS.minutes.safeParse({ summary: 's', blockers: [], evidence_refs: [], outputs: [], notes: [] }).success).toBe(true);
    expect(ARTIFACT_SCHEMAS.decision_list.safeParse({ items: [{ text: 'd', proposed_by: 'publisher', authority_class: 'owner_reserved', executes_alone: false, evidence_refs: ['e'] }] }).success).toBe(true);
  });

  it('todo workflow tem gate explícito que cobre todos os bloqueios; os 5 sem gate no registro ganham gate proposto', () => {
    for (const w of catalog.workflows) {
      expect(w.gates.length, w.id).toBeGreaterThanOrEqual(1);
      const covered = new Set(w.gates.flatMap((g) => [...g.blockers, ...Object.keys(g.soft), ...Object.keys(g.routes)]));
      for (const b of w.evidence.fail_closed_blockers) expect(covered.has(b), `${w.id}/${b}`).toBe(true);
    }
    const proposed = catalog.workflows.filter((w) => w.gates.some((g) => g.source === 'proposal')).map((w) => w.id);
    expect(proposed).toEqual(['WF01', 'WF03', 'WF09', 'WF14', 'WF16']);
    expect(Object.keys(PROPOSED_GATES)).toEqual(proposed);
    expect(catalog.workflows.find((w) => w.id === 'WF03')!.gates[0]).toMatchObject({ id: 'auto_gate_publish', after: 'validate_revision', source: 'proposal', blockers: ['stale_approval', 'embargo'] });
    expect(catalog.workflows.filter((w) => w.gates.every((g) => g.source === 'registry'))).toHaveLength(14);
  });

  it('toda etapa tem esquema de evidência coerente com o tipo; o gate falha fechado sem bloqueio no fail', () => {
    for (const w of catalog.workflows) for (const s of w.stages) for (const t of s.tokens) {
      expect(t.evidence, `${w.id}/${t.token}`).toBe(t.kind === 'agent' ? 'agent_output' : t.kind === 'gate' ? 'gate_verdict' : 'deterministic_step');
    }
    const base = { workflow_id: 'WF02', run_id: 'r1', step: 'auto_gate_editor', input_sha256: sha, output_sha256: sha, evidence_refs: ['e1'], at: '2026-11-24T10:00:00-03:00' };
    expect(STAGE_EVIDENCE_SCHEMAS.gate_verdict.safeParse({ ...base, actor: 'deterministic', verdict: 'pass', blockers: [] }).success).toBe(true);
    expect(STAGE_EVIDENCE_SCHEMAS.gate_verdict.safeParse({ ...base, actor: 'deterministic', verdict: 'fail', blockers: ['copy_literal'] }).success).toBe(true);
    expect(STAGE_EVIDENCE_SCHEMAS.gate_verdict.safeParse({ ...base, actor: 'deterministic', verdict: 'pass', blockers: ['copy_literal'] }).success).toBe(false);
    expect(STAGE_EVIDENCE_SCHEMAS.gate_verdict.safeParse({ ...base, actor: 'deterministic', verdict: 'fail', blockers: [] }).success).toBe(false);
    const agentRec = { ...base, step: 'factcheck', actor: 'factcheck', declared_model: 'gpt-6.1-terra', provider: 'openai', account: 'codex', cost_ref: 'cost-1', output_contract_valid: true };
    expect(STAGE_EVIDENCE_SCHEMAS.agent_output.safeParse(agentRec).success).toBe(true);
    expect(STAGE_EVIDENCE_SCHEMAS.agent_output.safeParse({ ...agentRec, evidence_refs: [] }).success).toBe(false);
    expect(STAGE_EVIDENCE_SCHEMAS.agent_output.safeParse({ ...agentRec, declared_model: undefined }).success).toBe(false); // sem modelo declarado
    expect(STAGE_EVIDENCE_SCHEMAS.deterministic_step.safeParse({ ...base, actor: 'deterministic', idempotency_key: 'k' }).success).toBe(true);
    expect(STAGE_EVIDENCE_SCHEMAS.deterministic_step.safeParse({ ...base, actor: 'deterministic', input_sha256: 'nao-e-hash', idempotency_key: 'k' }).success).toBe(false);
  });
});

describe('independência editorial (PM-2026-11-23-G): papel e provedor diferentes; quem checa nunca está no provedor de quem escreveu', () => {
  const provider = (id: string, wf?: string) => (wf ? (org.profiles.find((p) => p.id === id)!.workflow_tasks[wf]?.provider ?? org.profiles.find((p) => p.id === id)!.execution.provider) : org.profiles.find((p) => p.id === id)!.execution.provider);

  it('regras por editoria em WF02, WF03, WF05 e WF08 passam; checagem e revisão podem dividir o provedor', () => {
    expect(catalog.independence.map((r) => r.workflow)).toEqual(['WF02', 'WF03', 'WF05', 'WF08']);
    expect(issues(catalog)).toEqual([]);
    expect(provider('writer_mercado')).toBe('anthropic');
    expect(provider('factcheck')).toBe('openai');
    expect(provider('editor_mercado')).toBe('openai'); // revisor nos demais workflows
    expect(checkReviewSameProvider(catalog, org)).toEqual(['WF02']);
  });

  it('WF08: o texto da correção é redigido no Claude pelo editor ou pelo redator; o factcheck segue no Codex', () => {
    expect(provider('editor_pontos', 'WF08')).toBe('anthropic');
    expect(org.profiles.find((p) => p.id === 'editor_pontos')!.workflow_tasks.WF08).toMatchObject({ task_kind: 'correction_draft', account: 'claude', provider: 'anthropic' });
    expect(provider('writer_pontos', 'WF08')).toBe('anthropic');
    expect(provider('factcheck', 'WF08')).toBe('openai');
    const rule = catalog.independence.find((r) => r.workflow === 'WF08')!;
    expect(rule.authors).toEqual(['editor_{editoria}', 'writer_{editoria}']);
    expect(rule.checkers).toEqual(['factcheck']);
    expect(rule.reviewers).toEqual([]);
    expect(org.profiles.filter((p) => p.id.startsWith('editor_')).every((p) => p.workflow_tasks.WF08 !== undefined)).toBe(true);
  });

  it('regra geral: todo passo de escrita seguido de checagem, em todos os workflows, tem provedor diferente e perfil diferente', () => {
    const pairs = writeCheckPairs(catalog, org);
    expect([...new Set(pairs.map((p) => p.workflow))]).toEqual(['WF01', 'WF02', 'WF05', 'WF08']);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.writerProvider, `${p.workflow} ${p.writer}`).not.toBeNull();
      expect(p.checkerProvider).not.toBeNull();
      expect(p.writerProvider, `${p.workflow}: ${p.checker} checa ${p.writer}`).not.toBe(p.checkerProvider);
      expect(p.writer).not.toBe(p.checker);
    }
    expect(pairs.some((p) => p.workflow === 'WF08' && p.writer === 'editor_travel' && p.checker === 'factcheck')).toBe(true);
    expect(pairs.some((p) => p.workflow === 'WF02' && p.writer === 'writer_tech' && p.checker === 'editor_tech')).toBe(true);
    expect(pairs.some((p) => p.workflow === 'WF05' && p.writer === 'newsletter' && p.checker === 'factcheck')).toBe(true);
  });

  it('falha fechada: contagem, id repetido, participante fora dos 64, perfil ligado, rótulo sem esquema, gate removido, evidência incoerente', () => {
    const bad = structuredClone(catalog);
    bad.rituals.pop();
    bad.workflows[1]!.id = 'WF01';
    bad.rituals[0]!.participants.push('fantasma');
    (bad.rituals[1] as { enabled: boolean }).enabled = true;
    bad.workflows[2]!.owner = 'ninguem';
    bad.rituals[2]!.output.artifacts[0]!.label = 'rótulo novo sem esquema';
    bad.workflows[0]!.gates = [];
    bad.workflows[3]!.stages[0]!.tokens[0]!.evidence = 'gate_verdict';
    bad.workflows[4]!.gates[0]!.blockers = [];
    const codes = issues(bad);
    expect(codes).toEqual(expect.arrayContaining(['COUNT_RITUALS', 'ID_DUP', 'RITUAL_PARTICIPANT', 'RITUAL_SCHEMA', 'WORKFLOW_OWNER', 'OUTPUT_LABEL', 'GATE_MISSING', 'STAGE_EVIDENCE', 'WORKFLOW_SCHEMA']));
  });

  it('falha fechada na independência: checador no provedor do redator, sem provedor, papel repetido, perfil inexistente, WF08 corrigido em Codex', () => {
    const mixed = structuredClone(org);
    mixed.profiles.find((p) => p.id === 'factcheck')!.execution.provider = 'anthropic';
    expect(issues(catalog, mixed)).toEqual(expect.arrayContaining(['INDEPENDENCE_PROVIDER', 'WRITE_CHECK_SAME_PROVIDER']));
    const noProvider = structuredClone(org);
    noProvider.profiles.find((p) => p.id === 'editor_travel')!.execution.provider = null;
    expect(issues(catalog, noProvider)).toContain('INDEPENDENCE_PROVIDER');
    const same = structuredClone(catalog);
    same.independence[0]!.checkers = ['writer_{editoria}'];
    expect(issues(same)).toContain('INDEPENDENCE_ROLES');
    const unknown = structuredClone(catalog);
    unknown.independence[0]!.reviewers = ['revisor_inexistente'];
    expect(issues(unknown)).toContain('INDEPENDENCE_PROFILE');
    const codex = structuredClone(org);
    codex.profiles.find((p) => p.id === 'editor_bancos')!.workflow_tasks.WF08!.provider = 'openai'; // correção redigida no mesmo provedor da checagem
    expect(issues(catalog, codex)).toEqual(expect.arrayContaining(['WRITE_CHECK_SAME_PROVIDER', 'INDEPENDENCE_PROVIDER']));
  });

  it('o gerador do catálogo e da tabela de lacunas é determinístico e registra o que fechou e o que segue aberto', () => {
    const a = buildCatalogArtifacts(registries);
    const b = buildCatalogArtifacts(registries);
    expect(a).toEqual(b);
    for (const id of ['G-R1', 'G-R2', 'G-R3', 'G-W1', 'G-W2', 'G-W3', 'G-P1', 'G-I1', 'G-I2']) expect(a['catalog-gaps.md']).toContain(id);
    expect(a['catalog-gaps.md']).toMatch(/G-W3 \| \*\*aberta\*\*/);
    expect(a['catalog-gaps.md']).toMatch(/G-I1 \| resolvida/);
    expect(JSON.parse(a['catalog.json'])).toMatchObject({ schema: 'ln.agents.catalog/2', runs: false, counts: { rituals: 28, workflows: 19 } });
    expect(a['catalog-gaps.md']).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });
});

describe('ratificação G-P1 (Chief Architect) com ajustes: um teste por ajuste', () => {
  const dir = { agent_id: 'director_growth', summary: 's', blockers: [], evidence_refs: [], decisions: [] };
  const sub = { source_ref: 'm1' };

  it('G-R1 (1): KPI e métricas com source_ref; valor null só com unavailable_reason (nunca zero falso)', () => {
    const kpi = (o: object) => RITUAL_INPUT_SCHEMAS.directorate_daily.safeParse({ ...dir, payload: { status: 'ok', escalations: [], kpi_observations: [o] } }).success;
    expect(kpi({ kpi: 'cliques', value: 12, ...sub })).toBe(true);
    expect(kpi({ kpi: 'cliques', value: 12 })).toBe(false); // sem origem
    expect(kpi({ kpi: 'cliques', value: null, ...sub })).toBe(false); // null sem motivo
    expect(kpi({ kpi: 'cliques', value: null, ...sub, unavailable_reason: 'provedor fora do ar' })).toBe(true);
    expect(kpi({ kpi: 'cliques', value: 0, ...sub, unavailable_reason: 'x' })).toBe(false); // motivo com valor numérico
    const met = (o: object) => RITUAL_INPUT_SCHEMAS.monthly.safeParse({ ...dir, payload: { assessment: 'a', metrics: [o] } }).success;
    expect(met({ metric: 'receita', period: '2026-10', value: null, ...sub, unavailable_reason: 'sem fechamento' })).toBe(true);
    expect(met({ metric: 'receita', period: '2026-10', value: null, ...sub })).toBe(false);
    expect(met({ metric: 'receita', period: '2026-10', value: 3 })).toBe(false);
  });

  it('G-R1 (2): containment_proposals são {text, evidence_refs}, não string solta', () => {
    const ev = (c: unknown) => RITUAL_INPUT_SCHEMAS.event.safeParse({ ...dir, payload: { containment_proposals: c } }).success;
    expect(ev([{ text: 'isolar o serviço', evidence_refs: ['e1'] }])).toBe(true);
    expect(ev(['isolar o serviço'])).toBe(false);
    expect(ev([{ text: 'isolar', evidence_refs: [] }])).toBe(false);
  });

  it('G-R3 (1): raised_at é ISO 8601 com fuso, validado (não string livre)', () => {
    const t = (raised_at: string) => EVENT_TRIGGER_SCHEMA.safeParse({ kind: 'dependency', ref: 'dep-1', raised_at }).success;
    expect(t('2026-11-24T08:00:00-03:00')).toBe(true);
    expect(t('2026-11-24T11:00:00Z')).toBe(true);
    expect(t('2026-11-24T08:00:00')).toBe(false); // sem fuso
    expect(t('ontem de manhã')).toBe(false);
    expect(t('2026-13-45T99:00:00Z')).toBe(false); // data impossível
  });

  it('G-R3 (2): severity obrigatória quando kind = incident', () => {
    const base = { ref: 'x', raised_at: '2026-11-24T08:00:00Z' };
    expect(EVENT_TRIGGER_SCHEMA.safeParse({ ...base, kind: 'incident' }).success).toBe(false);
    expect(EVENT_TRIGGER_SCHEMA.safeParse({ ...base, kind: 'incident', severity: 'medium' }).success).toBe(true);
    expect(EVENT_TRIGGER_SCHEMA.safeParse({ ...base, kind: 'breaking' }).success).toBe(true);
  });

  it('G-R3 (3): idempotência do gatilho por kind + ref (o mesmo incidente não abre dois rituais)', () => {
    expect(eventTriggerKey({ kind: 'incident', ref: 'inc-7' })).toBe('incident+inc-7');
    expect(eventTriggerKey({ kind: 'incident', ref: 'inc-7' })).toBe(eventTriggerKey({ kind: 'incident', ref: 'inc-7' }));
    expect(eventTriggerKey({ kind: 'incident', ref: 'inc-7' })).not.toBe(eventTriggerKey({ kind: 'breaking', ref: 'inc-7' }));
    const x = catalog.rituals.find((r) => r.id === 'X-incident')!;
    expect(x.input.event_rules).toMatchObject({ idempotency: 'kind+ref' });
  });

  it('G-R3 (regra): breaking decide contenção e prioridade e NÃO dispensa WF02 e WF03', () => {
    expect(EVENT_KIND_RULES.breaking).toMatchObject({ bypasses_editorial_gates: false, still_requires: ['WF02', 'WF03'] });
    const x = catalog.rituals.find((r) => r.id === 'X-incident')!;
    expect(x.input.event_rules).toMatchObject({ breaking_bypasses_editorial_gates: false, breaking_still_requires: ['WF02', 'WF03'] });
    expect(catalog.workflows.find((w) => w.id === 'WF02')!.gates.length).toBeGreaterThan(0);
    expect(catalog.workflows.find((w) => w.id === 'WF03')!.gates.length).toBeGreaterThan(0);
    const bad = structuredClone(catalog);
    bad.workflows.find((w) => w.id === 'WF03')!.gates = [];
    expect(issues(bad)).toContain('EVENT_RULES');
  });

  it('G-R2 (1): metric_report aceita value null com unavailable_reason, e recusa null sem motivo', () => {
    const rep2 = (o: object) => ARTIFACT_SCHEMAS.metric_report.safeParse({ items: [o] }).success;
    expect(rep2({ metric: 'forecast', period: '2026-12', value: 1000, source_ref: 'f1' })).toBe(true);
    expect(rep2({ metric: 'forecast', period: '2026-12', value: null, source_ref: 'f1', unavailable_reason: 'sem base' })).toBe(true);
    expect(rep2({ metric: 'forecast', period: '2026-12', value: null, source_ref: 'f1' })).toBe(false);
    expect(rep2({ metric: 'forecast', period: '2026-12', value: 0 })).toBe(false); // sem origem
  });

  it('G-R2 (2): decisão owner_reserved nunca executa sozinha (D01); automatic e protected seguem a alçada', () => {
    const dec = (authority_class: string, executes_alone: boolean) => ARTIFACT_SCHEMAS.decision_list.safeParse({ items: [{ text: 'd', proposed_by: 'publisher', authority_class, executes_alone, evidence_refs: ['e'] }] }).success;
    expect(dec('owner_reserved', false)).toBe(true);
    expect(dec('owner_reserved', true)).toBe(false);
    expect(dec('automatic', true)).toBe(true);
    expect(dec('protected', false)).toBe(true);
    expect(OUTPUT_LABEL_KIND['decisões sujeitas a aprovação humana']).toBe('decision_list');
  });

  it('G-R2 (3): proposal.budget_usd é só proposta e não reserva (ADR-015)', () => {
    const p = (o: object) => ARTIFACT_SCHEMAS.proposal.safeParse({ title: 't', rationale: 'r', authority_class: 'protected', evidence_refs: ['e'], ...o }).success;
    expect(p({ budget_usd: 5, reserves_budget: false })).toBe(true);
    expect(p({ budget_usd: 5, reserves_budget: true })).toBe(false);
    expect(p({ budget_usd: 5 })).toBe(false); // a proposta declara que não reserva
  });

  it('G-W1 WF03: a despublicação nunca passa pelo gate (vem depois dele e fica fora do teto)', () => {
    const g = catalog.workflows.find((w) => w.id === 'WF03')!.gates[0]!;
    expect(g).toMatchObject({ id: 'auto_gate_publish', after: 'validate_revision', never_gated: ['unpublish_if_failed'], source: 'proposal' });
    const bad = structuredClone(catalog);
    bad.workflows.find((w) => w.id === 'WF03')!.gates[0]!.after = 'unpublish_if_failed';
    expect(issues(bad)).toContain('GATE_NEVER');
    const missing = structuredClone(catalog);
    missing.workflows.find((w) => w.id === 'WF03')!.gates[0]!.never_gated = ['etapa_que_nao_existe'];
    expect(issues(missing)).toContain('GATE_NEVER');
  });

  it('G-W1 WF09: métrica velha ou sem provedor sai "não disponível" sem bloquear; o gate falha só com valor velho como atual ou nenhuma métrica válida', () => {
    const g = catalog.workflows.find((w) => w.id === 'WF09')!.gates[0]!;
    expect(g.blockers).toEqual([]);
    expect(g.soft).toEqual({ stale_data: 'mark_unavailable', provider_unavailable: 'mark_unavailable' });
    expect(g.fail_conditions.map((c) => c.id)).toEqual(['stale_value_presented_as_current', 'no_valid_metric']);
    expect(g.fail_conditions.every((c) => catalog.workflows.find((w) => w.id === 'WF09')!.evidence.fail_closed_blockers.includes(c.blocker))).toBe(true);
    expect(PROPOSED_GATES.WF09!.blockers).toEqual([]);
    expect(issues(catalog)).toEqual([]); // os bloqueios brandos continuam cobertos
    const bad = structuredClone(catalog);
    const gate = bad.workflows.find((w) => w.id === 'WF09')!.gates[0]!;
    gate.soft = {};
    gate.fail_conditions = [];
    expect(issues(bad)).toEqual(expect.arrayContaining(['WORKFLOW_SCHEMA', 'GATE_COVERAGE']));
  });

  it('G-W1 WF16: overdue vira desvio para escalate_overdue; os bloqueios duros são missing_owner e unverified_completion', () => {
    const g = catalog.workflows.find((w) => w.id === 'WF16')!.gates[0]!;
    expect(g.blockers).toEqual(['missing_owner', 'unverified_completion']);
    expect(g.routes).toEqual({ overdue: 'escalate_overdue' });
    expect(issues(catalog)).toEqual([]);
    const hard = structuredClone(catalog);
    hard.workflows.find((w) => w.id === 'WF16')!.gates[0]!.blockers.push('overdue');
    expect(issues(hard)).toContain('GATE_ROUTE'); // não é bloqueio duro e desvio ao mesmo tempo
    const wrong = structuredClone(catalog);
    wrong.workflows.find((w) => w.id === 'WF16')!.gates[0]!.routes = { overdue: 'etapa_inexistente' };
    expect(issues(wrong)).toContain('GATE_ROUTE');
  });

  const sha = 'b'.repeat(64);
  const base = { workflow_id: 'WF02', run_id: 'run-1', step: 'factcheck', input_sha256: sha, output_sha256: sha, evidence_refs: ['e1'], at: '2026-11-24T10:00:00-03:00' };
  const agent = { ...base, actor: 'factcheck', declared_model: 'gpt-6.1-terra', provider: 'openai', account: 'codex', cost_ref: 'cost-1', output_contract_valid: true };

  it('G-W2 (1): agent_output traz provider e account coerentes com o perfil na v7 (independência por etapa e DP-41)', () => {
    expect(validateStageEvidence({ kind: 'agent_output', record: agent }, catalog, org)).toEqual([]);
    expect(validateStageEvidence({ kind: 'agent_output', record: { ...agent, provider: 'google', account: 'antigravity' } }, catalog, org)[0]!.code).toBe('EVIDENCE_SCHEMA'); // fora da DP-41
    expect(validateStageEvidence({ kind: 'agent_output', record: { ...agent, provider: 'anthropic' } }, catalog, org)[0]!.code).toBe('EVIDENCE_SCHEMA'); // conta codex com provedor anthropic
    expect(validateStageEvidence({ kind: 'agent_output', record: { ...agent, provider: 'anthropic', account: 'claude' } }, catalog, org).map((i) => i.code)).toEqual(expect.arrayContaining(['EVIDENCE_PROVIDER', 'EVIDENCE_ACCOUNT'])); // factcheck não roda em Claude
    const writer = { ...agent, step: 'writer_{editoria}', actor: 'writer_tech', provider: 'anthropic', account: 'claude', at: '2026-11-24T09:00:00-03:00' };
    expect(validateStageEvidence({ kind: 'agent_output', record: writer }, catalog, org)).toEqual([]);
    expect(runIndependenceIssues([writer, agent], org)).toEqual([]);
    expect(runIndependenceIssues([writer, { ...agent, provider: 'anthropic' }], org).map((i) => i.code)).toEqual(['RUN_SAME_PROVIDER']);
  });

  it('G-W2 (2): agent_output traz cost_ref para conciliar com o gasto', () => {
    expect(STAGE_EVIDENCE_SCHEMAS.agent_output.safeParse({ ...agent, cost_ref: undefined }).success).toBe(false);
    expect(STAGE_EVIDENCE_SCHEMAS.agent_output.safeParse({ ...agent, cost_ref: '' }).success).toBe(false);
    expect(STAGE_EVIDENCE_SCHEMAS.agent_output.safeParse({ ...agent, cost_ref: 'openbot_cost_entries:42' }).success).toBe(true);
  });

  it('G-W2 (3): at é ISO 8601 com fuso em toda evidência', () => {
    for (const k of ['agent_output', 'deterministic_step', 'gate_verdict'] as const) {
      const rec = k === 'agent_output' ? agent : k === 'deterministic_step' ? { ...base, actor: 'deterministic', idempotency_key: 'k' } : { ...base, actor: 'deterministic', verdict: 'pass', blockers: [] };
      expect(STAGE_EVIDENCE_SCHEMAS[k].safeParse(rec).success, k).toBe(true);
      expect(STAGE_EVIDENCE_SCHEMAS[k].safeParse({ ...rec, at: '2026-11-24T10:00:00' }).success, `${k} sem fuso`).toBe(false);
      expect(STAGE_EVIDENCE_SCHEMAS[k].safeParse({ ...rec, at: 'agora' }).success, `${k} livre`).toBe(false);
    }
  });

  it('G-W2 (4): os bloqueios do gate_verdict são subconjunto dos bloqueios do registro do workflow', () => {
    const gate = { ...base, step: 'auto_gate_editor', actor: 'deterministic', verdict: 'fail', blockers: ['copy_literal', 'cross_provider_check_failed'] };
    expect(validateStageEvidence({ kind: 'gate_verdict', record: gate }, catalog, org)).toEqual([]);
    expect(validateStageEvidence({ kind: 'gate_verdict', record: { ...gate, blockers: ['copy_literal', 'inventado'] } }, catalog, org).map((i) => i.code)).toEqual(['EVIDENCE_BLOCKER']);
    expect(validateStageEvidence({ kind: 'gate_verdict', record: { ...gate, blockers: ['stale_data'] } }, catalog, org).map((i) => i.code)).toEqual(['EVIDENCE_BLOCKER']); // bloqueio de outro workflow
    expect(validateStageEvidence({ kind: 'gate_verdict', record: { ...gate, workflow_id: 'WF99' } }, catalog, org)[0]!.code).toBe('EVIDENCE_WORKFLOW');
    expect(validateStageEvidence({ kind: 'gate_verdict', record: { ...gate, step: 'passo_inexistente' } }, catalog, org)[0]!.code).toBe('EVIDENCE_STEP');
    expect(validateStageEvidence({ kind: 'deterministic_step', record: { ...base, actor: 'deterministic', idempotency_key: 'k' } }, catalog, org)[0]!.code).toBe('EVIDENCE_KIND'); // factcheck pede agent_output
  });
});
