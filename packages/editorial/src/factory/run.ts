import type { Collector } from '../collector/collector';
import type { EditorialFlagOverrides } from '../flags';
import { requireFlag } from '../flags';
import type { ModelGateway } from '../gateway';
import { InMemoryQueue, makeProcessor } from '../pipeline/queue';
import type { AuditLog, StageDeps } from '../pipeline/stages';
import type { ArticleJob, BlockerCode, Stage } from '../pipeline/jobs';
import type { SourceRegistry } from '../sources/registry';
import { applyOutcome } from '../api/store';
import type { EditorialStore } from '../api/store';
import { collectFromSources } from './collect';
import type { CollectOutcome, SourceCollectReport } from './collect';

/**
 * Fábrica ponta a ponta até a APROVAÇÃO: coleta (fontes habilitadas) → triagem → contexto → redação → checagem em provedor
 * distinto → revisão. Cada estágio é gravado no `EditorialStore` (PostgreSQL em produção) ao terminar; ao final a matéria está
 * `aprovado` (pronta para recibo e publicação pela rota oficial) ou `bloqueado` com os motivos. NÃO emite recibo nem publica.
 * Exige as flags `editorialCollector` e `editorialPipeline` (desligadas por padrão). `dryRun` só coleta e não chama modelo.
 */

export interface FactoryDeps {
  store: EditorialStore;
  /** Cadastro de fontes (imutável); o estado de habilitação vem do store. */
  registry: SourceRegistry;
  collector: Collector;
  gateway: ModelGateway;
  audit: AuditLog;
  flags?: EditorialFlagOverrides;
  now?: () => Date;
}
export interface FactoryOptions { maxArticles?: number; limitPerSource?: number; onlySourceIds?: readonly string[]; dryRun?: boolean }

export interface ArticleRunReport {
  articleId: string; sourceId: string; url: string; status: string; stages: Stage[]; blockers: BlockerCode[]; findings: string[];
}
export interface FactoryReport {
  startedAt: string; dryRun: boolean;
  sources: SourceCollectReport[];
  duplicates: CollectOutcome['duplicates'];
  /** Itens coletados e não processados por `maxArticles` (ficam para a próxima execução). */
  deferred: string[];
  articles: ArticleRunReport[];
  /** Motivo de parada antecipada (orçamento esgotado, parada de emergência, modelos desabilitados). */
  haltedBy: string | null;
}

/** Recusas do gateway que interrompem a rodada inteira (não adianta tentar as demais matérias). */
const HALTING = new Set(['budget_exhausted', 'budget_step_blocked', 'kill_switch', 'model_disabled', 'unknown_rate']);

export async function runFactory(deps: FactoryDeps, opts: FactoryOptions = {}): Promise<FactoryReport> {
  requireFlag(deps.flags, 'editorialCollector');
  const now = deps.now ?? (() => new Date());
  const report: FactoryReport = { startedAt: now().toISOString(), dryRun: opts.dryRun === true, sources: [], duplicates: [], deferred: [], articles: [], haltedBy: null };
  const collected = await collectFromSources(
    { store: deps.store, registry: deps.registry, collector: deps.collector },
    { ...(opts.limitPerSource ? { limitPerSource: opts.limitPerSource } : {}), ...(opts.onlySourceIds ? { onlySourceIds: opts.onlySourceIds } : {}) },
  );
  report.sources = collected.sources; report.duplicates = collected.duplicates;
  if (opts.dryRun) {
    report.articles = collected.items.map((i) => ({ articleId: i.articleId, sourceId: i.sourceId, url: i.evidence.url, status: 'coletado (dry-run)', stages: [], blockers: [], findings: [] }));
    return report;
  }
  requireFlag(deps.flags, 'editorialPipeline');

  const items = collected.items.slice(0, opts.maxArticles ?? collected.items.length);
  report.deferred = collected.items.slice(items.length).map((i) => i.articleId);
  const stageDeps: StageDeps = {
    gateway: deps.gateway, registry: collected.effective, audit: deps.audit, ...(deps.flags ? { flags: deps.flags } : {}),
    now, slugExists: async (slug) => (await deps.store.listArticles()).some((a) => a.draft?.slug === slug),
  };
  for (const item of items) {
    if (report.haltedBy) { report.deferred.push(item.articleId); continue; }
    const row: ArticleRunReport = { articleId: item.articleId, sourceId: item.sourceId, url: item.evidence.url, status: 'rascunho', stages: [], blockers: [], findings: [] };
    report.articles.push(row);
    const queue = new InMemoryQueue();
    const processor = makeProcessor(stageDeps, queue);
    // grava cada estágio ao terminar: uma queda no meio deixa o último estado consistente no banco
    const persisting = async (spec: Parameters<typeof processor>[0]) => {
      const out = await processor(spec);
      row.stages.push(spec.stage);
      const rec = await applyOutcome(deps.store, spec.data, out, now().toISOString());
      row.status = rec.status;
      if (out.kind === 'blocked') {
        row.blockers = out.blocked.blockers; row.findings = out.blocked.findings.map((f) => `${f.code}: ${f.message}`);
        if (out.blocked.findings.some((f) => HALTING.has(f.code))) report.haltedBy = out.blocked.findings.find((f) => HALTING.has(f.code))!.code;
      }
      return out;
    };
    const job: ArticleJob = { articleId: item.articleId, editoria: item.editoria, evidences: [item.evidence], attempt: 0 };
    await queue.enqueue({ stage: 'triage', jobId: `${item.articleId}:triage:0`, data: job });
    await queue.drain(persisting);
    await deps.store.appendAudit({ at: now().toISOString(), userId: null, action: 'factory.article', target: item.articleId, detail: `${row.status}; estágios: ${row.stages.join('>')}` });
  }
  await deps.store.appendAudit({ at: now().toISOString(), userId: null, action: 'factory.run', target: 'factory', detail: `${report.articles.length} matérias; parada: ${report.haltedBy ?? 'não'}` });
  return report;
}
