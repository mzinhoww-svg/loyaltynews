// AGENTE FALSO do OpenBot, para o teste de ponta a ponta LOCAL (só testes; entra por `@ln/openbot/testing`).
// Faz exatamente o que o agente real faz, e nada além:
//   pull (assinado, com a via) -> io/input (lê o conteúdo com o lease) -> decide -> io/result (grava o resultado e recebe o
//   resultRef DERIVADO) -> callback (assinado, idempotente, com usage e trace).
// Não chama modelo, rede nem OpenBot: o transporte é injetado (nos testes, as rotas do Backend chamadas em processo). Segredo,
// relógio e ids vêm de quem constrói; nada é lido do ambiente.
import { signBody } from './signing';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from './routes';
import type { LeasedTask } from './types';

export type AgentPath = 'pull' | 'heartbeat' | 'callback' | 'io/input' | 'io/result';
export interface AgentReply {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corpo JSON de resposta, conferido pelos testes
  body: any;
}
/** Transporte injetado: recebe o corpo CRU e os cabeçalhos de assinatura e devolve a resposta. */
export type AgentTransport = (path: AgentPath, raw: string, headers: Record<string, string>) => Promise<AgentReply>;

export interface AgentInput {
  refId: string;
  input: unknown;
  taskClass: string;
  promptVersion: string;
  meta?: { reviewedDraftTaskId?: string; articleId?: string };
}

/** O que o agente decide fazer com uma tarefa. */
export type AgentDecision =
  | { type: 'result'; result: unknown; model: string; outputValid?: boolean }
  | { type: 'limit'; message: string; resumeInMs?: number }
  | { type: 'fail'; error: string; retryable: boolean };

export interface AgentRun {
  taskId: string;
  kind: string;
  account: string;
  attempt: number;
  steps: { path: AgentPath; status: number; code?: string }[];
  decision: AgentDecision['type'] | 'sem_entrada';
  resultRef?: string;
}

type Stage = 'triage' | 'draft' | 'factcheck' | 'review' | 'social_pack' | 'roles';

export interface FakeOpenBotConfig {
  account: 'claude' | 'codex' | 'opencode' | 'antigravity';
  workerId: string;
  secret: string;
  transport: AgentTransport;
  /** Relógio (ms) usado no carimbo da assinatura e nos horários da trilha. */
  now: () => number;
  decide: (t: LeasedTask, input: AgentInput) => AgentDecision | Promise<AgentDecision>;
}

const LANE_OF = { claude: 'subscription', codex: 'subscription', opencode: 'opencode', antigravity: 'antigravity' } as const;
const STAGE_OF_KIND: Record<string, Stage> = {
  classification: 'triage', editorial_draft: 'draft', fact_check: 'factcheck', editorial_review: 'review', social_copy: 'social_pack', entity_resolution: 'roles',
};

export class FakeOpenBot {
  readonly runs: AgentRun[] = [];
  /** Todas as respostas recebidas, na ordem (para o teste conferir que nada vazou). */
  readonly replies: AgentReply[] = [];
  private n = 0;
  constructor(private readonly c: FakeOpenBotConfig) {}

  /** Chamada assinada (a mesma assinatura do agente real). `secret`, `ts` e `raw` podem ser trocados para os casos de recusa. */
  async call(path: AgentPath, body: unknown, over: { secret?: string | null; ts?: number; raw?: string } = {}): Promise<AgentReply> {
    const raw = over.raw ?? JSON.stringify(body);
    const ts = over.ts ?? this.c.now();
    const headers: Record<string, string> = {};
    if (over.secret !== null) {
      headers[TIMESTAMP_HEADER] = String(ts);
      headers[SIGNATURE_HEADER] = signBody(over.secret ?? this.c.secret, ts, raw);
    }
    const r = await this.c.transport(path, raw, headers);
    this.replies.push(r);
    return r;
  }

  pull(limit = 5): Promise<AgentReply> {
    return this.call('pull', { workerId: this.c.workerId, account: this.c.account, limit });
  }

  /** Um ciclo do agente: puxa e executa tudo o que veio. Se o pull for recusado, devolve só o registro da recusa. */
  async tick(limit = 5): Promise<AgentRun[]> {
    const p = await this.pull(limit);
    if (p.status !== 200) {
      const refused: AgentRun = {
        taskId: '-', kind: '-', account: this.c.account, attempt: 0, decision: 'sem_entrada',
        steps: [{ path: 'pull', status: p.status, ...(p.body?.error?.code ? { code: p.body.error.code as string } : {}) }],
      };
      this.runs.push(refused);
      return [refused];
    }
    const out: AgentRun[] = [];
    for (const t of p.body.tasks as LeasedTask[]) out.push(await this.run(t));
    return out;
  }

  /** Executa UMA tarefa já entregue. */
  async run(t: LeasedTask): Promise<AgentRun> {
    const run: AgentRun = { taskId: t.id, kind: t.kind, account: this.c.account, attempt: t.attempt, steps: [], decision: 'sem_entrada' };
    this.runs.push(run);
    const step = (path: AgentPath, r: AgentReply) => {
      const code = r.body?.error?.code as string | undefined;
      run.steps.push({ path, status: r.status, ...(code ? { code } : {}) });
    };
    const startedAt = new Date(this.c.now()).toISOString();
    const lease = { taskId: t.id, leaseId: t.leaseId };

    const inp = await this.call('io/input', lease);
    step('io/input', inp);
    if (inp.status !== 200) return run;
    const input = inp.body.data as AgentInput;

    const d = await this.c.decide(t, input);
    run.decision = d.type;
    const stage = STAGE_OF_KIND[t.kind] ?? 'triage';
    const packetChars = JSON.stringify(input.input ?? null).length;
    const reviewed = input.meta?.reviewedDraftTaskId;
    const articleId = input.meta?.articleId;
    const trace = (extra: Record<string, unknown> = {}) => ({
      stage, account: this.c.account, startedAt, endedAt: new Date(this.c.now()).toISOString(), packetChars,
      ...(input.promptVersion ? { promptVersion: input.promptVersion } : {}), ...(reviewed ? { reviewedDraftTaskId: reviewed } : {}), ...(articleId ? { articleId } : {}), ...extra,
    });
    const callbackId = `cb-${t.id}-a${t.attempt}-${++this.n}`;

    if (d.type === 'result') {
      const w = await this.call('io/result', { ...lease, result: d.result });
      step('io/result', w);
      if (w.status !== 200) return run;
      run.resultRef = w.body.data.resultRef as string;
      const cb = await this.call('callback', {
        callbackId, ...lease, outcome: 'completed', resultRef: run.resultRef,
        usage: { executionId: `ex-${t.id}-a${t.attempt}`, ...lease, model: d.model, lane: LANE_OF[this.c.account], account: this.c.account, costMicro: 0 },
        trace: trace({ outputValid: d.outputValid ?? true }),
      });
      step('callback', cb);
      return run;
    }
    if (d.type === 'limit') {
      const at = new Date(this.c.now()).toISOString();
      const cb = await this.call('callback', {
        callbackId, ...lease, outcome: 'failed', retryable: true, error: 'limite',
        trace: trace({ limit: { message: d.message, at, ...(d.resumeInMs ? { resumeAt: new Date(this.c.now() + d.resumeInMs).toISOString() } : {}) } }),
      });
      step('callback', cb);
      return run;
    }
    const cb = await this.call('callback', { callbackId, ...lease, outcome: 'failed', retryable: d.retryable, error: d.error, trace: trace({ outputValid: false }) });
    step('callback', cb);
    return run;
  }
}
