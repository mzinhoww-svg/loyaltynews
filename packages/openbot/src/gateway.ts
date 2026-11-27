import { createHash } from 'node:crypto';
import { dispatchTask, effectiveRoute, type Caller, type OpenBotDeps } from './handlers';
import { ID_RE, providerOfModel, PROVIDER_OF_ACCOUNT, type Account, type Task } from './types';

// Gateway SÍNCRONO sobre o adaptador OpenBot. A Fábrica editorial chama `ModelGateway.invoke` e espera a resposta; este
// gateway despacha a tarefa (por pull com lease), espera o callback com tempo-limite e devolve o resultado. No tempo-limite a
// tarefa FICA na fila (não é cancelada, nem desviada para a API): uma nova chamada com a mesma `idempotencyKey` retoma a
// espera da mesma tarefa. As formas de entrada e saída espelham `GatewayRequest`/`GatewayResponse` de @ln/editorial (estrutural,
// sem importar o pacote; a conferência de tipos é feita no teste).

export type GatewayTaskClass = 'triage' | 'context' | 'draft' | 'factcheck' | 'review' | 'social_pack' | 'roles';

export interface GatewayRequestLike {
  taskClass: GatewayTaskClass;
  route: string;
  workflow: string;
  idempotencyKey: string;
  promptVersion: string;
  dataClass: 'public';
  /** Provedores que NÃO podem atender (checagem independente do redator). */
  excludeProviders: string[];
  input: unknown;
}

export type GatewayRefusal =
  | 'budget_exhausted' | 'budget_step_blocked' | 'kill_switch' | 'unknown_rate' | 'model_disabled' | 'no_independent_provider' | 'restricted_data';

export type GatewayResponseLike =
  | {
    ok: true; provider: string; model: string; output: unknown; usage: { inputTokens: number; outputTokens: number; costMicrosUsd: number };
    /** Tarefa e tentativa que concluíram: a Editorial usa `taskId` como `reviewedDraftTaskId` e (taskId, attempt) para achar a linha do piloto. */
    taskId: string; attempt: number;
  }
  | { ok: false; refusal: GatewayRefusal; detail?: string; /** a tarefa, quando já existe (ex.: `pending_timeout`: repetir a chamada retoma a mesma). */ taskId?: string };

/** Tipo de tarefa do adaptador que carrega cada classe da Fábrica. */
export const KIND_OF_CLASS: Record<GatewayTaskClass, string> = {
  triage: 'classification',
  context: 'classification',
  draft: 'editorial_draft',
  factcheck: 'fact_check',
  review: 'editorial_review',
  social_pack: 'social_copy',
  roles: 'entity_resolution',
};

/** Armazém do CONTEÚDO (o fio e a fila só levam IDs): o agente lê a entrada por `refId` e grava o resultado sob `resultRef`. */
export interface TaskIo {
  /**
   * Chamado pela Fábrica, no mesmo processo, a CADA `invoke` (inclusive ao retomar a espera). Tem de ser idempotente: mesmo `refId`
   * com o mesmo conteúdo não faz nada; com conteúdo DIFERENTE lança `InputConflict` (a entrada de uma tarefa em andamento não muda).
   */
  putInput(refId: string, input: unknown, meta: TaskInputMeta): Promise<void>;
  getResult(resultRef: string): Promise<unknown | null>;
}

export interface TaskInputMeta {
  taskClass: GatewayTaskClass;
  /** Etapa declarada no despacho (a mesma classe; a linha do piloto usa `--stage` e precisa dela, ex.: `context`). */
  stage?: string;
  promptVersion: string;
  /** Id da tarefa do rascunho que esta checagem/revisão recebe (prova de independência). Lido de `input.reviewedDraftTaskId`, se houver. */
  reviewedDraftTaskId?: string;
  /** Id da matéria (da chave de idempotência `<articleId>:<etapa>:<tentativa>` ou de `input.articleId`): agrupa as etapas na planilha do piloto. */
  articleId?: string;
}

/** O armazém recusou: já existe entrada com este refId e conteúdo diferente. */
export class InputConflict extends Error {
  constructor(refId: string) {
    super(`entrada divergente para ${refId}`);
    this.name = 'InputConflict';
  }
}

