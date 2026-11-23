import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPolicyFile, type ModelPolicy } from '@ln/modelops';
import { describe, expect, it } from 'vitest';
import { generateArtifacts, PKG_DIR, POLICY_FIXTURE } from './artifacts';
import { loadRegistries } from './config';
import { buildRoutingPlan, CONSOLIDATION_RITUAL_IDS, DEFAULT_ASSUMPTIONS } from './routing-plan';

const dir = join(PKG_DIR, 'artifacts');
const registries = loadRegistries();
const policy = loadPolicyFile(POLICY_FIXTURE).policy as ModelPolicy;

describe('artefatos versionados (artifacts/)', () => {
  const generated = generateArtifacts();

  it('são determinísticos (duas gerações iguais)', () => {
    expect(generateArtifacts()).toEqual(generated);
  });

  it.each(Object.entries(generated))('%s no repositório é igual ao gerado', (name, content) => {
    const file = join(dir, name);
    if (process.env.UPDATE_ARTIFACTS === '1') {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, content, 'utf8');
    }
    expect(existsSync(file), `${name} ausente: rode com UPDATE_ARTIFACTS=1`).toBe(true);
    // normaliza CRLF de checkout: o conteúdo gerado usa LF
    expect(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), `${name} desatualizado: rode com UPDATE_ARTIFACTS=1`).toBe(content);
  });

  it('o manifesto traz 64/7/10/19/28, tudo desligado, e não contém segredo nem dado pessoal', () => {
    const m = JSON.parse(generated['organization.manifest.json']);
    expect(m.contagens).toMatchObject({ agents: 64, directorates: 7, newsrooms: 10, workflows: 19, meetings: 28 });
    expect(m.perfis).toHaveLength(64);
    expect(m.perfis.every((p: { enabled: boolean }) => p.enabled === false)).toBe(true);
    expect(m.workflows.every((w: { enabled: boolean }) => w.enabled === false)).toBe(true);
    expect(m.rituais.every((r: { enabled: boolean }) => r.enabled === false)).toBe(true);
    expect(m.meetings_version).toBe('2.1-p5-v2-proposta');
    expect(generated['organization.manifest.json']).not.toMatch(/api[_-]?key|secret|password|token/i);
  });

  it('o plano de ativação declara que nada foi criado e que as premissas não foram medidas', () => {
    const md = generated['activation-plan.md'];
    expect(md).toMatch(/Nenhum agente criado no OpenBot/);
    expect(md).toMatch(/NÃO medidas|não medidas/i);
    expect(md).toMatch(/aval do Program Manager/);
    expect(md).toMatch(/G1.*P5 v2/);
  });

  it('o protocolo de qualificação declara que nada roda sem decisão do proprietário e traz as travas, o orçamento e o teste de cache', () => {
    const md = generated['model-qualification-protocol.md'];
    expect(md).toMatch(/Nada roda até o proprietário decidir a política/);
    expect(md).toMatch(/cached_tokens > 0/);
    expect(md).toMatch(/Teto proposto: US\$ 5/);
    expect(md).toMatch(/T6 \| \*\*Modo de qualificação no gateway\*\*/);
    expect(md).toMatch(/não qualifica Fable|\*\*não\*\* qualifica Fable/);
    const plan = JSON.parse(generated['model-qualification-plan.json']);
    expect(plan.plano.ok).toBe(true);
    expect(plan.plano.totals.calls).toBe(187);
    expect(JSON.stringify(plan)).not.toMatch(/api[_-]?key|password|secret/i);
  });
});

