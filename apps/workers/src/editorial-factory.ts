// Composição da Fábrica editorial para o staging (Frente 06): PostgreSQL (PgEditorialStore) + coletor com fetcher real
// (DNS fixado, anti-SSRF) + gateway de modelos (@ln/modelops: roteamento, orçamento e provedor) por trás da porta do Editorial.
// Tudo atrás de flags DESLIGADAS por padrão. Sem chamada de modelo real enquanto `modelosHabilitados` estiver desligada
// (cliente SIMULADO: o texto "SIMULADO" nunca vira matéria — o estágio recusa como invalid_model_output).
import type { Db } from '@ln/auth';
import { FLAG_DEFAULTS, type FlagState } from '@ln/contracts';
import {
  Collector, type CollectorOptions, type Fetcher, type Resolver, type ReaderPort, type ShadowPort, StoreReadBudget, shadowReader, shadowObserver, drainShadow, InMemoryAuditLog, runAutoralQueue, type AutoralQueueReport, SEED_SOURCES, SourceRegistry, createLlmGateway, createNodeFetcher, runFactory, systemResolver,
  type ChatRequest, type ChatResult, type ChatTransport, type FactoryOptions, type FactoryReport, type ModelGateway, type RefusalCode, type TaskClass,
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
  /**
   * Gateway do OpenBot (DP-41): em vez do gateway de modelos (OpenRouter), as tarefas vão às contas de assinatura pelo adaptador (`OpenBotModelGateway` de
   * `@ln/openbot`, montado pelo chamador com os stores PostgreSQL, o TaskIo e o gate do piloto). Exclusivo com `gateway`. Os custos do OpenBot são gravados em
   * `openbot_cost_entries` (PostgreSQL), então a exigência de ledger persistente está atendida. O gateway recusa sozinho com despacho desligado (`openbotDispatch`),
   * kill switch ou piloto parado; este arquivo não liga flag nenhuma nem cria o gateway.
   */
  openbotGateway?: ModelGateway;
  /** Orçamento persistido em PostgreSQL? Sem isso, `modelosHabilitados` é recusada (o teto de US$ 50/mês não sobreviveria a um restart). */
  persistentLedger?: boolean;
  registry?: SourceRegistry;
  collector?: Collector;
  /** DP-31: serviço de leitura (ex.: TavilyReader) para as fontes com acesso 'via-provedor'. Ausente = essas fontes são puladas. */
  reader?: ReaderPort;
  /** Shadow ao vivo do roteador de scraping (só mede; ligado só no staging com SCRAPING_SHADOW_MODE=true). Ausente = nenhum efeito. */
  shadow?: ShadowPort;
  /** Rede e resolução de DNS do coletor padrão (testes injetam simulados; padrão: rede real com anti-SSRF). Ignorados se `collector` for informado. */
  fetcher?: Fetcher;
  resolver?: Resolver;
  /** Opções do coletor padrão (ex.: ritmo). Só para testes/operação; o padrão mantém 3 s por host. */
  collectorOptions?: Partial<CollectorOptions>;
  now?: () => Date;
}

export async function runEditorialFactory(i: RunEditorialFactoryInput): Promise<FactoryReport> {
  const flags: FlagState = { ...FLAG_DEFAULTS, ...(i.flags ?? {}) };
  const dryRun = i.dryRun !== false;
  if (i.openbotGateway && i.gateway) throw new Error('openbotGateway e gateway de modelos são exclusivos: escolha um');
  if (!dryRun && flags.modelosHabilitados && !i.persistentLedger && !i.openbotGateway) {
    throw new Error('modelosHabilitados exige ledger de orçamento persistente (PostgreSQL); recusado para não perder o teto mensal em um restart');
  }
  if (!dryRun && !i.gateway && !i.openbotGateway) throw new Error('fora do dry-run é preciso informar o gateway de modelos (gateway) ou o do OpenBot (openbotGateway)');
  const store = new PgEditorialStore(i.db);
  const registry = i.registry ?? new SourceRegistry(SEED_SOURCES);
  const now = i.now ?? (() => new Date());
  const reader = shadowReader(i.reader, i.shadow);
  const observer = shadowObserver(i.shadow);
  const collector = i.collector ?? new Collector(i.fetcher ?? createNodeFetcher(), { now, resolver: i.resolver ?? systemResolver, flags, readBudget: new StoreReadBudget(store), ...(reader ? { reader } : {}), ...(observer ? { onDirectRead: observer } : {}), ...(i.collectorOptions ?? {}) });
  const llm: ChatTransport = i.gateway ? createModelopsTransport(i.gateway) : { chat: async () => ({ ok: false, refusal: 'model_disabled', detail: 'dry-run: sem modelo' }) };
  try {
    return await runFactory({ store, registry, collector, gateway: i.openbotGateway ?? createLlmGateway(llm), audit: new InMemoryAuditLog(), flags, now }, { ...(i.options ?? {}), dryRun });
  } finally {
    await drainShadow(i.shadow); // o job só termina quando a fila da sombra termina
  }
}

