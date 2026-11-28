// Filas do ADR-002: coleta, redação, checagem, social, entidades, métricas, reuniões.
// Redis guarda só IDs e a chave de idempotência; a verdade fica no PostgreSQL (outbox).

export const QUEUE_NAMES = ['coleta', 'redacao', 'checagem', 'social', 'entidades', 'metricas', 'reunioes'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/**
 * Destino de CADA fila do ADR-002. Toda fila declarada tem de estar aqui:
 * `on` = processada por um handler registrado; `off` = desligada por decisão explícita, com o motivo.
 * O guard de subida (`queue-guard.ts`) recusa o worker quando falta decisão, quando `on` não tem handler
 * ou quando `off` tem handler. O produtor (`enqueueOutbox`) recusa gravar para fila `off`: nada entra
 * numa fila que ninguém vai consumir.
 */
export type QueueDecision = { mode: 'on'; why: string } | { mode: 'off'; why: string };

export const QUEUE_DECISIONS: Readonly<Record<QueueName, QueueDecision>> = {
  entidades: {
    mode: 'on',
    why: 'publicação e correção viram organizações no Intelligence (determinístico, sem modelo)',
  },
  coleta: {
    mode: 'off',
    why: 'a coleta roda por temporizador do worker ou pela Fábrica em comando próprio (editorialCollector), não por esta fila; nenhum produtor grava aqui',
  },
  redacao: {
    mode: 'off',
    why: 'exige modelo autorizado (modelosHabilitados desligado); a redação roda pela Fábrica em comando próprio',
  },
  checagem: {
    mode: 'off',
    why: 'exige modelo autorizado; o pedido de nova checagem é recusado no enfileiramento em vez de ficar parado',
  },
  social: {
    mode: 'off',
    why: 'o pacote social exige modelo e a publicação real não existe (somente simulada)',
  },
  metricas: {
    mode: 'off',
    why: 'sem produtor: nenhum módulo grava nesta fila; as métricas do ADR-002 não estão no lançamento',
  },
  reunioes: {
    mode: 'off',
    why: 'sem produtor: as reuniões são do AgentOps (meeting_runs), não desta fila',
  },
};

export function queueDecision(name: QueueName): QueueDecision {
  return QUEUE_DECISIONS[name];
}

/** Falso = fila desligada explicitamente; o enfileiramento tem de falhar, não esperar. */
export function isQueueEnabled(name: QueueName): boolean {
  return QUEUE_DECISIONS[name]?.mode === 'on';
}

/** Tenta gravar numa fila desligada: o produtor para aqui em vez de deixar o job sem consumidor. */
export class QueueDisabledError extends Error {
  constructor(readonly queue: QueueName, readonly why: string) {
    super(`fila ${queue} está desligada: ${why}`);
    this.name = 'QueueDisabledError';
  }
}

export interface JobPayload {
  /** ID da linha de negócio (ex.: id da matéria, da fonte). Nunca conteúdo. */
  refId: string;
  /** Chave de idempotência: a mesma chave produz no máximo um efeito. */
  idempotencyKey: string;
}

const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

/**
 * Nomes de fila gravados por outros módulos que se mapeiam para uma fila BullMQ do ADR-002.
 * `intelligence-ingest` (publicação → Intelligence) e `article-corrected` (correção publicada: ADR-019 §c.5) rodam na fila `entidades`.
 */
export const QUEUE_ALIASES: Readonly<Record<string, QueueName>> = { 'intelligence-ingest': 'entidades', 'article-corrected': 'entidades' };

/** Fila BullMQ para o nome gravado no outbox, ou null se desconhecido. */
export function resolveQueue(name: string): QueueName | null {
  if (isQueueName(name)) return name;
  return QUEUE_ALIASES[name] ?? null;
}

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
