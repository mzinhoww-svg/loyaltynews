// Filas do ADR-002: coleta, redação, checagem, social, entidades, métricas, reuniões.
// Redis guarda só IDs e a chave de idempotência; a verdade fica no PostgreSQL (outbox).

export const QUEUE_NAMES = ['coleta', 'redacao', 'checagem', 'social', 'entidades', 'metricas', 'reunioes'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface JobPayload {
  /** ID da linha de negócio (ex.: id da matéria, da fonte). Nunca conteúdo. */
  refId: string;
  /** Chave de idempotência: a mesma chave produz no máximo um efeito. */
  idempotencyKey: string;
}

const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export function isQueueName(v: unknown): v is QueueName {
  return typeof v === 'string' && (QUEUE_NAMES as readonly string[]).includes(v);
}

/** Aceita só {refId, idempotencyKey}, ambos IDs curtos. Qualquer outro campo é rejeitado (sem conteúdo no Redis). */
export function parsePayload(input: unknown): JobPayload {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('payload inválido');
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('refId') || !keys.includes('idempotencyKey')) {
    throw new Error('payload só aceita refId e idempotencyKey');
  }
  const { refId, idempotencyKey } = input as Record<string, unknown>;
  if (typeof refId !== 'string' || !ID_RE.test(refId)) throw new Error('refId inválido');
  if (typeof idempotencyKey !== 'string' || !ID_RE.test(idempotencyKey)) throw new Error('idempotencyKey inválida');
  return { refId, idempotencyKey };
}

/** jobId determinístico: BullMQ ignora add() repetido com o mesmo jobId. BullMQ proíbe ':' em jobId. */
export function jobIdFor(queue: QueueName, idempotencyKey: string): string {
  return `${queue}__${idempotencyKey}`;
}

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false, // falhas ficam como DLQ lógica até o reconciliador/operador tratar
};
