// FIAÇÃO do piloto de 10 matérias pelo OpenBot (DP-41, SÓ staging) para a Fábrica editorial: monta o `OpenBotModelGateway` sobre as MESMAS tabelas das rotas
// `/api/openbot` (fila com lease, custos, saúde, dedupe, conteúdo, linhas e parada do piloto) e o sink que grava o veredito da Editorial na linha do piloto.
// A Fábrica (`loadPilotWiring` em editorial-factory.ts) chama `createPilotWiring(env)`; como o `main` da Fábrica é empacotado (esbuild), o módulo
// vai por um importador estático: `loadPilotWiring(process.env, pilotWiringImporter(db))` (nada de `import()` com nome em variável).
// FALHA FECHADA: sem staging, sem `LN_OPENBOT_PILOT=1`, sem `openbotDispatch` ligada (DP-41), ou sem o gate e o `applyRowPatch` do AgentOps
// (`@ln/agents`), lança e o job recusa começar. Nunca chama modelo, rede nem OpenBot: só enfileira tarefas e espera o callback do agente.
// Não lê nem grava segredo: o HMAC é das ROTAS (o agente do OpenBot assina); o gateway fala com o PostgreSQL.
import type { Db } from '@ln/auth';
import { resolveFlags } from '@ln/contracts';
import { PostgresLedgerStore, type SqlDatabase } from '@ln/modelops';
import {
  openbotFlagsFrom, OPENBOT_PERMISSIONS, OpenBotModelGateway, type GatewayTaskClass, type OpenBotDeps, type OpenBotFlags, type PilotGate, type PilotVerdictStreak,
} from '@ln/openbot';
import { PgCallbackStore, PgCostLedger, PgHealthStore, PgLeaseQueue, PgPilotRowStore, PgPilotStateStore, PgTaskIo } from './openbot-pg';

/** Perfil (dos agentes do piloto, rascunhos do AgentOps) que executa cada classe da Fábrica. `context` é a triagem; `roles` é do agente social. */
export const PILOT_PROFILES: Record<GatewayTaskClass, string> = {
  triage: 'ln_pilot_pauta',
  context: 'ln_pilot_pauta',
  draft: 'ln_pilot_redator',
  factcheck: 'ln_pilot_checador',
  review: 'ln_pilot_revisor',
  social_pack: 'ln_pilot_social',
  roles: 'ln_pilot_social',
};

/** Igual a `PilotRowSink` da Editorial (estrutural): o veredito e o `output_valid` entram na linha DEPOIS do gate. */
export interface PilotRowSinkLike {
  patch(p: { taskId: string; attempt: number; stage: string; patch: Record<string, unknown> }): Promise<void>;
}

export interface PilotWiring {
  /** Só o `invoke` (o `ModelGateway` da Editorial). */
  gateway: Pick<OpenBotModelGateway, 'invoke'>;
  sink: PilotRowSinkLike;
}

type ApplyRowPatch = (row: never, patch: Record<string, unknown>) => { row: unknown; errors: string[] };
interface AgentsKit {
  canDispatchNext: PilotGate;
  /** Critério 3 de parada do PM (2 falhas seguidas do patch do veredito): sem ele o piloto não despacha. */
  verdictStreakReasons: PilotVerdictStreak;
  applyRowPatch: ApplyRowPatch;
}

/** Gate e `applyRowPatch` do AgentOps. Sem eles o piloto não existe (falha fechada, com o motivo). Injetável nos testes. */
export type LoadAgentsKit = () => Promise<Partial<AgentsKit> | null>;
const loadAgentsKit: LoadAgentsKit = async () => {
  try {
    return (await import('@ln/agents')) as unknown as Partial<AgentsKit>;
  } catch {
    return null;
  }
};

