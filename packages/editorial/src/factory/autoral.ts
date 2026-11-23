import { z } from 'zod';
import { requireFlag } from '../flags';
import { StopGuard } from '../collector/collector';
import { InMemoryQueue, makeProcessor } from '../pipeline/queue';
import type { StageDeps } from '../pipeline/stages';
import type { ArticleJob, BlockerCode, Stage, StageOutcome } from '../pipeline/jobs';
import { SourceRegistry } from '../sources/registry';
import { resolveEffectiveSources } from '../sources/state';
import { sha256 } from '../dedupe/dedupe';
import { AUTORAL_FORMATS, EDITORIAS } from '../types';
import type { Evidence } from '../types';
import { applyOutcome } from '../api/store';
import { AUTORAL_MIN_PRIMARY } from '../rules/rules';
import { primarySourceFor } from './anchor';
import type { FactoryDeps, ArticleRunReport } from './run';

/**
 * Conteúdo AUTORAL (DP-29): pauta própria da redação (análise, explicador ou comparativo), ancorada em páginas de fontes
 * PRIMÁRIAS habilitadas. Quem propõe a pauta é uma pessoa da redação (ou o Growth/Intelligence com revisão humana); a fábrica
 * não escolhe tema sozinha. Coleta as âncoras pelo coletor normal, redige com o prompt autoral, checa em provedor distinto e
 * revisa; o gate exige ≥ 2 âncoras primárias distintas, aviso de conteúdo autoral e nenhuma fala. Termina em 'aprovado' ou
 * 'bloqueado': NÃO emite recibo nem publica.
 */
export const PautaAutoral = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(64),
  titulo: z.string().trim().min(10).max(140),
  angulo: z.string().trim().min(20).max(600),
  formato: z.enum(AUTORAL_FORMATS as unknown as [string, ...string[]]),
  editoria: z.enum(EDITORIAS as unknown as [string, ...string[]]),
  /** Páginas de fontes primárias habilitadas que sustentam a pauta (https). */
  ancoras: z.array(z.string().url()).min(AUTORAL_MIN_PRIMARY).max(8),
}).strict();
export type PautaAutoral = z.infer<typeof PautaAutoral>;

export const autoralArticleId = (pautaId: string): string => `aut_${sha256(`pauta:${pautaId}`).slice(0, 20)}`;

export async function runAutoral(deps: FactoryDeps, input: unknown): Promise<ArticleRunReport> {
  requireFlag(deps.flags, 'editorialCollector');
  requireFlag(deps.flags, 'editorialPipeline');
  const now = deps.now ?? (() => new Date());
  const parsed = PautaAutoral.safeParse(input);
  if (!parsed.success) throw new Error(`pauta autoral inválida: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const pauta = parsed.data;
  const articleId = autoralArticleId(pauta.id);
  const row: ArticleRunReport = { articleId, sourceId: 'autoral', url: `pauta:${pauta.id}`, status: 'rascunho', stages: [], blockers: [], findings: [], anchors: [] };
  if (await deps.store.getArticle(articleId)) { row.status = 'ja_existe'; row.findings = ['pauta já processada (id estável por pauta)']; return row; }

  const effective = new SourceRegistry(await resolveEffectiveSources(deps.registry, deps.store));
  const evidences: Evidence[] = [];
  const seen = new Set<string>();
  const why: string[] = [];
  const guard = new StopGuard();
  for (const url of pauta.ancoras) {
    const src = primarySourceFor(effective, url);
    if (!src) { why.push(`${url}: sem fonte primária habilitada que cubra esta URL`); continue; }
    const r = await deps.collector.collectUrl(src, url);
    if (!r.evidence) { why.push(`${url}: ${r.skip?.code ?? 'sem evidência'}`); if (guard.note(r.skip)) break; continue; }
    guard.note(undefined);
    if (r.evidence.suspicious) { why.push(`${url}: evidência suspeita (instrução embutida)`); continue; }
    if (seen.has(r.evidence.canonicalUrl)) continue;
    seen.add(r.evidence.canonicalUrl);
    evidences.push(r.evidence);
  }
  const job: ArticleJob = {
    articleId, editoria: pauta.editoria as ArticleJob['editoria'], evidences, attempt: 0,
    autoral: { pautaId: pauta.id, formato: pauta.formato as NonNullable<ArticleJob['autoral']>['formato'], titulo: pauta.titulo, angulo: pauta.angulo },
  };
  row.anchors = evidences.map((e) => e.canonicalUrl);
  if (evidences.length < AUTORAL_MIN_PRIMARY) {
    const out: StageOutcome = { kind: 'blocked', blocked: { articleId, stage: 'context', blockers: ['autoral_invalid'], findings: [{ code: 'autoral_needs_anchors', message: `âncoras primárias coletadas: ${evidences.length} de ${AUTORAL_MIN_PRIMARY} necessárias. ${why.join(' | ')}` }] } };
    const rec = await applyOutcome(deps.store, job, out, now().toISOString());
    row.status = rec.status; row.blockers = ['autoral_invalid']; row.findings = out.blocked.findings.map((f) => `${f.code}: ${f.message}`);
    return row;
  }

  const stageDeps: StageDeps = {
    gateway: deps.gateway, registry: effective, audit: deps.audit, ...(deps.flags ? { flags: deps.flags } : {}),
    now, slugExists: async (slug) => (await deps.store.listArticles()).some((a) => a.draft?.slug === slug),
  };
  const queue = new InMemoryQueue();
  const processor = makeProcessor(stageDeps, queue);
  const persisting = async (spec: Parameters<typeof processor>[0]) => {
    const out = await processor(spec);
    row.stages.push(spec.stage as Stage);
    const rec = await applyOutcome(deps.store, spec.data, out, now().toISOString());
    row.status = rec.status;
    if (out.kind === 'blocked') { row.blockers = out.blocked.blockers as BlockerCode[]; row.findings = out.blocked.findings.map((f) => `${f.code}: ${f.message}`); }
    return out;
  };
  // a pauta já é decisão da redação (editoria e relevância): começa em 'context' (sem triagem automática)
  await queue.enqueue({ stage: 'context', jobId: `${articleId}:context:0`, data: job });
  await queue.drain(persisting);
  await deps.store.appendAudit({ at: now().toISOString(), userId: null, action: 'factory.autoral', target: articleId, detail: `${row.status}; pauta ${pauta.id}; estágios: ${row.stages.join('>')}` });
  return row;
}
