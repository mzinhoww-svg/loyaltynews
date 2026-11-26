// Guard de subida do worker (ADR-002): nenhuma fila declarada pode ficar sem destino.
// Fila órfã — sem handler e sem desligamento explícito — derruba o start, com o nome da fila.
// Fila `on` sem handler também; fila `off` com handler é contradição e derruba também.
import { QUEUE_NAMES, type QueueDecision, type QueueName } from './queues';
import type { Handlers } from './runtime';

export type Decisions = Partial<Record<string, QueueDecision>>;

/** Problemas da política: lista vazia = pode subir. Nunca lança; quem chama decide (main sai com 1). */
export function queuePolicyProblems(decisions: Decisions, handlers: Handlers): string[] {
  const problems: string[] = [];
  const declared = new Set<string>(QUEUE_NAMES);
  for (const q of QUEUE_NAMES) {
    const d = decisions[q];
    if (!d) {
      problems.push(`fila ${q} declarada sem destino: registre um handler (on) ou desligue explicitamente com motivo (off)`);
      continue;
    }
    if (!d.why || !d.why.trim()) problems.push(`fila ${q}: decisão ${d.mode} sem motivo escrito`);
    if (d.mode === 'on' && !handlers[q]) problems.push(`fila ${q} marcada como processada, mas sem handler registrado`);
    if (d.mode === 'off' && handlers[q]) problems.push(`fila ${q} desligada, mas com handler registrado (decisão contraditória)`);
  }
  for (const q of Object.keys(decisions)) {
    if (!declared.has(q)) problems.push(`decisão para fila não declarada em QUEUE_NAMES: ${q}`);
  }
  return problems;
}

/** Handlers que sobem: só das filas `on`. */
export function handlersForQueues(decisions: Decisions, handlers: Handlers): Handlers {
  const out: Handlers = {};
  for (const q of QUEUE_NAMES) {
    if (decisions[q]?.mode === 'on' && handlers[q]) out[q] = handlers[q];
  }
  return out;
}

/** Linha de log da subida: uma por fila, sem segredo. */
export function policyLines(decisions: Decisions): string[] {
  return QUEUE_NAMES.map((q: QueueName) => {
    const d = decisions[q];
    return `${q}=${d ? d.mode : 'SEM DESTINO'}${d?.mode === 'off' ? ` (${d.why})` : ''}`;
  });
}
