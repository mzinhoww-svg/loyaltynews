// Lacunas de auditoria da entrega (perda ou regressão do dedupe no Redis): LADO CONSUMIDOR. Quem ESCREVE as lacunas é o monitor do
// Backend (heartbeat ln:ad:hb + ad_redis_watermark, ft/backend-redis-audit); aqui só se lê a tabela `ad_delivery_gaps`:
//  - hydrate(): carrega todas as lacunas em `ctx.ads.audit`, para os relatórios (campanha, anunciante, painel) marcarem
//    "período não auditável" (piso, não total);
//  - /ads/serve e /ads/event (ads.ts): carrega as lacunas ATIVAS para o domínio suspender a contagem enquanto durarem
//    (impressão nova até `servedUntil`, visível/clique até `to`) e grava de volta quantas impressões/eventos deixaram de contar.
//
// loadGaps, gapsSnapshot e addGapCounts vêm do Backend ('@ln/workers/ad-gaps', ft/backend-redis-audit): a mesma tabela, o mesmo formato do AuditGap.
import type { AuditGap, DeliveryAudit } from '@ln/commercial';
import { addGapCounts, gapsSnapshot, loadGaps } from '@ln/workers/ad-gaps';
import type { Db } from '@ln/auth';

// o repo.ts usa loadGaps; reexporta para quem já importa daqui
export { addGapCounts, gapsSnapshot, loadGaps };

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

/**
 * Grava no banco o que o handler somou nos contadores das lacunas. Best-effort: um erro aqui nunca derruba servir nem contar, mas NÃO é
 * silencioso: vai ao log de erro (só o id da lacuna e o nome do erro, sem mensagem do banco nem dado de requisição) com o quanto ficou sem gravar.
 */
export async function flushGapCounts(db: Db, audit: DeliveryAudit, antes: Map<string, { s: number; e: number }>): Promise<void> {
  for (const g of audit.list()) {
    const a = antes.get(g.id) ?? { s: 0, e: 0 };
    const ds = g.uncountedServes - a.s; const de = g.ignoredEvents - a.e;
    if (ds > 0 || de > 0) {
      await addGapCounts(db, g.id, { uncountedServes: ds, ignoredEvents: de }).catch((e: unknown) => {
        console.error(`[ads] lacuna ${g.id}: contadores NÃO gravados (impressões ${ds}, eventos ${de}): ${e instanceof Error ? e.name : 'erro'}`);
      });
    }
  }
}
