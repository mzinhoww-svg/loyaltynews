import { createHash } from 'node:crypto';
import { dispatchTask, routeFor, type Caller, type OpenBotDeps } from './handlers';
import { ID_RE, providerOfModel, PROVIDER_OF_ACCOUNT, type Account } from './types';

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
  | { ok: true; provider: string; model: string; output: unknown; usage: { inputTokens: number; outputTokens: number; costMicrosUsd: number } }
  | { ok: false; refusal: GatewayRefusal; detail?: string };

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
  promptVersion: string;
  /** Id da tarefa do rascunho que esta checagem/revisão recebe (prova de independência). Lido de `input.reviewedDraftTaskId`, se houver. */
  reviewedDraftTaskId?: string;
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
    const full = routeFor(c.deps, kind);
    const route = full.filter((a) => a === 'antigravity' || !excluded.has(PROVIDER_OF_ACCOUNT[a]));
    if (route.length === 0) return { ok: false, refusal: 'no_independent_provider', detail: `nenhuma via de ${kind} fora de ${[...excluded].join(', ')}` };

    // Despacho desligado ou parado: nada vai ao armazém (nenhuma entrada órfã) e nenhuma tarefa é criada.
    const fl = c.deps.flags();
    if (fl.kill) return { ok: false, refusal: 'kill_switch', detail: 'KILL_SWITCH' };
    if (!fl.dispatchEnabled) return { ok: false, refusal: 'model_disabled', detail: 'DISPATCH_OFF' };

    const key = `gw-${hex(req.idempotencyKey)}`;
    const reviewed = (req.input as { reviewedDraftTaskId?: unknown } | null)?.reviewedDraftTaskId;
    try {
      await c.io.putInput(key, req.input, {
        taskClass: req.taskClass,
        promptVersion: req.promptVersion,
        ...(typeof reviewed === 'string' && ID_RE.test(reviewed) ? { reviewedDraftTaskId: reviewed } : {}),
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
      if (t.status === 'completed') return this.result(taskId, t.resultRef, excluded);
      if (t.status === 'failed' || t.status === 'dead') {
        return { ok: false, refusal: 'model_disabled', detail: `falha: ${t.status}${t.lastError ? ` (${t.lastError})` : ''}` };
      }
      if (clock() >= deadline) {
        // Fica pending: nada de API, nada de cancelamento. Repetir a chamada com a mesma chave retoma a espera.
        return { ok: false, refusal: 'model_disabled', detail: `pending_timeout: tarefa ${taskId} segue na fila (${t.status}, via ${t.route[t.routeIndex] ?? '?'})` };
      }
      await sleep(c.pollMs ?? 250);
    }
  }

  private async result(taskId: string, resultRef: string | undefined, excluded: Set<string>): Promise<GatewayResponseLike> {
    const c = this.c;
    if (!resultRef) return { ok: false, refusal: 'model_disabled', detail: 'tarefa concluída sem resultRef' };
    const entry = (await c.deps.ledger.entries()).find((e) => e.taskId === taskId);
    if (!entry) return { ok: false, refusal: 'unknown_rate', detail: 'tarefa concluída sem relato de custo' };
    const account = (entry.account ?? 'claude') as Account;
    const provider = providerOfModel(entry.model, account);
    if (excluded.has(provider)) {
      return { ok: false, refusal: 'no_independent_provider', detail: `o modelo declarado (${entry.model}) é do provedor ${provider}, que está excluído` };
    }
    const output = await c.io.getResult(resultRef);
    if (output === null || output === undefined) return { ok: false, refusal: 'model_disabled', detail: 'resultado não encontrado' };
    return {
      ok: true, provider, model: entry.model, output,
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
