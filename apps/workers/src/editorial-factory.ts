// Composição da Fábrica editorial para o staging (Frente 06): PostgreSQL (PgEditorialStore) + coletor com fetcher real
// (DNS fixado, anti-SSRF) + gateway de modelos (@ln/modelops: roteamento, orçamento e provedor) por trás da porta do Editorial.
// Tudo atrás de flags DESLIGADAS por padrão. Sem chamada de modelo real enquanto `modelosHabilitados` estiver desligada
// (cliente SIMULADO: o texto "SIMULADO" nunca vira matéria — o estágio recusa como invalid_model_output).
import type { Db } from '@ln/auth';
import { FLAG_DEFAULTS, type FlagState } from '@ln/contracts';
import {
  Collector, type ReaderPort, StoreReadBudget, InMemoryAuditLog, SEED_SOURCES, SourceRegistry, createLlmGateway, createNodeFetcher, runFactory, systemResolver,
  type ChatRequest, type ChatResult, type ChatTransport, type FactoryOptions, type FactoryReport, type RefusalCode, type TaskClass,
} from '@ln/editorial';
import { callModel, type GatewayCall, type GatewayDeps } from '@ln/modelops';
import { PgEditorialStore } from './editorial-store';

// ------------------------------------------------------------------------------------------------------------------
// Flags: o dono liga/desliga; aqui só se LÊ uma lista explícita e restrita (nunca ligar por padrão).
export const FACTORY_FLAG_WHITELIST = ['editorialCollector', 'editorialPipeline', 'publicacaoPortal', 'publicacaoAutonoma', 'modelosHabilitados'] as const;
export type FactoryFlagName = (typeof FACTORY_FLAG_WHITELIST)[number];

