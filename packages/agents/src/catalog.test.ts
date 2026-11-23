import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { buildOrgProfiles } from './org-profiles';
import { buildCatalog, checkReviewSameProvider, validateCatalog, writeCheckPairs, RitualSpecSchema, WorkflowSpecSchema, type Catalog } from './catalog';
import { buildCatalogArtifacts } from './catalog-doc';
import { ARTIFACT_SCHEMAS, EVENT_TRIGGER_SCHEMA, OUTPUT_LABEL_KIND, PROPOSED_GATES, RITUAL_INPUT_SCHEMAS, STAGE_EVIDENCE_SCHEMAS, ritualFamily } from './catalog-schemas';

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
    expect(RITUAL_INPUT_SCHEMAS.directorate_daily.safeParse({ ...base, payload: { status: 'ok', kpi_observations: [{ kpi: 'k', value: 1 }], escalations: [] } }).success).toBe(true);
    expect(RITUAL_INPUT_SCHEMAS.sync.safeParse({ ...base, payload: { priorities: ['a'], dependencies: [{ on: 'D-trust', state: 'ok' }] } }).success).toBe(true);
    expect(RITUAL_INPUT_SCHEMAS.weekly.safeParse({ ...base, payload: { topics: [{ subject: 's', evidence_refs: ['e'] }] } }).success).toBe(true);
    expect(RITUAL_INPUT_SCHEMAS.monthly.safeParse({ ...base, payload: { assessment: 'a', metrics: [] } }).success).toBe(true);
    expect(RITUAL_INPUT_SCHEMAS.event.safeParse({ ...base, payload: { containment_proposals: ['isolar'] } }).success).toBe(true);
    expect(EVENT_TRIGGER_SCHEMA.safeParse({ kind: 'incident', ref: 'inc-1', raised_at: '2026-11-24T08:00:00-03:00' }).success).toBe(true);
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
    expect(ARTIFACT_SCHEMAS.decision_list.safeParse({ items: [{ text: 'd', proposed_by: 'publisher', authority_class: 'owner_reserved', evidence_refs: ['e'] }] }).success).toBe(true);
  });

  it('todo workflow tem gate explícito que cobre todos os bloqueios; os 5 sem gate no registro ganham gate proposto', () => {
    for (const w of catalog.workflows) {
      expect(w.gates.length, w.id).toBeGreaterThanOrEqual(1);
      const covered = new Set(w.gates.flatMap((g) => g.blockers));
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
    expect(STAGE_EVIDENCE_SCHEMAS.agent_output.safeParse({ ...base, actor: 'factcheck', declared_model: 'gpt-6.1-terra', output_contract_valid: true }).success).toBe(true);
    expect(STAGE_EVIDENCE_SCHEMAS.agent_output.safeParse({ ...base, actor: 'factcheck', declared_model: 'gpt-6.1-terra', output_contract_valid: true, evidence_refs: [] }).success).toBe(false);
    expect(STAGE_EVIDENCE_SCHEMAS.agent_output.safeParse({ ...base, actor: 'factcheck', output_contract_valid: true }).success).toBe(false); // sem modelo declarado
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
