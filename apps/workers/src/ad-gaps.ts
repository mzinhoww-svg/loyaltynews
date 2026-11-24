// Persistência das lacunas de auditoria da entrega de anúncios (`ad_delivery_gaps`) e do espelho do watermark do Redis
// (`ad_redis_watermark`), migração 0011. Dono: Frente 02 — LN Backend Engineer. Contrato com o Commercial (costura da tabela):
//  - o MONITOR (`ad-redis-watch.ts`) ESCREVE as lacunas (`saveGap`: upsert por id, só alarga a janela, nunca mexe nos contadores);
//  - o caminho público e o Studio (apps/web/app/api/_lib/commercial) LEEM (`loadGaps`, `gapsSnapshot` → `audit.load`) e só INCREMENTAM
//    `uncounted_serves`/`ignored_events` por `addGapCounts` (UPDATE atômico `col = col + n`); o monitor nunca incrementa.
// Os campos saem exatamente como o domínio (`AuditGap` de @ln/commercial): datas em ISO-8601 com milissegundos, sem dado pessoal.
import { asc, eq, gt, sql } from 'drizzle-orm';
import { schema } from '@ln/db';
import type { Db } from '@ln/auth';
import { SNAPSHOT_VERSION, type AuditGap, type AuditSnapshot, type GapReason } from '@ln/commercial';

type GapRow = typeof schema.adDeliveryGaps.$inferSelect;

const toGap = (r: GapRow): AuditGap => ({
  id: r.id,
  reason: r.reason,
  from: r.from.toISOString(),
  servedUntil: r.servedUntil.toISOString(),
  to: r.to.toISOString(),
  detectedAt: r.detectedAt.toISOString(),
  uncountedServes: r.uncountedServes,
  ignoredEvents: r.ignoredEvents,
});

/**
 * Lacunas gravadas, da mais antiga para a mais nova. Com `activeAt`, só as que ainda valem nesse instante (`to` > instante):
 * é o que o caminho público precisa para suspender a contagem. Sem `activeAt`, todas (relatórios e o monitor, que precisa de todas
 * para continuar a numeração `gap-N`).
 */
export async function loadGaps(db: Db, opts: { activeAt?: Date } = {}): Promise<AuditGap[]> {
  const t = schema.adDeliveryGaps;
  const rows = await db.select().from(t).where(opts.activeAt ? gt(t.to, opts.activeAt) : undefined).orderBy(asc(t.detectedAt), asc(t.id));
  return rows.map(toGap);
}

const seqOf = (id: string): number => Number(/-(\d+)$/.exec(id)?.[1] ?? 0);

/** Fotografia no formato de `DeliveryAudit.load()`. `seq` é o maior N de `gap-N`, para o domínio nunca reaproveitar um id. */
export function gapsSnapshot(gaps: readonly AuditGap[]): AuditSnapshot {
  return { version: SNAPSHOT_VERSION, seq: Math.max(0, ...gaps.map((g) => seqOf(g.id))), gaps: gaps.map((g) => ({ ...g })) };
}

/**
 * Grava a lacuna (upsert por id). Se a linha já existe, a janela só se alarga (início menor, fins maiores, detecção mais recente), o motivo
 * `dedupe_regrediu` prevalece (como no domínio) e os contadores NÃO são tocados: quem os incrementa é o caminho público (`addGapCounts`).
 */
export async function saveGap(db: Db, g: AuditGap): Promise<void> {
  const t = schema.adDeliveryGaps;
  const d = (s: string): Date => {
    const v = new Date(s);
    if (Number.isNaN(v.getTime())) throw new Error(`lacuna ${g.id}: data inválida`);
    return v;
  };
  await db
    .insert(t)
    .values({
      id: g.id, reason: g.reason, from: d(g.from), servedUntil: d(g.servedUntil), to: d(g.to), detectedAt: d(g.detectedAt),
      uncountedServes: g.uncountedServes, ignoredEvents: g.ignoredEvents,
    })
    .onConflictDoUpdate({
      target: t.id,
      set: {
        reason: sql`CASE WHEN ${t.reason} = 'dedupe_regrediu' OR excluded.reason = 'dedupe_regrediu' THEN 'dedupe_regrediu'::ad_gap_reason ELSE excluded.reason END`,
        from: sql`LEAST(${t.from}, excluded."from")`,
        servedUntil: sql`GREATEST(${t.servedUntil}, excluded.served_until)`,
        to: sql`GREATEST(${t.to}, excluded."to")`,
        detectedAt: sql`GREATEST(${t.detectedAt}, excluded.detected_at)`,
      },
    });
}

/**
 * Soma ao contador da lacuna, de forma atômica no banco (`col = col + n`): duas instâncias somando ao mesmo tempo não perdem contagem.
 * Devolve false quando a lacuna não existe (ex.: removida à mão). Só inteiros ≥ 0.
 */
export async function addGapCounts(db: Db, gapId: string, add: { uncountedServes?: number; ignoredEvents?: number }): Promise<boolean> {
  const u = add.uncountedServes ?? 0;
  const e = add.ignoredEvents ?? 0;
  if (!Number.isSafeInteger(u) || !Number.isSafeInteger(e) || u < 0 || e < 0) throw new Error('addGapCounts: só inteiros ≥ 0');
  if (u === 0 && e === 0) return true;
  const t = schema.adDeliveryGaps;
  const r = await db
    .update(t)
    .set({ uncountedServes: sql`${t.uncountedServes} + ${u}`, ignoredEvents: sql`${t.ignoredEvents} + ${e}` })
    .where(eq(t.id, gapId))
    .returning({ id: t.id });
  return r.length > 0;
}

// ---------- espelho do watermark ----------
export interface Watermark { value: number; at: Date }

export async function readWatermark(db: Db, id: string): Promise<Watermark | null> {
  const t = schema.adRedisWatermark;
  const [r] = await db.select().from(t).where(eq(t.id, id)).limit(1);
  return r ? { value: r.value, at: r.at } : null;
}

/**
 * Grava o watermark. `max` (batida normal): valor = GREATEST(atual, novo), nunca recua; `set` (depois de uma perda detectada): valor = novo,
 * porque o Redis recomeçou. O horário é sempre o da batida: é a "última vez saudável" que a próxima lacuna usará.
 */
export async function writeWatermark(db: Db, id: string, value: number, at: Date, mode: 'max' | 'set'): Promise<void> {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('watermark: inteiro ≥ 0');
  const t = schema.adRedisWatermark;
  await db
    .insert(t)
    .values({ id, value, at })
    .onConflictDoUpdate({
      target: t.id,
      set: { value: mode === 'max' ? sql`GREATEST(${t.value}, excluded.value)` : sql`excluded.value`, at: sql`excluded.at` },
    });
}

export async function deleteWatermark(db: Db, id: string): Promise<void> {
  await db.delete(schema.adRedisWatermark).where(eq(schema.adRedisWatermark.id, id));
}

export type { AuditGap, GapReason };
