import { describe, expect, it } from 'vitest';
import { canDispatchNext, configInvalidOf, evaluatePilot, PILOT_ROUTE_HISTORY, PILOT_STAGES, pilotRouteRuleOf, validatePilotRow, type PilotRow } from './pilot';

// As 4 linhas da parada de 26/11 21:00:52Z. Chave, conta, modelo, datas e veredito vêm dos registros do piloto (fast-track/piloto: parada,
// medição de 25/11, destravamento); os demais campos são preenchimento SIMULADO válido (não é exportação do banco).
const row = (task_id: string, attempt: number, declared_model: string, started_at: string, ended_at: string, over: Partial<PilotRow> = {}): PilotRow => ({
  task_id, attempt, declared_model, started_at, ended_at, kind: 'editorial_draft', article_id: `art-${task_id.slice(5, 13)}`, source_id: 'abemf', stage: 'draft', account: 'claude',
  prompt_version: 'editorial-0.3', outcome: 'completed', packet_chars: 4000, tokens_measured: false,
  published_attempt: false, tarifada_api_call: false, secret_in_log: false, tool_outside_contract: false, ...over,
});
const HISTORICAS: PilotRow[] = [
  row('task-445fd7c4-7c59-4a5d-9acb-442dea536876', 1, 'claude-sonnet-5-5', '2026-11-25T15:34:15.060Z', '2026-11-25T15:34:15.061Z', { gate_verdict: 'approved', gate_reasons: [] }),
  row('task-440b508b-0217-4bb9-b254-5508b7b97ffc', 2, 'opencode-go/claude-haiku-5-5', '2026-11-26T03:47:32.466Z', '2026-11-26T03:48:30.205Z'),
  row('task-cab96daa-e1c4-435a-b81c-4c3969716eab', 3, 'opencode-go/claude-haiku-5-5', '2026-11-26T05:05:20.000Z', '2026-11-26T05:05:27.000Z'),
  row('task-30453d26-be25-4cb0-a192-484723d8087b', 1, 'claude-sonnet-5-5', '2026-11-26T11:50:18.000Z', '2026-11-26T11:55:34.000Z', { gate_verdict: 'approved', gate_reasons: [] }),
];
const REFUSED = 'etapa draft deve rodar em opencode';
const refusedAlone = (r: PilotRow) => {
  const g = canDispatchNext([r]);
  expect(g.allowed, JSON.stringify(r)).toBe(false);
  return g.reasons.join(' | ');
};

