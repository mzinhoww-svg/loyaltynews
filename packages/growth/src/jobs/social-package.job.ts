import { generatePackages, type Caller, type DashboardDeps, PERMISSIONS } from '../dashboard/handlers';
import { SOCIAL_PACKAGE_TASKS, type ModelGatewayPort } from './gateway';

// Job BullMQ de geração de pacote social. Segue as convenções do Backend (apps/workers, ADR-002): fila `social`,
// payload só com IDs (`refId` = id da matéria, `idempotencyKey`), jobId determinístico sem ':', opções padrão da casa.
// Quando @ln/workers for mesclado, QUEUE_NAMES já contém `social`; estas constantes devem então ser importadas de lá.

export const SOCIAL_QUEUE = 'social' as const;
export const SOCIAL_PACKAGE_JOB = 'social.package.generate' as const;
/** Canais gerados por job: LinkedIn e Instagram (este último nasce bloqueado pela flag desligada). */
export const SOCIAL_PACKAGE_CHANNELS = ['linkedin', 'instagram'] as const;

export interface SocialPackagePayload {
  /** Id da matéria. Nunca conteúdo. */
  refId: string;
  /** Chave de idempotência: a mesma chave produz no máximo um efeito. */
  idempotencyKey: string;
}

const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

/** Mesma regra do Backend: só {refId, idempotencyKey}, ambos IDs curtos; qualquer outro campo é rejeitado. */
export function parseSocialPayload(input: unknown): SocialPackagePayload {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new NonRetryableError('payload inválido');
  const keys = Object.keys(input);
  if (keys.length !== 2 || !keys.includes('refId') || !keys.includes('idempotencyKey')) {
    throw new NonRetryableError('payload só aceita refId e idempotencyKey');
  }
  const { refId, idempotencyKey } = input as Record<string, unknown>;
  if (typeof refId !== 'string' || !ID_RE.test(refId)) throw new NonRetryableError('refId inválido');
  if (typeof idempotencyKey !== 'string' || !ID_RE.test(idempotencyKey)) throw new NonRetryableError('idempotencyKey inválida');
  return { refId, idempotencyKey };
}

export function socialPackageKey(articleId: string, version = 1): string {
  return `${articleId}__social-package__v${version}`;
}

/** jobId determinístico: BullMQ ignora `add()` repetido com o mesmo jobId. BullMQ proíbe ':' em jobId. */
export function socialJobId(idempotencyKey: string): string {
  return `${SOCIAL_QUEUE}__${idempotencyKey}`;
}

export const SOCIAL_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false, // falhas ficam como DLQ lógica até o operador tratar
};

/** Erro que não adianta repetir (payload inválido, gateway bloqueado, matéria inexistente). O worker o converte em UnrecoverableError. */
export class NonRetryableError extends Error {
  readonly retryable = false as const;
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export interface SocialJobDeps {
  dashboard: DashboardDeps;
  gateway: ModelGatewayPort;
  now: () => Date;
}

export interface SocialJobResult {
  articleId: string;
  created: string[];
  existing: string[];
  failed: string[];
  /** Custo de modelo desta execução: sempre 0 (tarefas determinísticas). */
  modelCostUsd: 0;
}

/** Identidade técnica do job: pode gerar pacote, não pode pedir publicação (nem simulada). */
const JOB_CALLER: Caller = { id: 'job:social-package', permissions: [PERMISSIONS.read, PERMISSIONS.generate] };

/**
 * Processa um job: confere o gateway (falha fechada), gera os pacotes (idempotente) e devolve o resumo.
 * Não publica nada. Repetir o job com a mesma chave devolve `existing` e não cria duplicatas.
 */
export async function processSocialPackageJob(deps: SocialJobDeps, data: unknown): Promise<SocialJobResult> {
  const payload = parseSocialPayload(data);

  for (const task of SOCIAL_PACKAGE_TASKS) {
    const d = await deps.gateway.decide({
      task,
      dataClasses: ['public'],
      unpublished: true,
      mode: 'simulation',
      now: deps.now(),
    });
    if (d.status !== 'deterministic') {
      const why = d.status === 'blocked' ? d.reason : 'rota com modelo (inesperada)';
      throw new NonRetryableError(`gateway não liberou ${task}: ${why}`);
    }
  }

  const version = Number(/__social-package__v(\d{1,3})$/.exec(payload.idempotencyKey)?.[1] ?? 1);
  const res = await generatePackages(deps.dashboard, JOB_CALLER, {
    articleId: payload.refId,
    channels: [...SOCIAL_PACKAGE_CHANNELS],
    version,
  });
  if (res.status === 404) throw new NonRetryableError(`matéria não encontrada: ${payload.refId}`);
  if (res.status >= 400) throw new NonRetryableError(`geração recusada (${res.status})`);
  const body = res.body as { created: string[]; existing: string[]; failed: string[] };
  return {
    articleId: payload.refId,
    created: body.created,
    existing: body.existing,
    failed: body.failed,
    modelCostUsd: 0,
  };
}

// ---------- BullMQ (estrutural; o módulo `bullmq` é injetado) ----------

export interface QueueLike {
  add(name: string, data: SocialPackagePayload, opts: Record<string, unknown>): Promise<unknown>;
}

/** Enfileira o job de geração de uma matéria. Idempotente por jobId; o payload leva só IDs. */
export async function enqueueSocialPackage(queue: QueueLike, articleId: string, version = 1): Promise<{ jobId: string }> {
  const idempotencyKey = socialPackageKey(articleId, version);
  const payload = parseSocialPayload({ refId: articleId, idempotencyKey });
  const jobId = socialJobId(idempotencyKey);
  await queue.add(SOCIAL_PACKAGE_JOB, payload, { ...SOCIAL_JOB_OPTIONS, jobId });
  return { jobId };
}

export interface BullmqLike {
  Worker: new (
    queueName: string,
    processor: (job: { name: string; data: unknown }) => Promise<unknown>,
    opts: { connection: unknown; concurrency: number },
  ) => unknown;
  UnrecoverableError: new (message: string) => Error;
}

/**
 * Cria o worker da fila `social` com o processador de pacote. `bullmq` e a conexão ioredis vêm de quem tem Redis
 * (apps/workers); aqui nada abre conexão. Erros `NonRetryableError` viram `UnrecoverableError` (sem novas tentativas).
 */
export function createSocialPackageWorker(
  bullmq: BullmqLike,
  connection: unknown,
  deps: SocialJobDeps,
  concurrency = 2,
): unknown {
  return new bullmq.Worker(
    SOCIAL_QUEUE,
    async (job) => {
      if (job.name !== SOCIAL_PACKAGE_JOB) throw new bullmq.UnrecoverableError(`job desconhecido: ${job.name}`);
      try {
        return await processSocialPackageJob(deps, job.data);
      } catch (e) {
        if (e instanceof NonRetryableError) throw new bullmq.UnrecoverableError(e.message);
        throw e;
      }
    },
    { connection, concurrency },
  );
}
