// Lacunas de auditoria da entrega (perda ou regressão do dedupe no Redis): LADO CONSUMIDOR. Quem ESCREVE as lacunas é o monitor do
// Backend (heartbeat ln:ad:hb + ad_redis_watermark, ft/backend-redis-audit); aqui só se lê a tabela `ad_delivery_gaps`:
//  - hydrate(): carrega todas as lacunas em `ctx.ads.audit`, para os relatórios (campanha, anunciante, painel) marcarem
//    "período não auditável" (piso, não total);
//  - /ads/serve e /ads/event (ads.ts): carrega as lacunas ATIVAS para o domínio suspender a contagem enquanto durarem
//    (impressão nova até `servedUntil`, visível/clique até `to`) e grava de volta quantas impressões/eventos deixaram de contar.
//
// PROVISÓRIO: loadGaps, gapsSnapshot e addGapCounts espelham, com a mesma assinatura, os helpers que o Backend exporta em
// '@ln/workers/ad-gaps'. Quando o ft/backend-redis-audit entrar, trocar os três pelo import e apagar o SQL daqui.
import { gte, sql } from 'drizzle-orm';
import { SNAPSHOT_VERSION, type AuditGap, type AuditSnapshot, type DeliveryAudit } from '@ln/commercial';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';

const iso = (d: Date): string => d.toISOString();

/** Lacunas gravadas. Com `activeAt`, só as que ainda não terminaram nesse instante (`to` > activeAt). */
export async function loadGaps(db: Db, opts: { activeAt?: Date } = {}): Promise<AuditGap[]> {
  const t = schema.adDeliveryGaps;
  const q = db.select().from(t);
  const rows = await (opts.activeAt ? q.where(gte(t.to, new Date(opts.activeAt.getTime() + 1))) : q);
  return rows.map((r): AuditGap => ({
    id: r.id, reason: r.reason, from: iso(r.from), servedUntil: iso(r.servedUntil), to: iso(r.to), detectedAt: iso(r.detectedAt),
    uncountedServes: r.uncountedServes, ignoredEvents: r.ignoredEvents,
  }));
}

/** Snapshot pronto para `DeliveryAudit.load()`. */
export function gapsSnapshot(gaps: readonly AuditGap[]): AuditSnapshot {
  return { version: SNAPSHOT_VERSION, seq: 0, gaps: gaps.map((g) => ({ ...g })) };
}

/** Soma atômica nos contadores da lacuna (col = col + n). Só incrementa; o monitor nunca sobrescreve estes campos. */
export async function addGapCounts(db: Db, gapId: string, n: { uncountedServes?: number; ignoredEvents?: number }): Promise<void> {
  const serves = Math.max(0, Math.trunc(n.uncountedServes ?? 0));
  const events = Math.max(0, Math.trunc(n.ignoredEvents ?? 0));
  if (serves === 0 && events === 0) return;
  const t = schema.adDeliveryGaps;
  await db.update(t).set({
    uncountedServes: sql`${t.uncountedServes} + ${serves}`,
    ignoredEvents: sql`${t.ignoredEvents} + ${events}`,
  }).where(sql`${t.id} = ${gapId}`);
}

/** Carrega as lacunas no auditor do domínio. */
export function loadGapsInto(audit: DeliveryAudit, gaps: readonly AuditGap[]): void {
  audit.load(gapsSnapshot(gaps));
}

// ---- cache curto das lacunas ativas para a rota pública (uma leitura leve por rota a cada GAP_CACHE_MS) ----
/** Janela máxima entre o monitor gravar uma lacuna e a rota pública passar a suspender (somada à batida de 1 min do monitor). */
export const GAP_CACHE_MS = 5_000;
let cache = new WeakMap<object, { at: number; gaps: AuditGap[] }>();

/** Descarta o cache (testes; e qualquer momento em que se queira reler já). */
export function resetGapCache(): void { cache = new WeakMap(); }

/**
 * Lacunas ativas em `nowMs`, com cache de GAP_CACHE_MS por conexão. Um erro de leitura propaga, como o da leitura dos criativos que
 * já acontece na mesma rota: sem banco não há o que servir.
 */
export async function activeGaps(db: Db, nowMs: number): Promise<AuditGap[]> {
  const hit = cache.get(db);
  const agora = Date.now();
  if (hit && agora - hit.at < GAP_CACHE_MS) return hit.gaps;
  const gaps = await loadGaps(db, { activeAt: new Date(nowMs) });
  cache.set(db, { at: agora, gaps });
  return gaps;
}

/** Estado dos contadores das lacunas, para medir o que o handler somou. */
export const gapCountsOf = (audit: DeliveryAudit): Map<string, { s: number; e: number }> =>
  new Map(audit.list().map((g) => [g.id, { s: g.uncountedServes, e: g.ignoredEvents }]));

/** Grava no banco o que o handler somou nos contadores das lacunas (best-effort: erro aqui nunca derruba servir nem contar). */
export async function flushGapCounts(db: Db, audit: DeliveryAudit, antes: Map<string, { s: number; e: number }>): Promise<void> {
  for (const g of audit.list()) {
    const a = antes.get(g.id) ?? { s: 0, e: 0 };
    const ds = g.uncountedServes - a.s; const de = g.ignoredEvents - a.e;
    if (ds > 0 || de > 0) await addGapCounts(db, g.id, { uncountedServes: ds, ignoredEvents: de }).catch(() => undefined);
  }
}
