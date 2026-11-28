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
/** Resultado de cada fonte da rodada (DP-94, condição 4): uma ou mais linhas, gravadas ANTES do resumo, que fecha a rodada. */
export const COLLECTOR_SOURCES_ACTION = 'collector.round.sources';
/** Aviso de que não houve rodada boa no prazo (gravado pelo vigia do worker). */
export const COLLECTOR_ALERT_ACTION = 'collector.alert';
/** Como começa o resumo de uma rodada boa: ao menos uma fonte entregou item (novo ou repetido). */
export const GOOD_ROUND_PREFIX = 'rodada boa; ';
const DETAIL_MAX = 2000;

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
  sources: InboxSourceReport[];
}

/** Relatório da fonte mais quantos itens dela foram gravados nesta rodada. */
export type InboxSourceReport = SourceCollectReport & { saved: number };

export const isGoodRound = (r: InboxRound): boolean => r.sources.some((s) => s.evidences > 0);

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
  return `${isGoodRound(r) ? GOOD_ROUND_PREFIX : 'rodada sem item; '}${parts.join('; ')}`.slice(0, DETAIL_MAX);
}

const OUTCOME: Record<SourceCollectReport['status'], string> = { collected: 'sem_itens', not_eligible: 'desabilitada', no_feed: 'sem_endereco', error: 'erro' };

/** Uma linha por fonte, só com id, códigos fechados e contagens: nunca endereço, mensagem de erro ou texto de página. */
export function describeSource(s: InboxSourceReport): string {
  const parts = [s.sourceId, s.evidences > 0 ? 'ok' : OUTCOME[s.status], `itens=${s.evidences}`, `novos=${s.saved}`, `repetidos=${s.evidences - s.saved}`];
  const skips = new Map<string, number>();
  for (const k of s.skipped) skips.set(k.code, (skips.get(k.code) ?? 0) + 1);
  if (skips.size) parts.push(`pulados=${[...skips].map(([code, n]) => `${code}:${n}`).join(',')}`);
  return parts.join(' ');
}

/** As linhas das fontes em blocos de até 2000 caracteres, sem cortar nenhuma fonte ao meio. */
export function describeSources(r: InboxRound): string[] {
  const blocks: string[] = [];
  for (const line of r.sources.map(describeSource)) {
    const last = blocks.at(-1);
    if (last !== undefined && last.length + 1 + line.length <= DETAIL_MAX) blocks[blocks.length - 1] = `${last}\n${line}`;
    else blocks.push(line.slice(0, DETAIL_MAX));
  }
  return blocks;
}

export async function collectToInbox(deps: InboxDeps, opts: { limitPerSource?: number; onlySourceIds?: readonly string[] } = {}): Promise<InboxRound> {
  requireFlag(deps.flags, 'editorialCollector');
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const collected = await collectFromSources({ store: deps.store, registry: deps.registry, collector: deps.collector }, opts);
  const saved: string[] = [];
  let existing = 0;
  const savedBySource = new Map<string, number>();
  for (const item of collected.items) {
    // outra execução (Fábrica avulsa) pode ter gravado o mesmo id enquanto esta rodada lia: nunca sobrescreve
    if (await deps.store.getArticle(item.articleId)) { existing += 1; continue; }
    await deps.store.putArticle(toRecord(item, now().toISOString()));
    saved.push(item.articleId);
    savedBySource.set(item.sourceId, (savedBySource.get(item.sourceId) ?? 0) + 1);
  }
  const sources = collected.sources.map((s) => ({ ...s, saved: savedBySource.get(s.sourceId) ?? 0 }));
  const round: InboxRound = { startedAt, finishedAt: now().toISOString(), saved, duplicates: collected.duplicates.length + existing, sources };
  // Sem fonte habilitada não há rodada a registrar: é assim que a parada fica visível na trilha.
  if (round.sources.length) {
    const log = (action: string, detail: string) => deps.store.appendAudit({ at: round.finishedAt, userId: null, action, target: 'collector', detail });
    for (const block of describeSources(round)) await log(COLLECTOR_SOURCES_ACTION, block);
    await log(COLLECTOR_ROUND_ACTION, describeRound(round));
  }
  return round;
}