describe('regra de via com vigência (parada de 26/11): linha antiga julgada pela regra em que foi produzida', () => {
  it('as 4 linhas históricas não param o piloto', () => {
    expect(canDispatchNext(HISTORICAS)).toEqual({ allowed: true, reasons: [] });
    for (const r of HISTORICAS) {
      expect(validatePilotRow(r)).toEqual([]);
      expect(configInvalidOf(r)).toEqual([]);
      expect(pilotRouteRuleOf(r)?.rule).toBe('draft-v1');
    }
    expect(evaluatePilot(HISTORICAS).backupsUsed).toEqual([]);
  });

  it('a lista da versão é exatamente a das 4 linhas, e a regra vigente continua só opencode', () => {
    expect(PILOT_ROUTE_HISTORY).toHaveLength(1);
    expect(PILOT_ROUTE_HISTORY[0]!.rows).toEqual(HISTORICAS.map((r) => `${r.task_id}#${r.attempt}`));
    expect(PILOT_STAGES.draft.account).toBe('opencode');
    expect(Object.isFrozen(PILOT_ROUTE_HISTORY) && Object.isFrozen(PILOT_ROUTE_HISTORY[0]!.rows)).toBe(true);
  });

  it('controle negativo: as mesmas 4 linhas fora da lista param pelo motivo registrado na parada', () => {
    const outras = HISTORICAS.map((r, i) => ({ ...r, task_id: `task-nova-${i}` }));
    const g = canDispatchNext(outras);
    expect(g.allowed).toBe(false);
    expect(g.reasons).toEqual(outras.map((r, i) => `linha ${i + 1} inválida (${r.task_id}): ${REFUSED}`));
  });

  it.each([
    ['linha nova depois do corte', { task_id: 'task-nova', started_at: '2026-11-26T22:00:00.000Z', ended_at: '2026-11-26T22:01:00.000Z' }],
    ['linha nova com data recuada', { task_id: 'task-nova' }],
    ['outra tentativa da tarefa listada', { attempt: 9 }],
    ['chave listada que começou depois do corte', { started_at: '2026-11-26T22:00:00.000Z', ended_at: '2026-11-26T22:01:00.000Z' }],
    ['chave listada que terminou no corte', { ended_at: '2026-11-26T20:38:00.000Z' }],
  ] as const)('draft em claude continua recusado: %s', (_n, over) => {
    expect(refusedAlone({ ...HISTORICAS[3]!, ...over })).toContain(REFUSED);
  });

  it('sem datas válidas vale a regra vigente (falha fechada)', () => {
    const { started_at: _s, ended_at: _e, ...semDatas } = HISTORICAS[0]!;
    expect(configInvalidOf(semDatas)).toEqual([REFUSED]);
    expect(refusedAlone({ ...HISTORICAS[0]!, ended_at: 'ontem' })).toContain(REFUSED);
  });

  it('uma linha nova em claude entre as históricas para o piloto, e só ela é citada', () => {
    const nova = row('task-nova', 1, 'claude-sonnet-5-5', '2026-11-27T10:00:00.000Z', '2026-11-27T10:01:00.000Z');
    expect(canDispatchNext([...HISTORICAS, nova]).reasons).toEqual([`linha 5 inválida (task-nova): ${REFUSED}`]);
    expect(canDispatchNext([...HISTORICAS, { ...nova, account: 'opencode', declared_model: 'opencode-go/deepseek-v4-pro' }]).allowed).toBe(true);
  });

  it.each([
    ['publicação', { published_attempt: true }, 'tentativa de publicar'],
    ['API tarifada', { tarifada_api_call: true }, 'chamada à API tarifada'],
    ['segredo em log', { secret_in_log: true }, 'segredo em log'],
    ['ferramenta fora do contrato', { tool_outside_contract: true }, 'ferramenta fora do contrato'],
    ['fato ALTO', { unsupported_facts: 1, unsupported_high: 1, unsupported_medium: 0, unsupported_low: 0 }, 'gravidade ALTA'],
    ['fato sem gravidade', { unsupported_facts: 1 }, 'gravidade ALTA'],
  ] as const)('a parada imediata continua valendo na linha histórica: %s', (_n, over, motivo) => {
    expect(refusedAlone({ ...HISTORICAS[0]!, ...over })).toMatch(new RegExp(`PARADA IMEDIATA.*${motivo}`));
  });

  it.each([
    ['conta fora da regra antiga', { account: 'codex', declared_model: 'gpt-6.1-terra' }, 'etapa draft deve rodar em claude ou opencode'],
    ['modelo contraditório com a conta', { declared_model: 'gpt-6.1-terra' }, 'registro contraditório'],
    ['sem modelo declarado', { declared_model: null }, 'modelo declarado'],
    ['approved com motivo bloqueante', { gate_verdict: 'approved', gate_reasons: ['unsupported_claim'] }, 'motivo bloqueante'],
    ['outra etapa com a chave listada', { stage: 'factcheck', kind: 'fact_check', reviewed_draft_task_id: 'd', gate_verdict: 'approved' }, 'etapa factcheck deve rodar em codex ou opencode'],
  ] as const)('a exceção não afrouxa outra validação: %s', (_n, over, motivo) => {
    expect(refusedAlone({ ...HISTORICAS[0]!, ...over } as PilotRow)).toContain(motivo);
  });
});