export interface OpenBotGatewayConfig {
  deps: OpenBotDeps;
  /** Identidade com permissão `openbot:dispatch` (a do serviço de Fábrica, não a de um agente). */
  caller: Caller;
  io: TaskIo;
  /** Perfil (dos 64) que executa cada classe. */
  profiles: Record<GatewayTaskClass, string>;
  /** Teto de custo por tarefa, micro-USD. Em faixas gratuitas o custo real é 0; o teto limita o caso de erro. */
  maxCostMicro?: number;
  /** Espera máxima pelo callback. Padrão 120 s. */
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}

/** Id da matéria: a Editorial usa a chave `<articleId>:<classe>:<tentativa>`; senão `input.articleId`. Só vale no formato de id. */
export function articleIdOf(req: Pick<GatewayRequestLike, 'idempotencyKey' | 'input' | 'taskClass'>): string | undefined {
  const m = /^(.+):(triage|context|draft|factcheck|review|social_pack|roles):\d+$/.exec(req.idempotencyKey);
  const fromKey = m?.[1];
  if (fromKey && ID_RE.test(fromKey)) return fromKey;
  const fromInput = (req.input as { articleId?: unknown } | null)?.articleId;
  return typeof fromInput === 'string' && ID_RE.test(fromInput) ? fromInput : undefined;
}

const hex = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);

export class OpenBotModelGateway {
  private readonly c: OpenBotGatewayConfig;

  constructor(config: OpenBotGatewayConfig) {
    this.c = config;
  }

  async invoke(req: GatewayRequestLike): Promise<GatewayResponseLike> {
    const c = this.c;
    const kind = KIND_OF_CLASS[req.taskClass];
    if (!kind) return { ok: false, refusal: 'model_disabled', detail: `classe desconhecida: ${String(req.taskClass)}` };
    if (req.dataClass !== 'public') return { ok: false, refusal: 'restricted_data', detail: 'só dado público vai ao OpenBot' };

    // Independência: tira da rota as vias cujo provedor é conhecido e proibido. Via de provedor incerto (antigravity) fica e é
    // conferida DEPOIS, pelo modelo declarado no custo.
    const excluded = new Set(req.excludeProviders);
    const full = effectiveRoute(c.deps, kind); // no piloto, já sem as contas fora da DP-41
    const route = full.filter((a) => a === 'antigravity' || !excluded.has(PROVIDER_OF_ACCOUNT[a]));
    if (route.length === 0) return { ok: false, refusal: 'no_independent_provider', detail: `nenhuma via de ${kind} fora de ${[...excluded].join(', ')}` };

    // Despacho desligado ou parado: nada vai ao armazém (nenhuma entrada órfã) e nenhuma tarefa é criada.
    const fl = c.deps.flags();
    if (fl.kill) return { ok: false, refusal: 'kill_switch', detail: 'KILL_SWITCH' };
    if (!fl.dispatchEnabled) return { ok: false, refusal: 'model_disabled', detail: 'DISPATCH_OFF' };

    const key = `gw-${hex(req.idempotencyKey)}`;
    const reviewed = (req.input as { reviewedDraftTaskId?: unknown } | null)?.reviewedDraftTaskId;
    const articleId = articleIdOf(req);
    try {
      await c.io.putInput(key, req.input, {
        taskClass: req.taskClass,
        stage: req.taskClass,
        promptVersion: req.promptVersion,
        ...(typeof reviewed === 'string' && ID_RE.test(reviewed) ? { reviewedDraftTaskId: reviewed } : {}),
        ...(articleId ? { articleId } : {}),
      });
    } catch (e) {
      if (e instanceof InputConflict) return { ok: false, refusal: 'model_disabled', detail: 'input_divergente: a entrada desta chave já foi gravada com outro conteúdo' };
      return { ok: false, refusal: 'model_disabled', detail: 'armazem_de_conteudo_indisponivel' };
    }
    const d = await dispatchTask(c.deps, c.caller, {
      kind, profileId: c.profiles[req.taskClass], refId: key, idempotencyKey: key, dataClass: 'public', maxCostMicro: c.maxCostMicro ?? 1_000_000, route,
    });
    if (d.status >= 400) return refusalOf(d);
    const taskId = (d.body as { task: { id: string } }).task.id;

    const sleep = c.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const clock = c.clock ?? (() => Date.now());
    const deadline = clock() + (c.timeoutMs ?? 120_000);
    for (;;) {
      const t = await c.deps.queue.get(taskId);
      if (!t) return { ok: false, refusal: 'model_disabled', detail: `tarefa ${taskId} sumiu da fila` };
      if (t.status === 'completed') {
        // O callback conclui a tarefa e SÓ DEPOIS grava o custo e a linha do piloto (etapas separadas, às vezes em outro processo): espera por
        // eles até o prazo antes de responder, para o chamador achar a linha (patch do veredito) e o custo (modelo declarado).
        const r = await this.result(t, excluded, clock() >= deadline);
        if (r !== 'not_ready') return r;
      } else if (t.status === 'failed' || t.status === 'dead') {
        return { ok: false, refusal: 'model_disabled', detail: `falha: ${t.status}${t.lastError ? ` (${t.lastError})` : ''}`, taskId };
      } else if (clock() >= deadline) {
        // Fica pending: nada de API, nada de cancelamento. Repetir a chamada com a mesma chave retoma a espera.
        return { ok: false, refusal: 'model_disabled', detail: `pending_timeout: tarefa ${taskId} segue na fila (${t.status}, via ${t.route[t.routeIndex] ?? '?'})`, taskId };
      }
      await sleep(c.pollMs ?? 250);
    }
  }

