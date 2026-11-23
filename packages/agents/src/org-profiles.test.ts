import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { buildOrgProfiles, taskKindOf, validateOrgProfiles, POLICY_V7_REF } from './org-profiles';

const registries = loadRegistries();
const draft = buildOrgProfiles(registries);
const by = (id: string) => draft.profiles.find((p) => p.id === id)!;

describe('perfis da organização completa (rascunho, política v7)', () => {
  it('cobre exatamente os 64 perfis, todos desligados, nada criado; o validador não acha problema', () => {
    expect(draft.created).toBe(false);
    expect(draft.status).toBe('RASCUNHO');
    expect(draft.review_by).toBe('QA 3');
    expect(draft.profiles).toHaveLength(64);
    expect(new Set(draft.profiles.map((p) => p.id)).size).toBe(64);
    expect(draft.profiles.every((p) => p.enabled === false)).toBe(true);
    expect(validateOrgProfiles(draft, registries)).toEqual([]);
  });

  it('só Claude e Codex (DP-41); Codex só na rota de revisão; redação em Claude sem modelo alternativo', () => {
    const accounts = new Set(draft.profiles.map((p) => p.execution.account));
    expect([...accounts].map(String).sort()).toEqual(['claude', 'codex', 'null']);
    for (const p of draft.profiles.filter((x) => x.execution.account === 'codex')) {
      expect(['fact_check', 'editorial_review', 'postpublication_audit'], p.id).toContain(p.task_kind);
    }
    expect(draft.profiles.filter((p) => p.task_kind === 'editorial_draft').every((p) => p.execution.account === 'claude' && p.complement_api?.alternative_model_allowed === false)).toBe(true);
    expect(by('writer_mercado').backup).toMatch(/DP-26 b/);
    expect(by('factcheck').execution).toMatchObject({ account: 'codex', provider: 'openai' });
    expect(by('audit').independence).toMatch(/reserva de auditoria/);
  });

  it('classificação por tarefa: 10 pares editor/redator, perfis de redação, deterministicos e imagem sem canal', () => {
    const kinds = (k: string) => draft.profiles.filter((p) => p.task_kind === k).map((p) => p.id);
    expect(kinds('editorial_review')).toHaveLength(10);
    expect(kinds('editorial_draft')).toHaveLength(13); // 10 redatores + newsdesk, agenda, talks
    expect(kinds('deterministic').sort()).toEqual(['adops', 'designer', 'finops', 'publisher_social', 'sre']);
    expect(kinds('concept_image')).toEqual(['image']);
    expect(by('image').execution.channel).toBe('none');
    expect(by('image').blocked_until[0]).toMatch(/image_fast/);
    expect(by('publisher').task_kind).toBe('ritual');
    expect(taskKindOf(registries.agents.find((a) => a.id === 'linkedin')!)).toBe('social_copy');
    expect(draft.counts).toMatchObject({ profiles: 64, deterministic: 5, no_model_available: 1 });
    expect(draft.counts.claude! + draft.counts.codex! + draft.counts.deterministic! + draft.counts.no_model_available!).toBe(64);
  });

  it('o complemento pela API está sempre desligado e segue as rotas da v7', () => {
    expect(draft.profiles.every((p) => p.complement_api === null || p.complement_api.enabled === false)).toBe(true);
    expect(by('writer_tech').complement_api).toMatchObject({ route: 'economy', models: ['claude-haiku-5-5'] });
    expect(by('director_trust').complement_api).toMatchObject({ route: 'premium', models: ['claude-opus-5-5'] });
    expect(by('publisher').complement_api).toMatchObject({ route: 'strategic', models: ['claude-opus-5-5'] });
    expect(by('editor_pontos').complement_api).toMatchObject({ route: 'review', models: ['openai-text-review', 'openai-text-review-alt'] });
    expect(by('orgchart').complement_api).toMatchObject({ route: 'review', models: ['claude-sonnet-5-5'] });
  });

  it('nada fora da política: sem Gemini, OpenCode, DeepSeek ou Fable nas contas, modelos e backups; só classe public; sem segredo', () => {
    const exec = JSON.stringify(draft.profiles.map((p) => ({ e: p.execution, c: p.complement_api, b: p.backup })));
    expect(exec).not.toMatch(/gemini|antigravity|opencode|fable/i);
    expect(draft.profiles.every((p) => p.data_class_allowed === 'public')).toBe(true);
    expect(JSON.stringify(draft)).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{10,}/);
    for (const id of ['privacy', 'people', 'sales', 'pricing', 'account']) expect(by(id).blocked_until.length, id).toBeGreaterThan(0);
  });

  it('presidências e donos de workflow fecham: 28 rituais e 19 workflows, cada um com um só responsável', () => {
    expect(draft.profiles.flatMap((p) => p.chairs_rituals)).toHaveLength(registries.meetings.length);
    expect(draft.profiles.flatMap((p) => p.owns_workflows)).toHaveLength(registries.workflows.length);
    expect(by('director_editorial').hosted_by).toBe('ln_editorial');
  });

  it('fixa a política v7 por hash; sem decisão pendente sobre Gemini/OpenCode (o PM os tirou do piloto, DP-41)', () => {
    expect(draft.policy).toBe(POLICY_V7_REF);
    expect(POLICY_V7_REF.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(draft.open_decisions)).not.toMatch(/Gemini|OpenCode/);
  });

  it('falha fechada: o validador pega conta fora da política, OpenAI fora da revisão, complemento ligado e perfil ligado', () => {
    const bad = structuredClone(draft);
    bad.profiles.find((p) => p.id === 'writer_mercado')!.execution.account = 'codex';
    bad.profiles.find((p) => p.id === 'social')!.execution.account = 'codex';
    (bad.profiles.find((p) => p.id === 'seo')!.complement_api as { enabled: boolean }).enabled = true;
    bad.profiles.find((p) => p.id === 'sales')!.enabled = true as never;
    (bad.profiles.find((p) => p.id === 'talks')!.execution as { account: string }).account = 'antigravity';
    const codes = validateOrgProfiles(bad, registries).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['DRAFT_ACCOUNT', 'OPENAI_SCOPE', 'COMPLEMENT_ON', 'ENABLED', 'ACCOUNT']));
    const missing = structuredClone(draft);
    missing.profiles.pop();
    expect(validateOrgProfiles(missing, registries).map((i) => i.code)).toEqual(expect.arrayContaining(['COUNT', 'MISSING']));
  });
});
