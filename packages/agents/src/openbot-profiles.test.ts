import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { buildOpenBotDraft, validateOpenBotDraft } from './openbot-profiles';

const reg = loadRegistries();

describe('rascunho dos perfis OpenBot (nada é criado)', () => {
  const draft = buildOpenBotDraft(reg);

  it('é RASCUNHO, created=false e exige aval do Program Manager', () => {
    expect(draft).toMatchObject({ status: 'RASCUNHO', created: false, approval_required_from: 'Program Manager' });
    expect(validateOpenBotDraft(draft, reg)).toEqual([]);
  });

  it('8 agentes: Publisher + 7 diretorias, cobrindo os 64 perfis exatamente uma vez', () => {
    expect(draft.agents).toHaveLength(8);
    expect(draft.agents.map((a) => a.department).sort()).toEqual(['commercial', 'creative', 'editorial', 'executivo', 'growth', 'intelligence', 'technology', 'trust']);
    const hosted = draft.agents.flatMap((a) => a.hosted_profiles);
    expect(hosted).toHaveLength(64);
    expect(new Set(hosted).size).toBe(64);
    expect(draft.agents.find((a) => a.department === 'editorial')!.hosted_profiles).toHaveLength(24);
    expect(draft.agents.find((a) => a.department === 'executivo')!.hosted_profiles).toEqual(['publisher']);
  });

  it('cada ritual tem um único agente presidente e cada workflow um único dono', () => {
    const chairs = draft.agents.flatMap((a) => a.chairs_rituals);
    expect(chairs.sort()).toEqual(reg.meetings.map((m) => m.id).sort());
    const owners = draft.agents.flatMap((a) => a.owns_workflows);
    expect(owners.sort()).toEqual(reg.workflows.map((w) => w.id).sort());
    expect(draft.agents.find((a) => a.department === 'executivo')!.chairs_rituals).toEqual(expect.arrayContaining(['D-sync', 'W-cross', 'M-board', 'X-incident']));
  });

  it('restrições de segurança em todos: gateway, não publicar, não criar agentes, sem credencial de provedor', () => {
    for (const a of draft.agents) {
      const must = a.must_not.join(' | ');
      expect(must, a.draft_id).toMatch(/gateway do LN/);
      expect(must, a.draft_id).toMatch(/publicar/);
      expect(must, a.draft_id).toMatch(/criar agentes/);
      expect(must, a.draft_id).toMatch(/credencial de provedor/);
      expect(must, a.draft_id).toMatch(/pull com lease/);
      expect(a.requires_gates).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6']);
    }
    expect(JSON.stringify(draft)).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer\s+\S{10,}/);
  });

  it('o validador falha fechado: perfil duplicado, perfil sem agente, ritual sem presidente, created=true', () => {
    const bad = structuredClone(draft);
    bad.agents[1]!.hosted_profiles.push(bad.agents[2]!.hosted_profiles[0]!); // duplicado
    bad.agents[3]!.hosted_profiles.pop(); // órfão
    bad.agents[1]!.chairs_rituals = []; // rituais sem presidente
    (bad as { created: boolean }).created = true;
    bad.agents[4]!.must_not = bad.agents[4]!.must_not.filter((m) => !m.includes('gateway'));
    const codes = new Set(validateOpenBotDraft(bad, reg).map((i) => i.code));
    expect(codes).toEqual(new Set(['CREATED', 'COVERAGE', 'CHAIR', 'MISSING_RESTRICTION']));
  });

  it('segredo no texto reprova', () => {
    const bad = structuredClone(draft);
    bad.agents[0]!.description += ' api_key: abcd1234';
    expect(validateOpenBotDraft(bad, reg).map((i) => i.code)).toContain('SECRET_LIKE');
  });
});