/** "editorialCollector,editorialPipeline" → overrides. Nome fora da lista é erro (nada de ligar flag por engano). */
export function parseFactoryFlags(csv: string | undefined): Partial<FlagState> {
  const out: Partial<FlagState> = {};
  for (const raw of (csv ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!(FACTORY_FLAG_WHITELIST as readonly string[]).includes(raw)) throw new Error(`flag fora da lista permitida da fábrica: ${raw}`);
    out[raw as FactoryFlagName] = true;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------------
// Transporte do Editorial sobre @ln/modelops (callModel): tarefa do pipeline → tarefa do catálogo do gateway.
const TASK_MAP: Partial<Record<TaskClass, string>> = {
  triage: 'classification', context: 'classification', draft: 'editorial_draft', factcheck: 'fact_check', review: 'editorial_review', roles: 'entity_resolution',
};
/** Trabalho editorial ainda NÃO publicado exige ZDR no processador; cargos saem de matéria já publicada. */
const UNPUBLISHED: ReadonlySet<TaskClass> = new Set(['triage', 'context', 'draft', 'factcheck', 'review']);

export interface ModelopsTransportOptions {
  deps: GatewayDeps;
  mode: 'production' | 'simulation';
  qualifiedModelIds: readonly string[];
  zdrVerifiedModelIds: readonly string[];
  now?: () => Date;
}

const refusalOf = (reason: string, detail: string): { refusal: RefusalCode; detail: string } => {
  if (reason === 'kill_global' || reason === 'kill_route') return { refusal: 'kill_switch', detail };
  if (reason.startsWith('budget') || reason === 'balance_low') return { refusal: /degrau|step|42|40|35/i.test(detail) ? 'budget_step_blocked' : 'budget_exhausted', detail };
  if (reason === 'unknown_class' || reason === 'personal_no_approved_processor' || reason === 'data_class_not_approved') return { refusal: 'restricted_data', detail };
  if (reason === 'draft_author_unknown' || reason === 'response_same_author') return { refusal: 'no_independent_provider', detail };
  return { refusal: 'model_disabled', detail: `${reason}: ${detail}` };
};

export function createModelopsTransport(o: ModelopsTransportOptions): ChatTransport {
  return {
    async chat(req: ChatRequest): Promise<ChatResult> {
      const task = TASK_MAP[req.taskClass];
      // social_pack não tem rota de modelo no catálogo (composição determinística do Growth): recusa explícita, sem improvisar.
      if (!task) return { ok: false, refusal: 'model_disabled', detail: `sem rota de modelo para ${req.taskClass} (composição determinística)` };
      const call: GatewayCall = {
        task, dataClasses: ['public'], unpublished: UNPUBLISHED.has(req.taskClass), mode: o.mode,
        qualifiedModelIds: o.qualifiedModelIds, zdrVerifiedModelIds: o.zdrVerifiedModelIds, now: (o.now ?? (() => new Date()))(),
        // checagem/revisão independentes: o autor do rascunho é o provedor que NÃO pode responder
        ...(req.excludeProviders[0] ? { draftModelId: `${req.excludeProviders[0]}/rascunho` } : {}),
        messages: req.messages,
        estimate: { promptTokens: req.estimate.promptTokens, cacheWriteTokens: 0, cacheReadTokens: 0, maxOutputTokens: req.estimate.maxOutputTokens, uncertain: true },
      };
      const out = await callModel(o.deps, call);
      if (out.status === 'deterministic') return { ok: false, refusal: 'model_disabled', detail: 'tarefa determinística: não passa por modelo' };
      if (out.status === 'blocked') return { ok: false, ...refusalOf(out.reason, out.detail) };
      const text = out.response.choices?.[0]?.message?.content ?? '';
      return {
        ok: true, provider: out.model.split('/')[0] ?? out.model, model: out.model, text,
        usage: { inputTokens: out.response.usage?.prompt_tokens ?? 0, outputTokens: out.response.usage?.completion_tokens ?? 0, costMicrosUsd: Math.round(out.costUsd * 1_000_000) },
      };
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------
export interface RunEditorialFactoryInput {
  db: Db;
  /** Overrides de flags (lista restrita: ver parseFactoryFlags). Sem nada = tudo desligado. */
  flags?: Partial<FlagState>;
  /** Padrão TRUE: só coleta e relata (sem modelo, sem gravar matéria). */
  dryRun?: boolean;
  options?: Omit<FactoryOptions, 'dryRun'>;
  /** Deps do gateway de modelos (política, orçamento, cliente). Obrigatório fora do dry-run. */
  gateway?: ModelopsTransportOptions;
  /** Orçamento persistido em PostgreSQL? Sem isso, `modelosHabilitados` é recusada (o teto de US$ 50/mês não sobreviveria a um restart). */
  persistentLedger?: boolean;
  registry?: SourceRegistry;
  collector?: Collector;
  /** DP-31: serviço de leitura (ex.: TavilyReader) para as fontes com acesso 'risco-aceito-dp31'. Ausente = essas fontes são puladas. */
  reader?: ReaderPort;
  now?: () => Date;
}

export async function runEditorialFactory(i: RunEditorialFactoryInput): Promise<FactoryReport> {
  const flags: FlagState = { ...FLAG_DEFAULTS, ...(i.flags ?? {}) };
  const dryRun = i.dryRun !== false;
  if (!dryRun && flags.modelosHabilitados && !i.persistentLedger) {
    throw new Error('modelosHabilitados exige ledger de orçamento persistente (PostgreSQL); recusado para não perder o teto mensal em um restart');
  }
  if (!dryRun && !i.gateway) throw new Error('fora do dry-run é preciso informar o gateway de modelos');
  const store = new PgEditorialStore(i.db);
  const registry = i.registry ?? new SourceRegistry(SEED_SOURCES);
  const now = i.now ?? (() => new Date());
  const collector = i.collector ?? new Collector(createNodeFetcher(), { now, resolver: systemResolver, flags, readBudget: new StoreReadBudget(store), ...(i.reader ? { reader: i.reader } : {}) });
  const llm: ChatTransport = i.gateway ? createModelopsTransport(i.gateway) : { chat: async () => ({ ok: false, refusal: 'model_disabled', detail: 'dry-run: sem modelo' }) };
  return runFactory({ store, registry, collector, gateway: createLlmGateway(llm), audit: new InMemoryAuditLog(), flags, now }, { ...(i.options ?? {}), dryRun });
}
