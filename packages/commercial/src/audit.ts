// Auditabilidade da entrega: o que fazer quando o armazenamento de dedupe perde ou regride estado (ex.: Redis reiniciado, flush ou
// restaurado de um ponto antigo; o ADR-012 não faz backup do Redis). Sem as chaves de dedupe, a mesma visualização poderia ser
// contada de novo dentro do TTL, ou um visível/clique já contado poderia contar outra vez: isso INFLARIA a entrega.
//
// Mitigação (docs/dedupe-persistido.md §"Perda ou restauração do Redis"):
//   1. ao detectar a perda, abrir uma LACUNA: o AdServer continua servindo o criativo, mas NÃO conta o que depende do dedupe
//      (impressões novas até `servedUntil` = detecção + TTL da visualização; visível/clique até `to` = detecção + TTL da impressão);
//   2. a lacuna fica registrada com origem, início, fim e quantos eventos deixaram de ser contados;
//   3. relatórios (campanha, painel, mídia kit) marcam o período como "não auditável": o número mostrado é piso, não total.
// Princípio: sub-contar e dizer que sub-contou; nunca inflar.
import { SNAPSHOT_VERSION, assertSnapshot, assertUnique, clone } from './snapshot';

/** TTL da chave de visualização no armazenamento compartilhado (janela em que um refresh é deduplicado). */
export const VIEW_TTL_MS = 30 * 60_000;
/** TTL da chave da impressão (janela em que visível/clique chegam e são deduplicados). */
export const IMPRESSION_TTL_MS = 2 * 3_600_000;

export type GapReason = 'dedupe_perdido' | 'dedupe_regrediu';
export interface AuditGap {
  id: string;
  reason: GapReason;
  /** Início do período não auditável: última vez em que o dedupe esteve comprovadamente saudável. */
  from: string;
  /** Até aqui impressões novas ficam sem contagem. */
  servedUntil: string;
  /** Fim do período não auditável (visível e clique ficam sem contagem até aqui). */
  to: string;
  detectedAt: string;
  /** Impressões servidas e não contadas por causa da lacuna. */
  uncountedServes: number;
  /** Eventos de visível/clique descartados por causa da lacuna. */
  ignoredEvents: number;
}
export interface AuditSnapshot { version: typeof SNAPSHOT_VERSION; seq: number; gaps: AuditGap[] }

const iso = (ms: number): string => new Date(ms).toISOString();
const ms = (s: string): number => Date.parse(s);

export class DeliveryAudit {
  private gaps: AuditGap[] = [];
  private seq = 0;

  list(): readonly AuditGap[] { return this.gaps; }

  /**
   * Registra a perda do estado de dedupe. Perdas sobrepostas ou contíguas são fundidas numa lacuna só (estendendo as janelas),
   * porque uma nova perda durante a suspensão reinicia a contagem de TTL.
   * @param lastHealthyAtMs última vez comprovadamente saudável (heartbeat); se desconhecida, use o próprio instante da detecção.
   */
  reportLoss(opts: { detectedAtMs: number; lastHealthyAtMs?: number; reason: GapReason }): AuditGap {
    const from = Math.min(opts.lastHealthyAtMs ?? opts.detectedAtMs, opts.detectedAtMs);
    const servedUntil = opts.detectedAtMs + VIEW_TTL_MS;
    const to = opts.detectedAtMs + IMPRESSION_TTL_MS;
    const open = this.gaps.find((g) => ms(g.from) <= to && from <= ms(g.to));
    if (open) {
      open.from = iso(Math.min(ms(open.from), from));
      open.servedUntil = iso(Math.max(ms(open.servedUntil), servedUntil));
      open.to = iso(Math.max(ms(open.to), to));
      open.detectedAt = iso(opts.detectedAtMs);
      if (opts.reason === 'dedupe_regrediu') open.reason = 'dedupe_regrediu';
      return open;
    }
    const g: AuditGap = { id: `gap-${++this.seq}`, reason: opts.reason, from: iso(from), servedUntil: iso(servedUntil), to: iso(to), detectedAt: iso(opts.detectedAtMs), uncountedServes: 0, ignoredEvents: 0 };
    this.gaps.push(g);
    return g;
  }

  private active(nowMs: number, field: 'servedUntil' | 'to'): AuditGap | undefined {
    return this.gaps.find((g) => ms(g.detectedAt) <= nowMs && nowMs < ms(g[field]));
  }
  /** Impressões novas não podem ser contadas agora? */
  servingSuspended(nowMs: number): boolean { return this.active(nowMs, 'servedUntil') !== undefined; }
  /** Visível e clique não podem ser contados agora? */
  eventsSuspended(nowMs: number): boolean { return this.active(nowMs, 'to') !== undefined; }
  noteUncountedServe(nowMs: number): void { const g = this.active(nowMs, 'servedUntil'); if (g) g.uncountedServes++; }
  noteIgnoredEvent(nowMs: number): void { const g = this.active(nowMs, 'to'); if (g) g.ignoredEvents++; }

  /** Lacunas que tocam o intervalo [startMs, endMs). */
  overlapping(startMs: number, endMs: number): AuditGap[] {
    return this.gaps.filter((g) => ms(g.from) < endMs && startMs < ms(g.to));
  }

  snapshot(): AuditSnapshot { return { version: SNAPSHOT_VERSION, seq: this.seq, gaps: clone(this.gaps) }; }
  load(s: AuditSnapshot): void {
    assertSnapshot(s, 'DeliveryAudit', ['gaps']);
    assertUnique(s.gaps.map((g) => g.id), 'DeliveryAudit');
    for (const g of s.gaps) for (const k of ['from', 'servedUntil', 'to', 'detectedAt'] as const) {
      if (Number.isNaN(Date.parse(g[k]))) throw new Error(`Lacuna ${g.id}: ${k} inválido.`);
    }
    this.gaps = clone(s.gaps);
    this.seq = Math.max(s.seq ?? 0, ...this.gaps.map((g) => Number(/-(\d+)$/.exec(g.id)?.[1] ?? 0)));
  }
}

const SP_OFFSET = '-03:00'; // America/Sao_Paulo (sem horário de verão desde 2019)
/** Período de uma campanha em ms: [00:00 do início, 00:00 do dia seguinte ao fim) em America/Sao_Paulo. */
export function campaignPeriodMs(startDate: string, endDate: string): [number, number] {
  return [Date.parse(`${startDate}T00:00:00${SP_OFFSET}`), Date.parse(`${endDate}T00:00:00${SP_OFFSET}`) + 86_400_000];
}

/** Resumo de auditabilidade de um período. `auditable=false` quando alguma lacuna o toca: o número exibido é piso. */
export function auditabilityOf(audit: DeliveryAudit, startMs: number, endMs: number) {
  const gaps = audit.overlapping(startMs, endMs);
  return {
    auditable: gaps.length === 0,
    gaps,
    note: gaps.length === 0 ? null : 'Período não auditável: o armazenamento de deduplicação perdeu estado. Impressões, visíveis e cliques deste período são valores mínimos, não totais.',
  };
}