describe('plano de roteamento dentro do teto de US$ 50', () => {
  const plan = buildRoutingPlan({ registries, policy });

  it('o plano conservador passa nas verificações de política (teto, verba, sublimite, OpenAI/imagens/DeepSeek)', () => {
    expect(plan.checks.filter((c) => c.severity === 'error' && !c.ok)).toEqual([]);
    expect(plan.ok).toBe(true);
    expect(plan.totals.ceilingMicro).toBeLessThanOrEqual(plan.caps.hardMonthlyMicro);
    expect(plan.totals.escalationCeilingMicro).toBeLessThanOrEqual(plan.caps.escalationSublimitMicro);
    expect(plan.totals.byProviderCeilingMicro).toEqual({ anthropic: plan.totals.ceilingMicro });
  });

  it('precifica os 28 rituais; esperado <= teto; ocorrências seguem o calendário real de dezembro/2026', () => {
    expect(plan.rituals).toHaveLength(28);
    for (const r of plan.rituals) {
      expect(r.expectedMicro, r.meeting_id).toBeLessThanOrEqual(r.ceilingMicro);
      for (const c of r.calls) expect(c.ceilingMicroPerCall, `${r.meeting_id}/${c.role}`).toBeGreaterThan(0);
    }
    const occ = Object.fromEntries(plan.rituals.map((r) => [r.meeting_id, r.occurrencesInMonth]));
    expect(occ['D-mercado']).toBe(22); // 23 dias úteis de seg-sex menos 25/12 (sexta feriado)
    expect(occ['M-board']).toBe(1);
    expect(occ['X-incident']).toBe(DEFAULT_ASSUMPTIONS.incidentsPerMonth);
    expect(occ['W-performance']).toBe(4); // sextas: 4, 11, 18 e 25/12 (feriado) -> move para 28/12 (segunda)
  });

  it('só a síntese do presidente usa Opus/Fable; participantes de ritual premium/strategic usam review', () => {
    for (const id of ['W-cross', 'M-model', 'X-incident', 'M-board']) {
      const r = plan.rituals.find((x) => x.meeting_id === id)!;
      expect(r.calls.find((c) => c.role === 'participant_input')!.route).toBe('review');
      expect(r.calls.find((c) => c.role === 'chair_synthesis')!.modelCeiling).toMatch(/opus|fable/);
    }
    // nenhum ritual usa a rota de revisão da OpenAI
    expect(plan.totals.byProviderCeilingMicro.openai ?? 0).toBe(0);
  });

  it('digest na consolidação custa menos e só conta a síntese do presidente nesses rituais', () => {
    const digest = buildRoutingPlan({ registries, policy, assumptions: { ...DEFAULT_ASSUMPTIONS, digestForConsolidation: true } });
    expect(digest.totals.ceilingMicro).toBeLessThan(plan.totals.ceilingMicro);
    for (const id of CONSOLIDATION_RITUAL_IDS) {
      const r = digest.rituals.find((x) => x.meeting_id === id)!;
      expect(r.calls.find((c) => c.role === 'participant_input')!.callsPerOccurrence, id).toBe(0);
    }
    // dailies de redação continuam por modelo
    expect(digest.rituals.find((x) => x.meeting_id === 'D-mercado')!.calls[0]!.callsPerOccurrence).toBe(1);
    expect(digest.ok).toBe(true);
  });

  it('falha fechada: sem preço ou sem modelo elegível o custo é desconhecido e o plano reprova', () => {
    const noPrice = structuredClone(policy);
    const haiku = noPrice.models.find((m) => m.id === 'claude-haiku-5-5')!;
    delete (haiku as { binding?: unknown }).binding;
    const p1 = buildRoutingPlan({ registries, policy: noPrice });
    expect(p1.ok).toBe(false);
    expect(p1.checks.find((c) => c.id === 'no_unknown_cost')).toMatchObject({ ok: false, severity: 'error' });

    const noModel = structuredClone(policy);
    noModel.routes.economy = [];
    expect(buildRoutingPlan({ registries, policy: noModel }).ok).toBe(false);
  });

  it('reprova quando o escalonamento ou a verba da Anthropic estouram (premissas inflacionadas)', () => {
    const huge = buildRoutingPlan({
      registries, policy,
      assumptions: { ...DEFAULT_ASSUMPTIONS, chairSynthesis: { ...DEFAULT_ASSUMPTIONS.chairSynthesis, maxOutputTokens: 200_000 }, participantInput: { ...DEFAULT_ASSUMPTIONS.participantInput, maxOutputTokens: 100_000 } },
    });
    expect(huge.ok).toBe(false);
    expect(huge.checks.filter((c) => !c.ok && c.severity === 'error').map((c) => c.id)).toEqual(expect.arrayContaining(['anthropic_allocation']));
  });

  it('o aviso de heurística (rituais > 50% da verba Anthropic) não reprova, mas aparece', () => {
    const w = plan.checks.find((c) => c.id === 'rituals_leave_room_for_editorial')!;
    expect(w.severity).toBe('warning');
    expect(plan.ok).toBe(true);
  });
});
