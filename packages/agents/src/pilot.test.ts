import { describe, expect, it } from 'vitest';
import { loadRegistries } from './config';
import { authorOfDeclaredModel, BLOCKING_GATE_REASONS, buildPilotAgents, configInvalidOf, canDispatchNext, CLASS_C_EXCLUDED, EDITORIAL_PROMPTS_REF, evaluatePilot, highFactOf, INDEPENDENT_STAGES, missingVerdictStreak, PILOT_SHEET_COLUMNS, PILOT_SOURCES, PILOT_STAGES, PilotSession, sheetCsvHeader, stopReasonsOf, validatePilotRow, VERDICT_STREAK_LIMIT, verdictStreakReasons, type PilotRow } from './pilot';

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
  base({ task_id: `c${n}`, kind: 'fact_check', article_id: `a${n}`, stage: 'check_edit', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'checker_editor-v1+y', started_at: iso(at), ended_at: iso(at + 3), reviewed_draft_task_id: `d${n}`, gate_verdict: 'approved', cross_provider_ok: true, unsupported_facts: 0, ...over });

describe('prompts: referência única à Editorial (editorial-0.3), sem texto próprio', () => {
  it('fixa a versão, o commit e o hash do arquivo da fábrica; limites de saída por classe', () => {
    expect(EDITORIAL_PROMPTS_REF).toMatchObject({ version: 'editorial-0.3', toneVersion: 'tom-0.2', branch: 'ft/editorial', file: 'packages/editorial/src/factory/prompts.ts' });
    expect(EDITORIAL_PROMPTS_REF.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(EDITORIAL_PROMPTS_REF.blobSha).toMatch(/^[0-9a-f]{40}$/);
    expect(EDITORIAL_PROMPTS_REF).toMatchObject({ commit: 'b040e53', blobSha: 'a7e58bdc24fdbca7e78ab9875c992632439d49aa' });
    expect(EDITORIAL_PROMPTS_REF.maxOutputTokens).toMatchObject({ triage: 200, draft: 3000, factcheck: 1200, review: 500 });
  });
});

describe('agentes do piloto (rascunho, nada criado): pauta, redação, checagem e revisão', () => {
  const agents = buildPilotAgents(reg);
  const by = (id: string) => agents.find((a) => a.draft_id === id)!;

  it('4 obrigatórios (pauta, redator, checador, revisor) + 1 opcional (social/entidades), cada um com a classe da fábrica', () => {
    expect(agents.map((a) => [a.draft_id, a.stage, a.required])).toEqual([
      ['ln_pilot_pauta', 'triage', true], ['ln_pilot_redator', 'draft', true], ['ln_pilot_checador', 'factcheck', true], ['ln_pilot_revisor', 'review', true], ['ln_pilot_social', 'social_pack', false],
    ]);
    expect(agents.map((a) => a.editorial_task_class)).toEqual(['triage', 'draft', 'factcheck', 'review', 'social_pack']);
    for (const a of agents) {
      expect(a.prompt_ref).toContain(EDITORIAL_PROMPTS_REF.version);
      expect(a.primary.model).toMatch(/declarado no UsageReport/);
      expect(PILOT_STAGES[a.stage].account).toBe(a.primary.account);
    }
  });

  it('contas (DP-41): pauta no Claude Haiku, redação em Claude, checagem e revisão em Codex (autor distinto); só Claude e Codex', () => {
    expect(by('ln_pilot_pauta').primary.account).toBe('claude');
    expect(by('ln_pilot_pauta').primary.model).toMatch(/Haiku/);
    expect(by('ln_pilot_redator').primary.account).toBe('claude');
    expect(by('ln_pilot_checador').primary.account).toBe('codex');
    expect(by('ln_pilot_revisor').primary.account).toBe('codex');
    expect(by('ln_pilot_checador').independence).toMatch(/autor diferente do redator/);
    expect(by('ln_pilot_revisor').independence).toMatch(/Claude nunca revisa rascunho de Claude/);
    const all = JSON.stringify(agents.map((a) => ({ p: a.primary, b: a.backups, d: a.description, t: a.title })));
    expect(all).not.toMatch(/antigravity|gemini via|opencode via|DeepSeek via/i);
    expect(new Set(agents.flatMap((a) => [a.primary.account, ...a.backups.map((b) => b.account)]))).toEqual(new Set(['claude', 'codex']));
  });

  it('backups: pauta Haiku → Sonnet (mesma conta Claude); checagem, revisão e redação SEM backup; limite = pending (DP-26 b, DP-41)', () => {
    expect(by('ln_pilot_pauta').backups).toHaveLength(1);
    expect(by('ln_pilot_pauta').backups[0]).toMatchObject({ account: 'claude' });
    expect(by('ln_pilot_pauta').backups[0]!.model).toMatch(/Sonnet/);
    expect(by('ln_pilot_pauta').on_limit).toMatch(/pending/);
    for (const id of ['ln_pilot_checador', 'ln_pilot_revisor', 'ln_pilot_redator']) {
      expect(by(id).backups, id).toEqual([]);
      expect(by(id).on_limit, id).toMatch(/SEM backup/);
    }
    expect(by('ln_pilot_redator').on_limit).toMatch(/DP-26 b/);
    expect(by('ln_pilot_checador').on_limit).toMatch(/pending/);
    // nenhum backup é API tarifada
    expect(JSON.stringify(agents.flatMap((a) => a.backups))).not.toMatch(/openrouter|api tarifada|gpt-6\.1-terra/i);
  });

  it('restrições em todos: sem API tarifada, sem publicar, sem segredo, dado não confiável, sem criar agentes', () => {
    for (const a of agents) {
      const m = a.must_not.join(' | ');
      expect(m, a.draft_id).toMatch(/API tarifada ou o OpenRouter/);
      expect(m, a.draft_id).toMatch(/publicar/);
      expect(m, a.draft_id).toMatch(/segredo/);
      expect(m, a.draft_id).toMatch(/dado não confiável/);
      expect(m, a.draft_id).toMatch(/criar agentes/);
      expect(a.tool_contract.join(' '), a.draft_id).toMatch(/\/api\/openbot\/pull/);
    }
    expect(JSON.stringify(agents)).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer\s+\S{10,}/);
  });

  it('as lacunas do adaptador ficam explícitas: a revisão não tem tipo (adapter_kind null) e deve ser pedida à Integração', () => {
    expect(by('ln_pilot_revisor').adapter_kind).toBeNull();
    expect(by('ln_pilot_pauta').adapter_kind).toBe('classification');
    expect(by('ln_pilot_redator').adapter_kind).toBe('editorial_draft');
    expect(by('ln_pilot_checador').adapter_kind).toBe('fact_check');
    expect(PILOT_STAGES.check_edit.adapterKind).toBe('fact_check'); // chamada única checagem+revisão
    expect(PILOT_STAGES.review.adapterKind).toBe('editorial_review'); // alinhado a DISPATCHABLE_KINDS da Integration
    expect(PILOT_STAGES.social_pack.adapterKind).toBe('social_copy');
    expect(INDEPENDENT_STAGES).toEqual(['factcheck', 'review', 'check_edit']);
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
    expect(authorOfDeclaredModel('gemini-3-pro (antigravity)')).toBe('google');
    expect(authorOfDeclaredModel('google/gemini-3')).toBe('google');
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
    expect(validatePilotRow(check(1, 0, { reviewed_draft_task_id: undefined }))).toEqual(expect.arrayContaining([expect.stringMatching(/reviewed_draft_task_id/)]));
    expect(validatePilotRow(check(1, 0, { gate_reasons: ['same_author'] }))).toEqual(expect.arrayContaining([expect.stringMatching(/approved com motivo bloqueante \(same_author\)/)]));
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
    expect(same.exit.overall).toBe('invalid'); // conta codex com modelo Claude declarado também é registro contraditório (QA 3, F1)
    expect(same.independence.failures[0]).toMatch(/a1\/c1\(check_edit\): redator claude-sonnet-5-5 x checador claude-opus-5-5/);
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

describe('sondas do QA 1 sobre o avaliador (f5c7b08)', () => {
  // (1) independência por par redator→checador da MESMA revisão, sem sobrescrita
  it('1a. rascunho posterior de outro autor NÃO faz passar uma checagem do mesmo autor (a checagem aponta a revisão que recebeu)', () => {
    const rows = [
      draft(1, 0, { task_id: 'd1', declared_model: 'claude-sonnet-5-5' }),
      check(1, 3, { declared_model: 'claude-opus-5-5' }), // Claude redigiu e outro Claude checou: reprova
      draft(1, 10, { task_id: 'd1b', declared_model: 'gpt-6.1-terra' }), // revisão posterior de outro autor, depois da checagem
    ];
    const e = evaluatePilot(rows);
    expect(e.exit.independence).toBe('fail');
    expect(e.exit.overall).toBe('invalid'); // o par do mesmo autor só existe com conta e modelo contraditórios
    expect(e.independence.failures[0]).toMatch(/redator claude-sonnet-5-5 x checador claude-opus-5-5/);
    expect(e.independence.uncheckedFinalDrafts).toEqual(['a1/d1b']); // e a revisão final nunca foi checada
  });

  it('1b. o par correto passa; checagem ligada à revisão errada, ausente, ambígua, de outra matéria ou anterior ao rascunho falha', () => {
    const d1 = draft(1, 0);
    expect(evaluatePilot([d1, check(1, 3)]).exit.independence).toBe('pass');
    // revisão 2 do mesmo artigo, checada de fato: cada par vale por si
    const d1b = draft(1, 10, { task_id: 'd1b', declared_model: 'claude-opus-5-5' });
    const rev = evaluatePilot([d1, check(1, 3), d1b, check(1, 13, { task_id: 'c1b', reviewed_draft_task_id: 'd1b' })]);
    expect(rev.independence).toMatchObject({ checked: 2, ok: 2, uncheckedFinalDrafts: [] });
    expect(rev.exit.independence).toBe('pass');
    // sem vínculo
    expect(evaluatePilot([d1, check(1, 3, { reviewed_draft_task_id: undefined })]).independence.failures[0]).toMatch(/vínculo ausente/);
    // vínculo para rascunho inexistente
    expect(evaluatePilot([d1, check(1, 3, { reviewed_draft_task_id: 'nao-existe' })]).independence.failures[0]).toMatch(/não existe ou não está concluído/);
    // vínculo ambíguo (dois rascunhos concluídos com o mesmo task_id)
    expect(evaluatePilot([d1, draft(1, 1, { task_id: 'd1' }), check(1, 6)]).independence.failures[0]).toMatch(/vínculo ambíguo/);
    // rascunho de outra matéria
    expect(evaluatePilot([draft(2, 0), check(1, 3, { reviewed_draft_task_id: 'd2' })]).independence.failures[0]).toMatch(/é da matéria a2/);
    // checagem começou antes de o rascunho terminar
    expect(evaluatePilot([d1, check(1, 1)]).independence.failures[0]).toMatch(/antes de o rascunho/);
    // checagem aponta um rascunho que não concluiu
    expect(evaluatePilot([draft(1, 0, { outcome: 'failed' }), check(1, 3)]).independence.failures[0]).toMatch(/não existe ou não está concluído/);
  });

  // (2) motivo bloqueante
  it('2. gate_reasons com same_author reprova mesmo com autores declarados diferentes; aprovado + motivo bloqueante é linha inválida', () => {
    const approvedWithReason = evaluatePilot([draft(1, 0), check(1, 3, { gate_reasons: ['same_author'] })]);
    expect(approvedWithReason.exit.independence).toBe('fail');
    expect(approvedWithReason.invalidRows).toHaveLength(1);
    expect(approvedWithReason.exit.overall).not.toBe('pass');
    // bloqueado com same_author: o checador reportou o mesmo autor: a independência do par também reprova
    const blocked = evaluatePilot([draft(1, 0), check(1, 3, { gate_verdict: 'blocked', gate_reasons: ['same_author'], unsupported_facts: undefined })]);
    expect(blocked.exit.independence).toBe('fail');
    expect(blocked.exit.overall).toBe('fail');
    // cada motivo bloqueante com veredito aprovado é contradição
    for (const reason of BLOCKING_GATE_REASONS) expect(validatePilotRow(check(1, 3, { gate_reasons: [reason] })).join()).toMatch(/motivo bloqueante/);
    // motivo informativo não bloqueia
    expect(validatePilotRow(check(1, 3, { gate_reasons: ['titulo_ajustado'] }))).toEqual([]);
    // aprovado com motivo bloqueante não conta como aprovado para a qualidade
    expect(evaluatePilot([draft(1, 0), check(1, 3, { gate_reasons: ['unsupported_claim'] })]).quality.approvedWithEvaluation).toBe(0);
  });

  // (3) linha inválida invalida a amostra
  it('3. uma linha inválida torna a amostra INVÁLIDA: nunca "pass"', () => {
    const rows = Array.from({ length: 10 }, (_, i) => [draft(i + 1, i * 10), check(i + 1, i * 10 + 3)]).flat();
    expect(evaluatePilot(rows).exit.overall).toBe('pass');
    const bad = rows.map((r) => (r.task_id === 'c5' ? { ...r, started_at: 'ontem' } : r));
    const e = evaluatePilot(bad);
    expect(e.invalidRows.map((x) => x.task_id)).toEqual(['c5']);
    expect(e.exit.sample).toBe('invalid');
    expect(e.exit.overall).toBe('invalid');
    // qualquer tipo de erro de validação invalida (modelo declarado ausente, tokens "medidos", conta errada)
    for (const mutate of [{ declared_model: null }, { account: 'codex' as const }, { tokens_measured: true as never }, { attempt: 0 }]) {
      expect(evaluatePilot([draft(1, 0, mutate as Partial<PilotRow>), check(1, 3)]).exit.overall, JSON.stringify(mutate)).toBe('invalid');
    }
  });

  // (4) parada imediata, linha a linha
  it('4a. stopReasonsOf avalia UMA linha; evaluatePilot informa a posição da linha que causou a parada', () => {
    expect(stopReasonsOf(draft(1, 0))).toEqual([]);
    expect(stopReasonsOf(draft(1, 0, { tarifada_api_call: true, secret_in_log: true }))).toHaveLength(2);
    const e = evaluatePilot([draft(1, 0), check(1, 3), draft(2, 10, { published_attempt: true })]);
    expect(e.stop).toEqual(['linha 3: d2: tentativa de publicar']);
  });

  it('4b. canDispatchNext bloqueia o despacho assim que UMA linha dispara a parada ou é inválida', () => {
    expect(canDispatchNext([draft(1, 0), check(1, 3)])).toEqual({ allowed: true, reasons: [] });
    for (const flag of ['published_attempt', 'tarifada_api_call', 'secret_in_log', 'tool_outside_contract'] as const) {
      const g = canDispatchNext([draft(1, 0), draft(2, 5, { [flag]: true })]);
      expect(g.allowed, flag).toBe(false);
      expect(g.reasons[0]).toMatch(/PARADA IMEDIATA, linha 2/);
    }
    const inv = canDispatchNext([draft(1, 0, { declared_model: null })]);
    expect(inv.allowed).toBe(false);
    expect(inv.reasons[0]).toMatch(/linha 1 inválida/);
  });

  it('4c. PilotSession: a parada vale NA HORA — depois da linha ofensiva a sessão recusa novas linhas e não despacha', () => {
    const s = new PilotSession();
    expect(s.append(draft(1, 0))).toMatchObject({ accepted: true, stopped: false });
    expect(s.canDispatch()).toBe(true);
    const r = s.append(draft(2, 5, { tarifada_api_call: true }));
    expect(r).toMatchObject({ accepted: true, stopped: true });
    expect(r.reasons[0]).toMatch(/chamada à API tarifada/);
    expect(s.canDispatch()).toBe(false);
    // novas linhas são recusadas e não entram na avaliação
    const later = s.append(check(1, 10));
    expect(later).toMatchObject({ accepted: false, stopped: true });
    expect(s.size).toBe(2);
    expect(s.evaluate().exit.overall).toBe('stopped');
    expect(s.blockedBecause().join(' ')).toMatch(/API tarifada/);
  });

  it('4d. PilotSession também fecha a sessão numa linha inválida (a amostra deixou de valer)', () => {
    const s = new PilotSession();
    s.append(draft(1, 0));
    const r = s.append(check(1, 3, { reviewed_draft_task_id: undefined }));
    expect(r.stopped).toBe(true);
    expect(s.canDispatch()).toBe(false);
    expect(s.evaluate().exit.overall).toBe('invalid');
  });
});

describe('etapas novas do piloto (pauta, checagem, revisão separadas) — dados SIMULADOS', () => {
  const triage = (n: number, at: number, over: Partial<PilotRow> = {}) =>
    base({ task_id: `t${n}`, kind: 'classification', article_id: `a${n}`, stage: 'triage', account: 'claude', declared_model: 'claude-haiku-5-5', prompt_version: 'editorial-0.2', started_at: iso(at), ended_at: iso(at + 1), output_valid: true, ...over });
  const factcheck = (n: number, at: number, over: Partial<PilotRow> = {}) =>
    base({ task_id: `f${n}`, kind: 'fact_check', article_id: `a${n}`, stage: 'factcheck', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'editorial-0.2', started_at: iso(at), ended_at: iso(at + 2), reviewed_draft_task_id: `d${n}`, gate_verdict: 'approved', cross_provider_ok: true, ...over });
  const review = (n: number, at: number, over: Partial<PilotRow> = {}) =>
    base({ task_id: `r${n}`, kind: 'editorial_review', article_id: `a${n}`, stage: 'review', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'editorial-0.2', started_at: iso(at), ended_at: iso(at + 2), reviewed_draft_task_id: `d${n}`, gate_verdict: 'approved', cross_provider_ok: true, unsupported_facts: 0, ...over });

  it('pauta: Claude Haiku ou Sonnet; Opus, Codex e contas fora do piloto são inválidos', () => {
    expect(validatePilotRow(triage(1, 0))).toEqual([]);
    expect(validatePilotRow(triage(1, 0, { declared_model: 'claude-sonnet-5-5' }))).toEqual([]); // backup permitido
    expect(validatePilotRow(triage(1, 0, { declared_model: 'claude-opus-5-5' }))).toEqual(expect.arrayContaining([expect.stringMatching(/deve rodar em modelo haiku ou sonnet/)]));
    expect(validatePilotRow(triage(1, 0, { account: 'codex' }))).toEqual(expect.arrayContaining([expect.stringMatching(/etapa triage deve rodar em claude/)]));
    // redação não tem backup; checagem não aceita Claude; Gemini/Antigravity continua fora
    // Emenda de 26/11 à DP-41: a lane opencode/DeepSeek é legítima em qualquer etapa não determinística.
    expect(validatePilotRow(draft(1, 0, { account: 'opencode', declared_model: 'deepseek-chat' }))).toEqual([]);
    expect(validatePilotRow(factcheck(1, 3, { account: 'antigravity' as never, declared_model: 'gemini-3-pro' }))).toEqual(expect.arrayContaining([expect.stringMatching(/deve rodar em codex/)]));
    expect(validatePilotRow(triage(1, 0, { account: 'opencode', declared_model: 'deepseek-chat (opencode)' }))).toEqual([]);
    expect(validatePilotRow(factcheck(1, 3, { account: 'claude' }))).toEqual(expect.arrayContaining([expect.stringMatching(/deve rodar em codex/)]));
  });

  it('backupsUsed conta o uso do Sonnet na pauta; checagem e revisão no Codex não têm backup; Claude checando Claude continua bloqueado', () => {
    const rows = [
      triage(1, 0),
      triage(2, 0, { declared_model: 'claude-sonnet-5-5' }),
      draft(1, 1),
      factcheck(1, 4),
      review(1, 7),
    ];
    const ev = evaluatePilot(rows);
    expect(ev.independence).toMatchObject({ checked: 2, ok: 2, failures: [] });
    expect(ev.backupsUsed).toEqual([{ stage: 'triage', account: 'claude', model: 'sonnet', tasks: 1 }]);
    expect(evaluatePilot([draft(1, 0), factcheck(1, 3)]).backupsUsed).toEqual([]);
    const same = evaluatePilot([draft(1, 0), factcheck(1, 3, { account: 'claude', declared_model: 'claude-opus-5-5' })]);
    expect(same.exit.independence).not.toBe('pass');
    expect(same.exit.overall).toBe('invalid');
  });

  it('checagem e revisão separadas: as duas precisam ser de autor diferente do redator e apontar o mesmo rascunho', () => {
    const ok = evaluatePilot([draft(1, 0), factcheck(1, 3), review(1, 6)]);
    expect(ok.independence).toMatchObject({ checked: 2, ok: 2, failures: [] });
    expect(ok.exit).toMatchObject({ independence: 'pass', quality: 'pass' });
    // revisor do mesmo autor do redator reprova só com a revisão
    const bad = evaluatePilot([draft(1, 0), factcheck(1, 3), review(1, 6, { declared_model: 'claude-opus-5-5' })]);
    expect(bad.independence).toMatchObject({ checked: 2, ok: 1 });
    expect(bad.independence.failures[0]).toMatch(/\(review\): redator claude-sonnet-5-5 x revisor claude-opus-5-5/);
    expect(bad.exit.independence).toBe('fail');
    // revisão sem vínculo reprova
    expect(evaluatePilot([draft(1, 0), factcheck(1, 3), review(1, 6, { reviewed_draft_task_id: undefined })]).exit.overall).toBe('invalid');
  });

  it('a qualidade vale pelo veredito do gate final (revisão ou chamada fundida), não pela checagem sozinha', () => {
    const only = evaluatePilot([draft(1, 0), factcheck(1, 3, { unsupported_facts: 0 })]);
    expect(only.quality.approvedWithEvaluation).toBe(0);
    expect(only.exit.quality).toBe('inconclusive');
    expect(evaluatePilot([draft(1, 0), factcheck(1, 3), review(1, 6, { unsupported_facts: 2 })]).exit.quality).toBe('fail');
  });

  it('janela da conta Claude conta Haiku e Sonnet juntos; a do Codex é separada', () => {
    const rows = [
      triage(1, 0), triage(2, 2), triage(3, 4, { outcome: 'pending_limit', limit_message: 'limite do Claude (SIMULADO)', limit_at: iso(5), account_resumed_at: iso(60) }),
      triage(3, 61, { task_id: 't3b', declared_model: 'claude-sonnet-5-5', attempt: 2 }),
      draft(4, 62), factcheck(4, 65),
    ];
    const e = evaluatePilot(rows);
    expect(e.limitHits).toEqual([{ account: 'claude', at: iso(5), message: 'limite do Claude (SIMULADO)', resumedAt: iso(60) }]);
    expect(e.windows.find((w) => w.account === 'claude')).toMatchObject({ endedByLimit: true });
    expect(e.windows.find((w) => w.account === 'codex')).toBeDefined();
  });

  it('formato da saída: conta os JSON válidos e a taxa; etapa determinística não entra', () => {
    const e = evaluatePilot([triage(1, 0), triage(2, 2, { output_valid: false }), draft(1, 0, { output_valid: true }), base({ task_id: 'q1', stage: 'rights_seo_qa', account: 'deterministic', declared_model: null, prompt_version: null, output_valid: true })]);
    expect(e.outputValidity).toEqual({ checked: 3, valid: 2, rate: 2 / 3 });
  });

  it('custo zero tarifado: tariffed.apiCalls conta e a chamada à API tarifada é parada imediata', () => {
    expect(evaluatePilot([draft(1, 0), factcheck(1, 3), review(1, 6)]).tariffed.apiCalls).toBe(0);
    const e = evaluatePilot([draft(1, 0), factcheck(1, 3, { tarifada_api_call: true })]);
    expect(e.tariffed.apiCalls).toBe(1);
    expect(e.exit.overall).toBe('stopped');
    expect(canDispatchNext([draft(1, 0), factcheck(1, 3, { tarifada_api_call: true })]).allowed).toBe(false);
  });
});

describe('configInvalidOf: execução sem modelo', () => {
  it('linha não determinística sem declared_model é invalidade de configuração', () => {
    expect(configInvalidOf({ stage: 'triage', account: 'opencode', declared_model: null })).toEqual(expect.arrayContaining([expect.stringMatching(/modelo declarado ausente/)]));
    expect(configInvalidOf({ stage: 'triage', account: 'opencode', declared_model: 'deepseek-v4.1-flash' })).toEqual([]);
    expect(configInvalidOf({ stage: 'rights_seo_qa', account: 'deterministic', declared_model: null })).toEqual([]);
  });
});

describe('QA 3 (ba51ea2), F1: conta × modelo declarado coerentes (sondas A–H)', () => {
  const contradiz = (r: PilotRow) => validatePilotRow(r).filter((x) => /registro contraditório/.test(x));
  const pass = (rows: PilotRow[]) => evaluatePilot(rows);
  it('A. checagem em codex com modelo deepseek (rascunho Claude) é inválida, não pass; check_edit idem', () => {
    const f = base({ task_id: 'f1', kind: 'fact_check', stage: 'factcheck', account: 'codex', declared_model: 'deepseek-chat', prompt_version: 'editorial-0.2', started_at: iso(3), ended_at: iso(5), reviewed_draft_task_id: 'd1', gate_verdict: 'approved', cross_provider_ok: true });
    expect(contradiz(f)).toHaveLength(1);
    expect(pass([draft(1, 0), f]).exit.overall).toBe('invalid');
    expect(contradiz(check(1, 3, { declared_model: 'deepseek-chat' }))).toHaveLength(1);
    expect(pass([draft(1, 0), check(1, 3, { declared_model: 'deepseek-chat' })]).exit.overall).toBe('invalid');
  });
  it('B/C. codex com modelo Gemini, claude com modelo Gemini e redação em claude com modelo Gemini são inválidos', () => {
    expect(contradiz(check(1, 3, { account: 'codex', declared_model: 'gemini-3-pro' }))).toHaveLength(1);
    expect(contradiz(draft(1, 0, { declared_model: 'gemini-3-pro' }))).toHaveLength(1);
    expect(pass([draft(1, 0, { declared_model: 'gemini-3-pro' }), check(1, 3)]).exit.overall).toBe('invalid');
  });
  it('D/G. pauta em claude com modelo DeepSeek, GPT ou Gemini é inválida; Haiku e Sonnet são coerentes', () => {
    const t = (over: Partial<PilotRow>) => base({ task_id: 't1', kind: 'classification', stage: 'triage', account: 'claude', declared_model: 'claude-haiku-5-5', prompt_version: 'editorial-0.2', output_valid: true, ...over });
    expect(contradiz(t({}))).toEqual([]);
    expect(contradiz(t({ declared_model: 'claude-sonnet-5-5' }))).toEqual([]);
    expect(contradiz(t({ declared_model: 'deepseek-chat (opencode)' }))).toHaveLength(1);
    expect(contradiz(t({ declared_model: 'gpt-6.1-terra' }))).toHaveLength(1);
    expect(contradiz(t({ declared_model: 'gemini-3-pro' }))).toHaveLength(1);
  });
  it('I. opencode com modelo DeepSeek é coerente; opencode com Claude é contraditório; claude com DeepSeek continua inválido', () => {
    expect(contradiz(draft(1, 0, { account: 'opencode', declared_model: 'deepseek-v4.1-flash' }))).toEqual([]);
    expect(contradiz(check(1, 3, { account: 'opencode', declared_model: 'deepseek-v4.1-flash' }))).toEqual([]);
    expect(contradiz(draft(1, 0, { account: 'opencode', declared_model: 'claude-sonnet-5-5' }))).toHaveLength(1);
    expect(contradiz(draft(1, 0, { account: 'claude', declared_model: 'deepseek-v4.1-flash' }))).toHaveLength(1);
  });
  it('E/H. codex com modelo Claude ou com autor desconhecido não passa', () => {
    expect(contradiz(check(1, 3, { declared_model: 'claude-opus-5-5' }))).toHaveLength(1);
    expect(contradiz(check(1, 3, { declared_model: 'modelo-x' }))).toHaveLength(1);
    expect(pass([draft(1, 0), check(1, 3, { declared_model: 'modelo-x' })]).exit.overall).toBe('invalid');
  });
  it('pares coerentes continuam válidos (Claude↔Anthropic, Codex↔OpenAI)', () => {
    expect(contradiz(draft(1, 0))).toEqual([]);
    expect(contradiz(check(1, 3))).toEqual([]);
    expect(contradiz(base({ task_id: 'q', stage: 'rights_seo_qa', account: 'deterministic', declared_model: null, prompt_version: null, output_valid: true }))).toEqual([]);
    expect(contradiz(base({ task_id: 'q', stage: 'rights_seo_qa', account: 'deterministic', declared_model: 'gpt-6.1-terra', prompt_version: null }))).toHaveLength(1);
  });
});

describe('patch da linha (veredito da Editorial e leitura humana)', () => {
  const done = base({ task_id: 'f9', kind: 'fact_check', article_id: 'a9', stage: 'factcheck', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'editorial-0.3', reviewed_draft_task_id: 'd9' });
  it('sem veredito a linha concluída é inválida; o patch com o veredito a completa', async () => {
    const { applyRowPatch } = await import('./pilot');
    expect(validatePilotRow(done)).toEqual(expect.arrayContaining([expect.stringMatching(/gate_verdict/)]));
    const r = applyRowPatch(done, { gate_verdict: 'approved', cross_provider_ok: true, output_valid: true });
    expect(r.errors).toEqual([]);
    expect(validatePilotRow(r.row)).toEqual([]);
  });
  it('só campos do patch: conta, modelo, tempo, custo e parada imediata não mudam; patch contraditório é recusado', async () => {
    const { applyRowPatch, PATCHABLE_ROW_FIELDS } = await import('./pilot');
    expect(PATCHABLE_ROW_FIELDS).toEqual(['gate_verdict', 'gate_reasons', 'cross_provider_ok', 'output_valid', 'unsupported_facts', 'unsupported_high', 'unsupported_medium', 'unsupported_low', 'notes']);
    for (const bad of [{ account: 'claude' }, { declared_model: 'claude-opus-5-5' }, { tarifada_api_call: false }, { published_attempt: false }, { ended_at: iso(99) }, { secret_in_log: false }]) {
      const r = applyRowPatch(done, bad);
      expect(r.errors[0]).toMatch(/não pode ser alterado por patch/);
      expect(r.row).toBe(done);
    }
    const contradictory = applyRowPatch(done, { gate_verdict: 'approved', gate_reasons: ['same_author'] });
    expect(contradictory.errors[0]).toMatch(/motivo bloqueante/);
    expect(contradictory.row).toBe(done);
  });
});

describe('critério de qualidade aprovado pelo PM: 0 altas e no máximo 1 média nas 10 (baixas só anotadas)', () => {
  const rev = (n: number, over: Partial<PilotRow> = {}) =>
    base({ task_id: `r${n}`, kind: 'editorial_review', article_id: `a${n}`, stage: 'review', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'editorial-0.3', started_at: iso(n * 10 + 3), ended_at: iso(n * 10 + 5), reviewed_draft_task_id: `d${n}`, gate_verdict: 'approved', cross_provider_ok: true, ...over });
  const fc = (n: number) => base({ task_id: `f${n}`, kind: 'fact_check', article_id: `a${n}`, stage: 'factcheck', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'editorial-0.3', started_at: iso(n * 10 + 1), ended_at: iso(n * 10 + 2), reviewed_draft_task_id: `d${n}`, gate_verdict: 'approved', cross_provider_ok: true });
  const ds = (n: number) => draft(n, n * 10);
  const run = (revs: (n: number) => Partial<PilotRow>) => {
    const rows: PilotRow[] = [];
    for (let n = 1; n <= 10; n++) rows.push(ds(n), fc(n), rev(n, revs(n)));
    return evaluatePilot(rows);
  };
  it('0 altas, 1 média e baixas anotadas passa; 2 médias reprova; 1 alta reprova', () => {
    const ok = run((n) => (n === 3 ? { unsupported_facts: 3, unsupported_high: 0, unsupported_medium: 1, unsupported_low: 2 } : { unsupported_facts: 0 }));
    expect(ok.exit.quality).toBe('pass');
    expect(ok.quality).toMatchObject({ high: 0, medium: 1, low: 2, unsupportedFacts: 3, unclassifiedCountedAsHigh: 0 });
    expect(run((n) => (n <= 2 ? { unsupported_facts: 1, unsupported_high: 0, unsupported_medium: 1, unsupported_low: 0 } : { unsupported_facts: 0 })).exit.quality).toBe('fail');
    expect(run((n) => (n === 5 ? { unsupported_facts: 1, unsupported_high: 1, unsupported_medium: 0, unsupported_low: 0 } : { unsupported_facts: 0 })).exit.quality).toBe('fail');
  });
  it('sem gravidade informada o fato conta como ALTO (falha fechada); gravidade que não soma é linha inválida', () => {
    const e = run((n) => (n === 1 ? { unsupported_facts: 1 } : { unsupported_facts: 0 }));
    expect(e.exit.quality).toBe('fail');
    expect(e.exit.overall).toBe('stopped'); // a parada conservadora (fato ALTO) vem antes do reprovado
    expect(e.quality.unclassifiedCountedAsHigh).toBe(1);
    expect(validatePilotRow(rev(1, { unsupported_facts: 2, unsupported_high: 1, unsupported_medium: 0, unsupported_low: 0 }))).toEqual(expect.arrayContaining([expect.stringMatching(/deve ser igual a unsupported_facts/)]));
    expect(run((n) => (n === 1 ? { unsupported_facts: 2, unsupported_medium: 1 } : { unsupported_facts: 0 })).exit.overall).toBe('invalid');
  });
});

describe('códigos de barreira da Editorial como motivo bloqueante (tone_lint e autoral_invalid)', () => {
  const rev = (over: Partial<PilotRow> = {}) =>
    base({ task_id: 'r1', kind: 'editorial_review', article_id: 'a1', stage: 'review', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'editorial-0.3', started_at: iso(3), ended_at: iso(5), reviewed_draft_task_id: 'd1', cross_provider_ok: true, ...over });

  it('BLOCKING_GATE_REASONS inclui tone_lint e autoral_invalid, e mantém os anteriores', () => {
    expect(BLOCKING_GATE_REASONS).toEqual(expect.arrayContaining(['tone_lint', 'autoral_invalid', 'same_author', 'unsupported_claim', 'copy_literal', 'cross_provider_check_failed']));
  });

  it.each(['tone_lint', 'autoral_invalid'])('veredito approved com %s é registro contraditório (linha inválida)', (reason) => {
    expect(validatePilotRow(rev({ gate_verdict: 'approved', gate_reasons: [reason] }))).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`approved com motivo bloqueante \\(${reason}\\)`))]));
    expect(evaluatePilot([draft(1, 0), rev({ gate_verdict: 'approved', gate_reasons: [reason] })]).exit.overall).toBe('invalid');
  });

  it.each(['tone_lint', 'autoral_invalid'])('veredito blocked com %s é válido (a barreira funcionou) e não conta como aprovada', (reason) => {
    const row = rev({ gate_verdict: 'blocked', gate_reasons: [reason] });
    expect(validatePilotRow(row)).toEqual([]);
    const e = evaluatePilot([draft(1, 0), row]);
    expect(e.exit.overall).not.toBe('invalid');
    expect(e.quality.approvedWithEvaluation + e.quality.approvedWithoutEvaluation).toBe(0);
  });

  it('approved sem motivo bloqueante continua válido', () => {
    expect(validatePilotRow(rev({ gate_verdict: 'approved', gate_reasons: [] }))).toEqual([]);
  });
});

