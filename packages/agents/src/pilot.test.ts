import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { authorOfDeclaredModel, buildPilotAgents, buildPilotPrompts, CLASS_C_EXCLUDED, evaluatePilot, PILOT_SHEET_COLUMNS, PILOT_SOURCES, PILOT_STAGES, sheetCsvHeader, validatePilotRow, type PilotRow } from './pilot';

const reg = loadRegistries();

// TODOS os dados abaixo são SIMULADOS (testes do avaliador do piloto); nenhuma execução real existe.
const T0 = Date.parse('2026-12-01T12:00:00Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const base = (over: Partial<PilotRow>): PilotRow => ({
  task_id: 't1', kind: 'editorial_draft', article_id: 'a1', source_id: 'senado-noticias', stage: 'draft', account: 'claude', declared_model: 'claude-sonnet-5-5', prompt_version: 'writer-v1+x',
  started_at: iso(0), ended_at: iso(2), attempt: 1, outcome: 'completed', packet_chars: 8000, tokens_measured: false,
  published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
});
const draft = (n: number, at: number, over: Partial<PilotRow> = {}) => base({ task_id: `d${n}`, article_id: `a${n}`, started_at: iso(at), ended_at: iso(at + 2), ...over });
const check = (n: number, at: number, over: Partial<PilotRow> = {}) =>
  base({ task_id: `c${n}`, kind: 'fact_check', article_id: `a${n}`, stage: 'check_edit', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'checker_editor-v1+y', started_at: iso(at), ended_at: iso(at + 3), gate_verdict: 'approved', cross_provider_ok: true, unsupported_facts: 0, ...over });

describe('prompts versionados do piloto', () => {
  const prompts = buildPilotPrompts(reg);

  it('3 prompts v1, com promptVersion = id-v1+sha256, contas Claude/Codex/Claude', () => {
    expect(prompts.map((p) => [p.id, p.account])).toEqual([['writer', 'claude'], ['checker_editor', 'codex'], ['extractor_social', 'claude']]);
    for (const p of prompts) expect(p.promptVersion).toMatch(new RegExp(`^${p.id}-v1\\+[0-9a-f]{12}$`));
    expect(new Set(prompts.map((p) => p.promptVersion)).size).toBe(3);
    // determinístico: mesmo texto, mesma versão
    expect(buildPilotPrompts(reg).map((p) => p.promptVersion)).toEqual(prompts.map((p) => p.promptVersion));
  });

  it('os campos de saída vêm do registro de perfis (contratos), não de memória', () => {
    const w = reg.agents.find((a) => a.id === 'writer_regulacao')!.required_result_fields;
    expect(prompts[0]!.text).toContain(w.join(', '));
    const f = reg.agents.find((a) => a.id === 'factcheck')!.required_result_fields;
    expect(prompts[1]!.text).toContain(f.join(', '));
    const l = reg.agents.find((a) => a.id === 'linkedin')!.required_result_fields;
    expect(prompts[2]!.text).toContain(l.join(', '));
    for (const p of prompts) for (const id of p.profiles) expect(reg.agents.some((a) => a.id === id), `${p.id}/${id}`).toBe(true);
  });

  it('regras da DP-28 e do piloto presentes: citar/linkar, mínimo necessário, robots/classe C, só JSON, sem publicar, modelo declarado', () => {
    for (const p of prompts) {
      expect(p.text).toMatch(/Cite e linke a fonte/);
      expect(p.text).toMatch(/no máximo uma citação curta, até 25 palavras/);
      expect(p.text).toMatch(/robots/);
      expect(p.text).toMatch(/Responda APENAS com JSON/);
      expect(p.text).toMatch(/kpi_observations\.model/);
    }
    expect(prompts[1]!.text).toMatch(/same_author/);
    expect(prompts[1]!.text).toMatch(/NÃO reescreve/);
    expect(prompts[2]!.text).toMatch(/NUNCA o trecho/);
    expect(prompts[2]!.text).toMatch(/Instagram e The Loyal estão desligados/);
  });

  it('nenhum prompt carrega segredo, chave ou URL de API tarifada', () => {
    for (const p of prompts) expect(p.text).not.toMatch(/sk-[A-Za-z0-9]{10,}|api[_-]?key|openrouter\.ai|Bearer /i);
  });
});