  /** `not_ready`: a tarefa já concluiu mas o custo (ou a linha do piloto) ainda não foi gravado; só devolve isso antes do prazo (`final`). */
  private async result(t: Task, excluded: Set<string>, final: boolean): Promise<GatewayResponseLike | 'not_ready'> {
    const c = this.c;
    const taskId = t.id;
    const resultRef = t.resultRef;
    if (!resultRef) return { ok: false, refusal: 'model_disabled', detail: 'tarefa concluída sem resultRef', taskId };
    // o relato da execução que CONCLUIU (mesmo lease); com troca de via pode haver relatos de tentativas anteriores
    const mine = (await c.deps.ledger.entries()).filter((e) => e.taskId === taskId);
    const entry = mine.find((e) => e.leaseId === t.leaseId) ?? mine[mine.length - 1];
    if (!entry) return final ? { ok: false, refusal: 'unknown_rate', detail: 'tarefa concluída sem relato de custo', taskId } : 'not_ready';
    const pilot = c.deps.pilot;
    if (pilot?.enabled && !final && !(await pilot.rows.all()).some((r) => r.task_id === taskId && r.attempt === t.attempts)) return 'not_ready';
    const account = (entry.account ?? 'claude') as Account;
    const provider = providerOfModel(entry.model, account);
    if (excluded.has(provider)) {
      return { ok: false, refusal: 'no_independent_provider', detail: `o modelo declarado (${entry.model}) é do provedor ${provider}, que está excluído`, taskId };
    }
    const output = await c.io.getResult(resultRef);
    if (output === null || output === undefined) return { ok: false, refusal: 'model_disabled', detail: 'resultado não encontrado', taskId };
    return {
      ok: true, provider, model: entry.model, output, taskId, attempt: t.attempts,
      usage: { inputTokens: entry.promptTokens ?? 0, outputTokens: entry.completionTokens ?? 0, costMicrosUsd: entry.costMicro },
    };
  }
}

function refusalOf(d: { status: number; body: unknown }): GatewayResponseLike {
  const code = (d.body as { error?: { code?: string; message?: string } })?.error?.code ?? 'ERRO';
  const map: Record<string, GatewayRefusal> = {
    KILL_SWITCH: 'kill_switch', BUDGET_EXHAUSTED: 'budget_exhausted', DATA_CLASS_BLOCKED: 'restricted_data',
  };
  return { ok: false, refusal: map[code] ?? 'model_disabled', detail: `${code}` };
}
