import type { Collector } from '../collector/collector';
import type { EditorialFlagOverrides } from '../flags';
import { requireFlag } from '../flags';
import type { ArticleRecord, EditorialStore } from '../api/store';
import type { SourceRegistry } from '../sources/registry';
import { collectFromSources } from './collect';
import type { CollectedItem, SourceCollectReport } from './collect';

/**
 * Caixa de pautas (coleta contínua, fase 1, SEM modelo): grava cada item novo como registro editorial em 'rascunho' e SEM
 * rascunho (`draft` ausente), só com a evidência coletada. Não redige, não checa, não aprova e não publica; sem `draft`, as
 * transições de revisão, checagem e publicação recusam o registro. A deduplicação é a da coleta (URL canônica, hash e texto
 * parecido contra tudo o que já está na loja), por isso não precisa de tabela nova.
 * Limite conhecido: a Fábrica trata essas URLs como já vistas; redigir a partir da caixa é a fase seguinte.
 */

export const INBOX_FINDING = 'coletado_sem_modelo';
export const COLLECTOR_ROUND_ACTION = 'collector.round';

export interface InboxDeps {
  store: EditorialStore;
  registry: SourceRegistry;
  collector: Collector;
  flags?: EditorialFlagOverrides;
  now?: () => Date;
}

export interface InboxRound {
  startedAt: string;
  finishedAt: string;
  /** Ids gravados nesta rodada. */
  saved: string[];
  /** Itens descartados por já existirem (na loja ou dentro da rodada). */
  duplicates: number;
  sources: SourceCollectReport[];
}

const toRecord = (item: CollectedItem, at: string): ArticleRecord => ({
  articleId: item.articleId,
  editoria: item.editoria,
  status: 'rascunho',
  evidences: [item.evidence],
  blockers: [],
  findings: [{ code: INBOX_FINDING, message: 'item coletado sem modelo: ainda não há rascunho' }],
  reviews: [],
  recheckCount: 0,
  updatedAt: at,
});

/** Resumo curto para a trilha (somente ids de fonte, contagens e estados; nenhum texto de página). */
export function describeRound(r: InboxRound): string {
  const by = (s: SourceCollectReport['status']) => r.sources.filter((x) => x.status === s).map((x) => x.sourceId);
  const withItems = r.sources.filter((x) => x.evidences > 0).length;
  const parts = [`fontes ${r.sources.length}`, `com itens ${withItems}`, `novos ${r.saved.length}`, `repetidos ${r.duplicates}`];
  const errors = by('error');
  const stopped = by('not_eligible');
  if (errors.length) parts.push(`com erro: ${errors.join(', ')}`);
  if (stopped.length) parts.push(`desabilitadas durante a rodada: ${stopped.join(', ')}`);
  return parts.join('; ').slice(0, 2000);
}

export async function collectToInbox(deps: InboxDeps, opts: { limitPerSource?: number; onlySourceIds?: readonly string[] } = {}): Promise<InboxRound> {
  requireFlag(deps.flags, 'editorialCollector');
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const collected = await collectFromSources({ store: deps.store, registry: deps.registry, collector: deps.collector }, opts);
  const saved: string[] = [];
  let existing = 0;
  for (const item of collected.items) {
    // outra execução (Fábrica avulsa) pode ter gravado o mesmo id enquanto esta rodada lia: nunca sobrescreve
    if (await deps.store.getArticle(item.articleId)) { existing += 1; continue; }
    await deps.store.putArticle(toRecord(item, now().toISOString()));
    saved.push(item.articleId);
  }
  const round: InboxRound = { startedAt, finishedAt: now().toISOString(), saved, duplicates: collected.duplicates.length + existing, sources: collected.sources };
  // Sem fonte habilitada não há rodada a registrar: é assim que a parada fica visível na trilha.
  if (round.sources.length) {
    await deps.store.appendAudit({ at: round.finishedAt, userId: null, action: COLLECTOR_ROUND_ACTION, target: 'collector', detail: describeRound(round) });
  }
  return round;
}