describe('agentes do piloto (rascunho, nada criado)', () => {
  const agents = buildPilotAgents(buildPilotPrompts(reg));
  it('3 agentes: redator (Claude), checador+editor (Codex, autor distinto), extrator+social (Claude)', () => {
    expect(agents.map((a) => [a.draft_id, a.account, a.stage])).toEqual([['ln_pilot_writer', 'claude', 'draft'], ['ln_pilot_checker', 'codex', 'check_edit'], ['ln_pilot_extractor', 'claude', 'extract_social']]);
    for (const a of agents) {
      expect(PILOT_STAGES[a.stage].account).toBe(a.account);
      expect(a.must_not.join(' ')).toMatch(/publicar/);
      expect(a.must_not.join(' ')).toMatch(/API tarifada/);
      expect(a.must_not.join(' ')).toMatch(/segredo/);
      expect(a.tool_contract.join(' ')).toMatch(/\/api\/openbot\/pull/);
      expect(a.description).toContain(a.prompt_version);
    }
  });
});

describe('fontes do piloto (DP-28)', () => {
  it('3 Senado + 3 Câmara + 4 de mercado classe D; classe C fora', () => {
    expect(PILOT_SOURCES.reduce((n, s) => n + s.articles, 0)).toBe(10);
    expect(PILOT_SOURCES.filter((s) => s.termsClass === 'institucional').reduce((n, s) => n + s.articles, 0)).toBe(6);
    expect(PILOT_SOURCES.filter((s) => s.termsClass === 'D').reduce((n, s) => n + s.articles, 0)).toBe(4);
    for (const c of ['Azul', 'GOL', 'Nubank', 'ABAV', 'oneworld']) expect(CLASS_C_EXCLUDED).toContain(c);
    for (const s of PILOT_SOURCES) expect(CLASS_C_EXCLUDED.map((x) => x.toLowerCase())).not.toContain(s.id.toLowerCase());
  });
});