describe('PM-2026-11-23-K: stale_approval e invalid_model_output também são motivos bloqueantes', () => {
  const rev = (over: Partial<PilotRow> = {}) =>
    base({ task_id: 'r1', kind: 'editorial_review', article_id: 'a1', stage: 'review', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'editorial-0.3', started_at: iso(3), ended_at: iso(5), reviewed_draft_task_id: 'd1', cross_provider_ok: true, ...over });

  it('a lista inclui os dois novos e os anteriores', () => {
    expect(BLOCKING_GATE_REASONS).toEqual(expect.arrayContaining(['stale_approval', 'invalid_model_output', 'tone_lint', 'autoral_invalid', 'same_author', 'unsupported_claim']));
  });

  it.each(['stale_approval', 'invalid_model_output'])('approved com %s é registro contraditório (linha inválida; amostra inválida)', (reason) => {
    expect(validatePilotRow(rev({ gate_verdict: 'approved', gate_reasons: [reason] }))).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(`approved com motivo bloqueante \\(${reason}\\)`))]));
    expect(evaluatePilot([draft(1, 0), rev({ gate_verdict: 'approved', gate_reasons: [reason] })]).exit.overall).toBe('invalid');
  });

  it.each(['stale_approval', 'invalid_model_output'])('blocked com %s é válido e não conta como aprovada', (reason) => {
    const row = rev({ gate_verdict: 'blocked', gate_reasons: [reason] });
    expect(validatePilotRow(row)).toEqual([]);
    const e = evaluatePilot([draft(1, 0), row]);
    expect(e.exit.overall).not.toBe('invalid');
    expect(e.quality.approvedWithEvaluation + e.quality.approvedWithoutEvaluation).toBe(0);
  });

  it.each(['duplicate', 'suspicious_evidence', 'not_relevant', 'budget_blocked', 'max_attempts', 'no_image', 'not_published'])('%s continua FORA da lista (bloqueio operacional): com blocked é válido e a lista não o contém', (reason) => {
    expect(BLOCKING_GATE_REASONS as readonly string[]).not.toContain(reason);
    expect(validatePilotRow(rev({ gate_verdict: 'blocked', gate_reasons: [reason] }))).toEqual([]);
  });
});

