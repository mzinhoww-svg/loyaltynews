import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import agentsRaw from '../data/agents.registry.json';
import workflowsRaw from '../data/workflows.registry.json';
import meetingsRaw from '../data/meetings.registry.json';
import { loadRegistries, parseRegistries } from './config';
import { buildOrganization } from './organization';
import { validateRegistries } from './validator';

const clone = <T>(x: T): T => structuredClone(x);
const raw = () => ({ agents: clone(agentsRaw), workflows: clone(workflowsRaw), meetings: clone(meetingsRaw) });
const codes = (r: ReturnType<typeof validateRegistries>) => r.issues.filter((i) => i.severity === 'error').map((i) => i.code);

describe('configuração real (contratos v2.1 + P5)', () => {
  const reg = loadRegistries();
  const org = buildOrganization(reg);
  const report = validateRegistries(reg);

  it('passa no validador sem erros', () => {
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('tem as contagens do contrato: 64/7/10/19/28', () => {
    expect(report.counts).toMatchObject({ agents: 64, directorates: 7, newsrooms: 10, workflows: 19, meetings: 28 });
    expect(report.counts).toMatchObject({ dailies: 18, weeklies: 6, monthlies: 3, events: 1 });
  });

  it('cada redação tem editor e redator próprios e memória setorial própria', () => {
    expect(org.newsrooms.map((n) => n.editoria).sort()).toEqual(
      ['bancos', 'crm', 'global', 'mercado', 'pontos', 'programas', 'regulacao', 'tech', 'travel', 'varejo'],
    );
    for (const n of org.newsrooms) {
      expect(n.editor).toBe(`editor_${n.editoria}`);
      expect(n.writer).toBe(`writer_${n.editoria}`);
      expect(n.memory_scope).toBe(n.editoria);
      expect(n.interactions.map((i) => i.directorate)).toEqual(
        expect.arrayContaining(['editorial', 'trust', 'intelligence', 'creative', 'growth', 'technology']),
      );
    }
  });

  it('as 7 diretorias reportam ao publisher e somam 63 membros', () => {
    expect(org.directorates).toHaveLength(7);
    expect(org.directorates.reduce((n, d) => n + d.members.length, 0)).toBe(63);
    for (const d of org.directorates) expect(d.director).toBe(`director_${d.department}`);
  });

  it('tudo nasce desligado (gate R4) e Instagram/The Loyal ficam desligados', () => {
    expect(reg.agents.every((a) => !a.enabled)).toBe(true);
    expect(reg.workflows.every((w) => !w.enabled)).toBe(true);
    expect(reg.meetings.every((m) => !m.enabled)).toBe(true);
    expect(reg.workflows.find((w) => w.id === 'WF04')?.instagram_enabled).toBe(false);
    expect(reg.workflows.find((w) => w.id === 'WF05')?.channel_enabled).toBe(false);
  });

  it('os JSON em data/ batem com o sha256 de origem registrado', () => {
    const src = JSON.parse(readFileSync(join(__dirname, '../data/SOURCES.json'), 'utf8')) as {
      arquivos: Record<string, { sha256: string }>;
    };
    for (const [file, { sha256 }] of Object.entries(src.arquivos)) {
      const got = createHash('sha256').update(readFileSync(join(__dirname, '../data', file))).digest('hex');
      expect(got, file).toBe(sha256);
    }
  });
});

describe('validador falha fechado com dados adulterados', () => {
  const run = (mutate: (r: ReturnType<typeof raw>) => void) => {
    const r = raw();
    mutate(r);
    return validateRegistries(parseRegistries(r));
  };

  it('perfil removido -> COUNT', () => {
    const rep = run((r) => (r.agents.agents as unknown[]).pop());
    expect(codes(rep)).toContain('COUNT');
  });

  it('id duplicado e id igual a diretoria', () => {
    const dup = run((r) => { r.agents.agents[9]!.id = r.agents.agents[8]!.id; });
    expect(codes(dup)).toContain('AGENT_DUP');
    const dir = run((r) => { r.agents.agents[8]!.id = 'trust'; });
    expect(codes(dir)).toContain('AGENT_ID_IS_DIRECTORATE');
  });

  it('reports_to inexistente e ciclo de hierarquia', () => {
    expect(codes(run((r) => { r.agents.agents[10]!.reports_to = 'ninguem'; }))).toContain('REPORTS_TO');
    const cyc = run((r) => {
      const a = r.agents.agents.find((x) => x.id === 'director_trust')!;
      a.reports_to = 'audit';
    });
    expect(codes(cyc)).toContain('HIERARCHY_CYCLE');
  });

  it('output_contract de outro perfil / campos divergentes', () => {
    const rep = run((r) => {
      r.agents.agents[20]!.output_contract = clone(r.agents.agents[21]!.output_contract);
    });
    expect(codes(rep)).toEqual(expect.arrayContaining(['CONTRACT_AGENT_ID']));
    const rep2 = run((r) => { r.agents.agents[5]!.required_result_fields = ['x']; });
    expect(codes(rep2)).toContain('CONTRACT_RESULT_FIELDS');
  });

  it('rota fora da política de modelos', () => {
    // 'premium' é válida no schema; troca por rota válida no schema mas ausente da política não existe,
    // então verifica o schema rejeitando rota desconhecida (fail closed já no parse).
    expect(() => parseRegistries((() => { const r = raw(); (r.agents.agents[0] as { default_route_hint: string }).default_route_hint = 'barata'; return r; })())).toThrow();
  });

  it('workflow com dono inexistente ou passo desconhecido', () => {
    expect(codes(run((r) => { r.workflows.workflows[0]!.owner = 'fantasma'; }))).toContain('WORKFLOW_OWNER');
    expect(codes(run((r) => { r.workflows.workflows[1]!.steps += '>writer_inexistente'; }))).toContain('WORKFLOW_STEP');
  });

  it('workflow ligado ou canal Instagram ligado', () => {
    expect(codes(run((r) => { r.workflows.workflows[0]!.enabled = true; }))).toContain('WORKFLOW_ENABLED');
    expect(codes(run((r) => { (r.workflows.workflows[3] as { instagram_enabled: boolean }).instagram_enabled = true; }))).toContain('CHANNEL_FLAG');
  });

  it('ritual com participante/presidente/workflow/dependência inexistentes', () => {
    expect(codes(run((r) => { r.meetings.meetings[0]!.participants.push('fantasma'); }))).toContain('MEETING_PARTICIPANTS');
    // presidente fora dos participantes: barrado já pelo contrato do arquiteto (@ln/contracts Ritual)
    expect(() => run((r) => { r.meetings.meetings[0]!.chair = 'fantasma'; })).toThrow(/chair fora dos participantes/);
    expect(codes(run((r) => { (r.meetings.meetings[0] as { workflow?: string }).workflow = 'WF99'; }))).toContain('MEETING_WORKFLOW');
    expect(codes(run((r) => { const m = r.meetings.meetings.find((x) => x.id === 'D-sync') as { depends_on: string[] }; m.depends_on.push('D-nada'); }))).toContain('MEETING_DEPENDS');
  });

  it('quórum maior que participantes, horário inválido e janela de recuperação alterada', () => {
    // quórum diferente de máx(2, ⌈2n/3⌉): barrado pelo contrato do arquiteto
    expect(() => run((r) => { r.meetings.meetings[0]!.quorum.minimum = 9; })).toThrow(/quórum diferente/);
    expect(codes(run((r) => { r.meetings.meetings[0]!.schedule_local = '25:99'; }))).toContain('MEETING_SCHEDULE');
    expect(codes(run((r) => { r.meetings.recovery_policy.window_minutes = 60; }))).toContain('RECOVERY_WINDOW');
  });

  it('D-sync: dependências divergentes da recovery_policy', () => {
    const rep = run((r) => { r.meetings.recovery_policy.dependencies['D-sync'] = ['D-trust']; });
    expect(codes(rep)).toContain('RECOVERY_DEPENDS');
  });

  it('redação: redator reportando a outro editor', () => {
    const rep = run((r) => { r.agents.agents.find((a) => a.id === 'writer_crm')!.reports_to = 'editor_tech'; });
    expect(codes(rep)).toContain('NEWSROOM_WRITER');
  });
});
