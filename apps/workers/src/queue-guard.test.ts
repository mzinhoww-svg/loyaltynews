// Guard de subida (ADR-002): fila declarada sem destino derruba o start; desligamento explícito sobe.
import { describe, expect, it } from 'vitest';
import { createHandlers } from './handlers';
import { handlersForQueues, policyLines, queuePolicyProblems, type Decisions } from './queue-guard';
import { QUEUE_DECISIONS, QUEUE_NAMES, type QueueDecision } from './queues';

const H = createHandlers({ APP_URL: 'https://exemplo.invalid' });

describe('política de filas na subida', () => {
  it('a política real cobre todas as filas declaradas e passa com os handlers reais', () => {
    expect(Object.keys(QUEUE_DECISIONS).sort()).toEqual([...QUEUE_NAMES].sort());
    for (const q of QUEUE_NAMES) expect(QUEUE_DECISIONS[q].why.trim().length).toBeGreaterThan(10);
    expect(queuePolicyProblems(QUEUE_DECISIONS, H)).toEqual([]);
  });

  it('CONTROLE NEGATIVO: fila órfã (sem handler e sem desligamento explícito) derruba o start, com o nome', () => {
    const semDestino: Decisions = { ...QUEUE_DECISIONS };
    delete semDestino.coleta;
    const p = queuePolicyProblems(semDestino, H);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/fila coleta declarada sem destino/);
  });

  it('fila marcada como processada sem handler derruba o start', () => {
    const p = queuePolicyProblems({ ...QUEUE_DECISIONS, coleta: { mode: 'on', why: 'teste' } }, H);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/fila coleta marcada como processada, mas sem handler/);
  });

  it('fila desligada com handler é contradição e derruba o start', () => {
    const comHandler = { ...H, coleta: H.entidades! };
    const p = queuePolicyProblems(QUEUE_DECISIONS, comHandler);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/fila coleta desligada, mas com handler/);
  });

  it('decisão sem motivo e decisão para fila inexistente também são recusadas', () => {
    const semMotivo = { ...QUEUE_DECISIONS, redacao: { mode: 'off', why: '   ' } as QueueDecision };
    expect(queuePolicyProblems(semMotivo, H).join(' ')).toMatch(/fila redacao: decisão off sem motivo escrito/);
    const extra = { ...QUEUE_DECISIONS, filaFantasma: { mode: 'off', why: 'não existe' } as QueueDecision };
    expect(queuePolicyProblems(extra, H).join(' ')).toMatch(/decisão para fila não declarada em QUEUE_NAMES: filaFantasma/);
  });

  it('só as filas `on` sobem com handler; as `off` não sobem', () => {
    const selected = handlersForQueues(QUEUE_DECISIONS, H);
    expect(Object.keys(selected)).toEqual(['entidades']);
    for (const q of QUEUE_NAMES) {
      if (q === 'entidades') expect(selected[q]).toBeTypeOf('function');
      else expect(selected[q]).toBeUndefined();
    }
  });

  it('o log da subida lista as 7 filas com modo e motivo das desligadas, sem segredo', () => {
    const lines = policyLines(QUEUE_DECISIONS);
    expect(lines).toHaveLength(QUEUE_NAMES.length);
    expect(lines[0]).toMatch(/^coleta=off \(/);
    expect(lines.join(' ')).toMatch(/entidades=on/);
    expect(lines.join(' ')).not.toMatch(/-----BEGIN/);
  });
});