describe('paradas conservadoras do PM (24/11): 1º INVÁLIDO, 1º fato ALTO e 2 falhas seguidas do patch do veredito', () => {
  const rev = (n: number, over: Partial<PilotRow> = {}) =>
    base({ task_id: `r${n}`, kind: 'editorial_review', article_id: `a${n}`, stage: 'review', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'editorial-0.3', started_at: iso(n * 10 + 3), ended_at: iso(n * 10 + 5), reviewed_draft_task_id: `d${n}`, cross_provider_ok: true, ...over });
  const fc = (n: number, over: Partial<PilotRow> = {}) =>
    base({ task_id: `f${n}`, kind: 'fact_check', article_id: `a${n}`, stage: 'factcheck', account: 'codex', declared_model: 'gpt-6.1-terra', prompt_version: 'editorial-0.3', started_at: iso(n * 10 + 1), ended_at: iso(n * 10 + 2), reviewed_draft_task_id: `d${n}`, cross_provider_ok: true, ...over });

  it('(1) o PRIMEIRO registro inválido recusa o despacho (já imposto: canDispatchNext) e fecha a sessão na linha', () => {
    const bom = draft(1, 0);
    const ruim = rev(1, { gate_verdict: 'approved', gate_reasons: ['tone_lint'] });
    expect(canDispatchNext([bom]).allowed).toBe(true);
    const g = canDispatchNext([bom, ruim]);
    expect(g.allowed).toBe(false);
    expect(g.reasons.join(' ')).toMatch(/linha 2 inválida \(r1\)/);
    const s = new PilotSession();
    expect(s.append(bom).stopped).toBe(false);
    expect(s.append(ruim)).toMatchObject({ accepted: true, stopped: true });
    expect(s.canDispatch()).toBe(false);
    expect(s.append(draft(2, 30)).accepted).toBe(false); // nada novo entra depois
  });

  it('(2) o PRIMEIRO fato de gravidade ALTA para: gravidade alta, ou fato sem gravidade (conta como alto); média e baixa não param', () => {
    const base0 = { gate_verdict: 'approved' as const };
    expect(stopReasonsOf(rev(1, { ...base0, unsupported_facts: 1, unsupported_high: 1, unsupported_medium: 0, unsupported_low: 0 })).join(' ')).toMatch(/gravidade ALTA/);
    expect(stopReasonsOf(rev(1, { ...base0, unsupported_facts: 1 })).join(' ')).toMatch(/gravidade ALTA/); // sem gravidade = alto
    expect(stopReasonsOf(rev(1, { ...base0, unsupported_facts: 1, unsupported_high: 0, unsupported_medium: 1, unsupported_low: 0 }))).toEqual([]);
    expect(stopReasonsOf(rev(1, { ...base0, unsupported_facts: 3, unsupported_high: 0, unsupported_medium: 0, unsupported_low: 3 }))).toEqual([]);
    expect(stopReasonsOf(rev(1, { ...base0, unsupported_facts: 0 }))).toEqual([]);
    expect(highFactOf({ unsupported_facts: 1, unsupported_high: 1 })).toBe(true);
    expect(highFactOf({})).toBe(false);
    const alta = rev(5, { ...base0, unsupported_facts: 1, unsupported_high: 1, unsupported_medium: 0, unsupported_low: 0 });
    expect(canDispatchNext([draft(5, 50), fc(5, base0), alta]).allowed).toBe(false);
    expect(canDispatchNext([draft(5, 50), fc(5, base0), alta]).reasons.join(' ')).toMatch(/PARADA IMEDIATA, linha 3/);
    const e = evaluatePilot([draft(5, 50), fc(5, base0), alta]);
    expect(e.exit.overall).toBe('stopped');
    expect(e.exit.stopped).toBe(true);
    const s = new PilotSession();
    s.append(draft(5, 50));
    s.append(fc(5, base0));
    expect(s.append(alta)).toMatchObject({ stopped: true });
  });

  it('(3) duas falhas SEGUIDAS do patch do veredito (linhas concluídas sem gate_verdict) param; uma só, ou uma com veredito no meio, não', () => {
    expect(VERDICT_STREAK_LIMIT).toBe(2);
    expect(missingVerdictStreak([fc(1)]).longest).toBe(1);
    expect(verdictStreakReasons([draft(1, 0), fc(1)])).toEqual([]);
    const duas = [draft(1, 0), fc(1), draft(2, 20), fc(2)]; // f1 e f2 sem veredito, em sequência
    expect(missingVerdictStreak(duas)).toEqual({ longest: 2, ids: ['f1', 'f2'] });
    expect(verdictStreakReasons(duas)[0]).toMatch(/falhou 2 vezes seguidas \(pilot_row_patch_failed; linhas sem gate_verdict: f1, f2\)/);
    // um veredito entre as duas zera a sequência
    const meio = [fc(1), fc(2, { gate_verdict: 'approved' }), fc(3)];
    expect(missingVerdictStreak(meio).longest).toBe(1);
    expect(verdictStreakReasons(meio)).toEqual([]);
    // a ordem é a do início, não a da lista
    expect(missingVerdictStreak([fc(3), fc(1, { gate_verdict: 'approved' }), fc(2)]).longest).toBe(2);
    // linha que não está concluída (pending_limit) não conta; etapa que não é independente não conta
    expect(missingVerdictStreak([fc(1, { outcome: 'pending_limit', limit_message: 'limite (SIMULADO)', limit_at: iso(5) }), fc(2), draft(3, 40)]).longest).toBe(1);
  });

  it('(3) a sequência para o piloto no avaliador e no gate: canDispatchNext, PilotSession e evaluatePilot (PARADO)', () => {
    const duas = [draft(1, 0), fc(1), rev(1), draft(2, 20)];
    const g = canDispatchNext(duas);
    expect(g.allowed).toBe(false);
    expect(g.reasons.join(' ')).toMatch(/PARADA IMEDIATA: patch do veredito falhou 2 vezes seguidas/);
    const e = evaluatePilot(duas);
    expect(e.exit.overall).toBe('stopped');
    expect(e.stop.join(' ')).toMatch(/pilot_row_patch_failed/);
    expect(evaluatePilot([draft(1, 0), fc(1)]).exit.overall).not.toBe('stopped');
  });
});