export interface PilotWiringOptions {
  loadKit?: LoadAgentsKit;
  now?: () => Date;
  /** Espera real entre as consultas do gateway (testes injetam). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Monta o gateway e o sink do piloto. `db` é o mesmo banco das rotas. Lança (e o job recusa começar) se qualquer condição da DP-41 faltar.
 * Variáveis: `LN_OPENBOT_GATEWAY_TIMEOUT_MS` (espera por tarefa; padrão 10 min; no prazo a tarefa FICA na fila e repetir a chamada a retoma).
 */
export async function createPilotWiring(env: Record<string, string | undefined>, db: Db, opts: PilotWiringOptions = {}): Promise<PilotWiring> {
  if (env['APP_ENV'] !== 'staging' || env['LN_OPENBOT_PILOT'] !== '1') throw new Error('o piloto pelo OpenBot só existe com APP_ENV=staging e LN_OPENBOT_PILOT=1 (DP-41)');
  const dispatchOn = resolveFlags(env).state.openbotDispatch === true; // staging + LN_FLAGS_ON=openbotDispatch (decisão DP-41); produção recusa a subida
  if (!dispatchOn) throw new Error('openbotDispatch está desligada (LN_FLAGS_ON=openbotDispatch em staging, DP-41): o piloto não despacha');
  const kit = await (opts.loadKit ?? loadAgentsKit)();
  if (typeof kit?.canDispatchNext !== 'function' || typeof kit.applyRowPatch !== 'function' || typeof kit.verdictStreakReasons !== 'function') {
    throw new Error('@ln/agents sem canDispatchNext/applyRowPatch/verdictStreakReasons neste build (integrar a ft/agents, ab7bba3 ou posterior): o piloto não despacha');
  }
  const now = opts.now ?? (() => new Date());
  const rows = new PgPilotRowStore(db, now);
  const state = new PgPilotStateStore(db);
  const store = new PostgresLedgerStore(db as unknown as SqlDatabase);

  // A parada (kill switch global ou da rota `openbot`) vive no banco; `flags()` é síncrona, então o valor é relido antes de cada chamada e a cada espera.
  let kill = false;
  const refreshKill = async () => {
    const k = await store.readKill();
    kill = k.global === true || k.routes.includes('openbot');
  };
  const flags = (): OpenBotFlags => openbotFlagsFrom({ overrides: { openbotDispatch: true }, kill });

  const deps: OpenBotDeps = {
    queue: new PgLeaseQueue(db), ledger: new PgCostLedger(db, now), health: new PgHealthStore(db), callbacks: new PgCallbackStore(db),
    secrets: () => [], // o gateway não verifica assinatura (as rotas verificam)
    flags, now, requireDerivedResultRef: true,
    pilot: { enabled: true, rows, state, gate: kit.canDispatchNext, verdictStreak: kit.verdictStreakReasons },
  };
  const timeoutMs = Number(env['LN_OPENBOT_GATEWAY_TIMEOUT_MS']) > 0 ? Number(env['LN_OPENBOT_GATEWAY_TIMEOUT_MS']) : 10 * 60_000;
  const wait = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const inner = new OpenBotModelGateway({
    deps, io: new PgTaskIo(db, now), caller: { id: 'fabrica-editorial', permissions: [OPENBOT_PERMISSIONS.dispatch] }, profiles: PILOT_PROFILES,
    timeoutMs, pollMs: 2000, sleep: async (ms) => { await wait(ms); await refreshKill(); },
  });
  // o `ModelGateway` da Editorial (`invoke`), com a parada relida antes de cada chamada
  const gateway: PilotWiring['gateway'] = {
    invoke: async (req) => {
      await refreshKill();
      return inner.invoke(req);
    },
  };

  const apply = kit.applyRowPatch;
  const sink: PilotRowSinkLike = {
    async patch({ taskId, attempt, patch }) {
      const row = (await rows.all()).find((r) => r.task_id === taskId && r.attempt === attempt);
      if (!row) throw new Error(`linha do piloto inexistente: ${taskId}#${attempt}`);
      const r = apply(row as never, patch); // o AgentOps recusa campo de medição do adaptador e linha contraditória
      if (r.errors.length) throw new Error(`patch recusado: ${r.errors.join('; ')}`);
      if (!(await rows.patch(taskId, attempt, patch))) throw new Error(`linha do piloto sumiu: ${taskId}#${attempt}`);
    },
  };
  return { gateway, sink };
}

/**
 * Importador estático para `loadPilotWiring(env, importer)` da Fábrica: devolve o módulo com `createPilotWiring(env)` já preso ao `db` da execução
 * (o `main` é empacotado; `import()` com nome em variável não resolveria o pacote).
 */
export function pilotWiringImporter(db: Db, opts: PilotWiringOptions = {}): (spec: string) => Promise<Record<string, unknown>> {
  return async () => ({ createPilotWiring: (env: Record<string, string | undefined>) => createPilotWiring(env, db, opts) });
}