/**
 * Pauta autoral (DP-29): processa as pautas PENDENTES registradas por POST /api/studio/editorial/pautas. Mesmas flags, gateway, coletor
 * e leitor da fábrica; termina cada matéria em 'aprovado' ou 'bloqueado' (sem recibo, sem publicação). Fora do dry-run exige gateway.
 */
export async function runEditorialAutoral(i: Omit<RunEditorialFactoryInput, 'options' | 'dryRun'> & { max?: number }): Promise<AutoralQueueReport> {
  const flags: FlagState = { ...FLAG_DEFAULTS, ...(i.flags ?? {}) };
  if (flags.modelosHabilitados && !i.persistentLedger) {
    throw new Error('modelosHabilitados exige ledger de orçamento persistente (PostgreSQL); recusado para não perder o teto mensal em um restart');
  }
  if (!i.gateway) throw new Error('a pauta autoral chama modelo: informe o gateway de modelos');
  const store = new PgEditorialStore(i.db);
  const registry = i.registry ?? new SourceRegistry(SEED_SOURCES);
  const now = i.now ?? (() => new Date());
  const reader = shadowReader(i.reader, i.shadow);
  const observer = shadowObserver(i.shadow);
  const collector = i.collector ?? new Collector(i.fetcher ?? createNodeFetcher(), { now, resolver: i.resolver ?? systemResolver, flags, readBudget: new StoreReadBudget(store), ...(reader ? { reader } : {}), ...(observer ? { onDirectRead: observer } : {}), ...(i.collectorOptions ?? {}) });
  const llm: ChatTransport = createModelopsTransport(i.gateway);
  try {
    return await runAutoralQueue({ store, registry, collector, gateway: createLlmGateway(llm), audit: new InMemoryAuditLog(), flags, now }, { ...(i.max ? { max: i.max } : {}) });
  } finally {
    await drainShadow(i.shadow);
  }
}

/**
 * Shadow ao vivo do roteador de scraping (só medição; dono: loyalty-news-scraping-benchmark). Desligado por padrão: só com SCRAPING_SHADOW_MODE=true
 * (staging) o pacote do benchmark é carregado e o caminho do JSONL vem de SCRAPING_SHADOW_SINK. O pacote não é dependência do Editorial: se a
 * flag estiver ligada e o pacote ou a fábrica `createLiveShadowFromEnv` não existirem, o job RECUSA começar (não segue sem medir em silêncio).
 */
export async function loadShadow(env: Record<string, string | undefined>, importer: (spec: string) => Promise<Record<string, unknown>> = (s) => import(/* @vite-ignore */ s) as Promise<Record<string, unknown>>): Promise<ShadowPort | undefined> {
  if (env['SCRAPING_SHADOW_MODE'] !== 'true') return undefined;
  const mod = await importer('@ln/scraping-benchmark').catch(() => null);
  const make = mod?.['createLiveShadowFromEnv'];
  if (typeof make !== 'function') throw new Error('SCRAPING_SHADOW_MODE=true, mas @ln/scraping-benchmark (createLiveShadowFromEnv) não está disponível neste ambiente');
  return make(env) as ShadowPort;
}
