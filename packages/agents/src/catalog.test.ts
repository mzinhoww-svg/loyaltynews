import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { buildOrgProfiles } from './org-profiles';
import { buildCatalog, checkReviewSameProvider, validateCatalog, RitualSpecSchema, WorkflowSpecSchema, type Catalog } from './catalog';
import { buildCatalogArtifacts } from './catalog-doc';

const registries = loadRegistries();
const org = buildOrgProfiles(registries);
const catalog = buildCatalog(registries);
const issues = (c: Catalog, o = org) => validateCatalog(c, registries, o).map((i) => i.code);

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
    expect(wf02.gates).toEqual(['auto_gate_editor']);
    expect(wf02.stages.map((s) => s.tokens.map((t) => t.token))).toEqual([['writer_{editoria}'], ['factcheck', 'rights'], ['editor_{editoria}'], ['auto_gate_editor']]);
    expect(wf02.stages[0]!.tokens[0]!.agents).toHaveLength(10);
    expect(wf02.evidence.fail_closed_blockers).toContain('cross_provider_check_failed');
    expect(catalog.workflows.find((w) => w.id === 'WF04')!.channel_flags).toMatchObject({ instagram_enabled: false });
    expect(catalog.workflows.find((w) => w.id === 'WF05')!.channel_flags).toMatchObject({ channel_enabled: false });
    expect(catalog.workflows.filter((w) => w.gates.length === 0).map((w) => w.id)).toEqual(['WF01', 'WF03', 'WF09', 'WF14', 'WF16']);
  });

  it('independência editorial: redação ≠ checagem ≠ revisão e provedores diferentes do redator, nas 10 editorias', () => {
    expect(catalog.independence.map((r) => r.workflow)).toEqual(['WF02', 'WF03', 'WF05', 'WF08']);
    expect(issues(catalog)).toEqual([]);
    const provider = (id: string) => org.profiles.find((p) => p.id === id)!.execution.provider;
    expect(provider('writer_mercado')).toBe('anthropic');
    expect(provider('factcheck')).toBe('openai');
    expect(provider('editor_mercado')).toBe('openai');
    expect(checkReviewSameProvider(catalog, org)).toEqual(['WF02', 'WF08']); // checagem e revisão no Codex: permitido pela v7, registrado como G-I1
  });

  it('falha fechada: contagem, id repetido, participante fora dos 64, perfil ligado, schema e independência quebrados', () => {
    const bad = structuredClone(catalog);
    bad.rituals.pop();
    bad.workflows[1]!.id = 'WF01';
    bad.rituals[0]!.participants.push('fantasma');
    (bad.rituals[1] as { enabled: boolean }).enabled = true;
    bad.workflows[2]!.owner = 'ninguem';
    const codes = issues(bad);
    expect(codes).toEqual(expect.arrayContaining(['COUNT_RITUALS', 'ID_DUP', 'RITUAL_PARTICIPANT', 'RITUAL_SCHEMA', 'WORKFLOW_OWNER']));
    const mixed = structuredClone(org);
    mixed.profiles.find((p) => p.id === 'factcheck')!.execution.provider = 'anthropic'; // checagem no mesmo provedor do redator
    expect(issues(catalog, mixed)).toContain('INDEPENDENCE_PROVIDER');
    const noProvider = structuredClone(org);
    noProvider.profiles.find((p) => p.id === 'editor_travel')!.execution.provider = null;
    expect(issues(catalog, noProvider)).toContain('INDEPENDENCE_PROVIDER');
    const same = structuredClone(catalog);
    same.independence[0]!.checkers = ['writer_{editoria}'];
    expect(issues(same)).toContain('INDEPENDENCE_ROLES');
    const unknown = structuredClone(catalog);
    unknown.independence[0]!.reviewers = ['revisor_inexistente'];
    expect(issues(unknown)).toContain('INDEPENDENCE_PROFILE');
  });

  it('o gerador do catálogo e da tabela de lacunas é determinístico e declara as lacunas', () => {
    const a = buildCatalogArtifacts(registries);
    const b = buildCatalogArtifacts(registries);
    expect(a).toEqual(b);
    expect(a['catalog-gaps.md']).toMatch(/G-R1/);
    expect(a['catalog-gaps.md']).toMatch(/G-I1/);
    expect(a['catalog-gaps.md']).toMatch(/WF01, WF03, WF09, WF14, WF16/);
    expect(JSON.parse(a['catalog.json'])).toMatchObject({ runs: false, counts: { rituals: 28, workflows: 19 } });
    expect(a['catalog-gaps.md']).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  });
});