describe('planilha e avaliador (dados SIMULADOS)', () => {
  it('cabeçalho da planilha tem todas as colunas, sem duplicata', () => {
    expect(sheetCsvHeader().trim().split(',')).toEqual([...PILOT_SHEET_COLUMNS]);
    expect(new Set(PILOT_SHEET_COLUMNS).size).toBe(PILOT_SHEET_COLUMNS.length);
  });

  it('autor pelo modelo declarado: Claude = anthropic, GPT/Codex = openai, o resto = desconhecido', () => {
    expect(authorOfDeclaredModel('claude-sonnet-5-5')).toBe('anthropic');
    expect(authorOfDeclaredModel('anthropic/claude-haiku-5.5')).toBe('anthropic');
    expect(authorOfDeclaredModel('gpt-6.1-terra')).toBe('openai');
    expect(authorOfDeclaredModel('openai/gpt-6.2-sol')).toBe('openai');
    expect(authorOfDeclaredModel('gpt-5-codex')).toBe('openai');
    expect(authorOfDeclaredModel('modelo-x')).toBe('unknown');
    expect(authorOfDeclaredModel(null)).toBe('unknown');
  });

  it('validação das linhas: conta da etapa, modelo declarado, tokens "não medido", limite exige texto e hora', () => {
    expect(validatePilotRow(draft(1, 0))).toEqual([]);
    expect(validatePilotRow(draft(1, 0, { account: 'codex' }))).toEqual(expect.arrayContaining([expect.stringMatching(/deve rodar em claude/)]));
    expect(validatePilotRow(draft(1, 0, { declared_model: null }))).toEqual(expect.arrayContaining([expect.stringMatching(/modelo declarado/)]));
    expect(validatePilotRow({ ...draft(1, 0), tokens_measured: true } as never)).toEqual(expect.arrayContaining([expect.stringMatching(/tokens_measured/)]));
    expect(validatePilotRow(draft(1, 0, { outcome: 'pending_limit' }))).toEqual(expect.arrayContaining([expect.stringMatching(/pending_limit exige/)]));
    expect(validatePilotRow(draft(1, 5, { ended_at: iso(1) }))).toEqual(expect.arrayContaining([expect.stringMatching(/ended_at antes/)]));
    expect(validatePilotRow(check(1, 0, { gate_verdict: undefined }))).toEqual(expect.arrayContaining([expect.stringMatching(/gate_verdict/)]));
  });

  it('10 matérias sem bater limite: independência passa, qualidade passa, janelas = "repetir com 30"', () => {
    const rows = Array.from({ length: 10 }, (_, i) => [draft(i + 1, i * 10), check(i + 1, i * 10 + 3)]).flat();
    const e = evaluatePilot(rows);
    expect(e.invalidRows).toEqual([]);
    expect(e.stop).toEqual([]);
    expect(e.independence).toMatchObject({ checked: 10, ok: 10, rate: 1 });
    expect(e.exit).toMatchObject({ independence: 'pass', quality: 'pass', windowsMeasured: 'repeat_with_30', stopped: false, overall: 'pass' });
    expect(e.windows).toHaveLength(2); // uma janela aberta por conta
    expect(e.windows.find((w) => w.account === 'claude')).toMatchObject({ articles: 10, endedByLimit: false });
    expect(e.latencyMsByStage.draft!.p50).toBe(2 * 60_000);
    expect(e.latencyMsByStage.check_edit!.p95).toBe(3 * 60_000);
  });

  it('limite atingido: fecha a janela, conta matérias por janela e guarda a mensagem e a retomada', () => {
    const rows = [
      draft(1, 0), draft(2, 10), draft(3, 20), draft(4, 30, { outcome: 'pending_limit', limit_message: 'limite de uso atingido (SIMULADO)', limit_at: iso(32), account_resumed_at: iso(300) }),
      draft(4, 301, { task_id: 'd4b', attempt: 2 }), draft(5, 311),
    ];
    const e = evaluatePilot(rows);
    const claude = e.windows.filter((w) => w.account === 'claude');
    expect(claude).toHaveLength(2);
    expect(claude[0]).toMatchObject({ completedTasks: 3, articles: 3, endedByLimit: true });
    expect(claude[1]).toMatchObject({ completedTasks: 2, articles: 2, endedByLimit: false });
    expect(e.limitHits).toEqual([{ account: 'claude', at: iso(32), message: 'limite de uso atingido (SIMULADO)', resumedAt: iso(300) }]);
    expect(e.retries).toMatchObject({ tasksWithRetry: 1, pendingLimit: 1 });
    expect(e.exit.windowsMeasured).toBe('measured');
  });

  it('independência: mesmo autor, autor desconhecido ou cross_provider_ok=false reprova', () => {
    const same = evaluatePilot([draft(1, 0), check(1, 3, { declared_model: 'claude-opus-5-5' })]);
    expect(same.exit.independence).toBe('fail');
    expect(same.exit.overall).toBe('fail');
    expect(same.independence.failures[0]).toMatch(/a1: redator claude-sonnet-5-5 x checador claude-opus-5-5/);
    expect(evaluatePilot([draft(1, 0), check(1, 3, { declared_model: 'modelo-x' })]).exit.independence).toBe('fail');
    expect(evaluatePilot([draft(1, 0), check(1, 3, { cross_provider_ok: false })]).exit.independence).toBe('fail');
    expect(evaluatePilot([check(1, 3)]).exit.independence).toBe('fail'); // checagem sem rascunho conhecido
    expect(evaluatePilot([draft(1, 0)]).exit.independence).toBe('inconclusive');
  });

  it('qualidade: fato sem evidência reprova; falta de avaliação do Editorial é inconclusiva', () => {
    expect(evaluatePilot([draft(1, 0), check(1, 3, { unsupported_facts: 1 })]).exit.quality).toBe('fail');
    const noEval = evaluatePilot([draft(1, 0), check(1, 3, { unsupported_facts: undefined })]);
    expect(noEval.exit.quality).toBe('inconclusive');
    expect(noEval.quality.approvedWithoutEvaluation).toBe(1);
    expect(noEval.exit.overall).toBe('inconclusive');
    // rascunho bloqueado não entra na conta de qualidade
    expect(evaluatePilot([draft(1, 0), check(1, 3, { gate_verdict: 'blocked', unsupported_facts: undefined })]).exit.quality).toBe('inconclusive');
  });

  it('PARADA IMEDIATA: publicar, API tarifada, segredo em log e ferramenta fora do contrato derrubam o piloto', () => {
    for (const flag of ['published_attempt', 'tarifada_api_call', 'secret_in_log', 'tool_outside_contract'] as const) {
      const e = evaluatePilot([draft(1, 0), check(1, 3), draft(2, 10, { [flag]: true })]);
      expect(e.stop, flag).toHaveLength(1);
      expect(e.exit.stopped).toBe(true);
      expect(e.exit.overall).toBe('stopped');
    }
  });

  it('sem linhas: tudo inconclusivo (nada é dado como bom)', () => {
    const e = evaluatePilot([]);
    expect(e.exit).toMatchObject({ windowsMeasured: 'inconclusive', independence: 'inconclusive', quality: 'inconclusive', overall: 'inconclusive' });
  });
});
