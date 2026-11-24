// Detecção de perda ou regressão do Redis do ad server (C1 do checklist do Comercial; protocolo em
// packages/commercial/docs/dedupe-persistido.md §"Como detectar"). Dono: Frente 02 — LN Backend Engineer.
//
// Uma chave-marcador simples não detecta restauração de backup: o valor restaurado pode ser igual ao que já se conhece. Por isso o
// watermark é MONOTÔNICO: a chave `ln:ad:hb` sobe por INCR a cada batida e o valor lido é espelhado no PostgreSQL com GREATEST
// (`ad_redis_watermark`, id `ln:ad:hb`, com o horário da batida = "última vez saudável").
// A cada batida (e na subida do processo), na ORDEM: lê o espelho, lê a chave, faz o INCR.
//   chave ausente           → o Redis perdeu o estado            → lacuna `dedupe_perdido`
//   chave menor que o espelho → o Redis voltou no tempo (backup antigo) → lacuna `dedupe_regrediu`
//   chave ≥ espelho          → saudável; o espelho sobe
// Redis inacessível: não há como saber o que aconteceu; grava o INÍCIO da indisponibilidade (`ln:ad:hb:unreachable`) e, quando o
// Redis volta, abre a lacuna (`dedupe_perdido`, `from` = última batida registrada), mesmo que os dados estejam intactos: sub-contar, nunca inflar.
// Abrir a lacuna é só `DeliveryAudit.reportLoss` do domínio (funde com a aberta, reaproveita o id `gap-N`) + upsert em `ad_delivery_gaps`.
// Tudo corre numa transação com `pg_advisory_xact_lock`: dois workers batendo ao mesmo tempo não criam duas lacunas nem recuam o espelho.
// Sem I/O além do Redis e do PostgreSQL; nenhum valor de conexão, URL ou segredo vai ao resultado ou ao log (só ids, horários e contagens).
import { sql } from 'drizzle-orm';
import type { Db } from '@ln/auth';
import { DeliveryAudit, type AuditGap, type GapReason } from '@ln/commercial';
import { deleteWatermark, gapsSnapshot, loadGaps, readWatermark, saveGap, writeWatermark } from './ad-gaps';

export const HB_KEY = 'ln:ad:hb';
/** Linha de `ad_redis_watermark` que marca "o Redis estava inacessível desde `at`". Não é watermark: `value` é sempre 1. */
export const HB_DOWN_ID = 'ln:ad:hb:unreachable';
export const HB_INTERVAL_MS = 60_000;
const HB_TIMEOUT_MS = 5_000;
const INT = /^[0-9]+$/;

/** Subconjunto do ioredis usado aqui. */
export interface HeartbeatRedis {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  del(key: string): Promise<number>;
}

export type HeartbeatResult =
  | { state: 'baseline'; value: number }                       // primeira batida: ainda não havia espelho para comparar
  | { state: 'healthy'; value: number }
  | { state: 'loss'; reason: GapReason; cause: 'chave_ausente' | 'regrediu' | 'invalido' | 'indisponibilidade'; value: number; gap: AuditGap }
  | { state: 'unreachable'; since: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('redis: tempo esgotado')), ms); });
  p.catch(() => undefined); // a promessa original pode rejeitar depois do tempo; sem isso viraria rejeição não tratada
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/**
 * Uma batida. Nunca lança por falha do Redis (vira `unreachable`); lança só se o PostgreSQL falhar (quem chama registra e tenta na próxima).
 */
export async function heartbeatOnce(
  db: Db,
  redis: HeartbeatRedis,
  opts: { now?: () => Date; timeoutMs?: number } = {},
): Promise<HeartbeatResult> {
  const now = (opts.now ?? (() => new Date()))();
  const timeoutMs = opts.timeoutMs ?? HB_TIMEOUT_MS;
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.execute(sql`select pg_advisory_xact_lock(hashtext('ln_ad_redis_audit'))`);
    // ORDEM: o espelho antes da chave. Com a trava não há outro escritor, mas a ordem também protege o caso de um espelho mais novo que a leitura.
    const mirror = await readWatermark(t, HB_KEY);
    const down = await readWatermark(t, HB_DOWN_ID);

    let prevRaw: string | null;
    let value: number;
    try {
      prevRaw = await withTimeout(redis.get(HB_KEY), timeoutMs);
      // valor que não é inteiro (alguém mexeu à mão): o INCR falharia para sempre; apaga a chave e recomeça (é tratado como perda abaixo)
      if (prevRaw !== null && !INT.test(prevRaw)) await withTimeout(redis.del(HB_KEY), timeoutMs);
      value = await withTimeout(redis.incr(HB_KEY), timeoutMs);
    } catch {
      // Redis inacessível: marca o início (uma vez) e segue; o ad server já serve sem contar (dedupe_indisponivel).
      if (!down) await writeWatermark(t, HB_DOWN_ID, 1, now, 'set');
      return { state: 'unreachable' as const, since: (down?.at ?? now).toISOString() };
    }

    let reason: GapReason | null = null;
    let cause: 'chave_ausente' | 'regrediu' | 'invalido' | 'indisponibilidade' = 'chave_ausente';
    if (mirror) {
      const prev = prevRaw === null ? null : /^\d+$/.test(prevRaw) ? Number(prevRaw) : Number.NaN;
      if (prev === null) { reason = 'dedupe_perdido'; cause = 'chave_ausente'; }
      else if (Number.isNaN(prev)) { reason = 'dedupe_perdido'; cause = 'invalido'; } // valor que não é inteiro: tratado como perda
      else if (prev < mirror.value) { reason = 'dedupe_regrediu'; cause = 'regrediu'; }
    }
    if (!reason && down) { reason = 'dedupe_perdido'; cause = 'indisponibilidade'; }

    if (!reason) {
      await writeWatermark(t, HB_KEY, value, now, 'max');
      return mirror ? { state: 'healthy' as const, value } : { state: 'baseline' as const, value };
    }

    // Perda: o domínio decide a fusão e a janela; esta camada só carrega o que já existe e grava o resultado.
    const audit = new DeliveryAudit();
    audit.load(gapsSnapshot(await loadGaps(t)));
    const lastHealthy = mirror?.at ?? down?.at ?? now; // sem nenhuma batida anterior: o próprio instante da detecção
    const gap = audit.reportLoss({ detectedAtMs: now.getTime(), lastHealthyAtMs: lastHealthy.getTime(), reason });
    await saveGap(t, gap);
    // O Redis recomeçou: o espelho passa a ser o valor atual (não o GREATEST), senão a próxima batida acusaria regressão de novo.
    await writeWatermark(t, HB_KEY, value, now, 'set');
    if (down) await deleteWatermark(t, HB_DOWN_ID);
    return { state: 'loss' as const, reason, cause, value, gap };
  });
}

export interface AdRedisWatch { stop(): void; tick(): Promise<void> }

/**
 * Bate na subida e a cada `intervalMs`. Não sobrepõe batidas (se uma ainda corre, a seguinte é pulada). Erro do PostgreSQL vai a `onError`;
 * nunca derruba o processo. O resultado vai a `onResult` (log do worker; sem segredo).
 */
export function startAdRedisWatch(o: {
  db: Db;
  redis: HeartbeatRedis;
  intervalMs?: number;
  now?: () => Date;
  onResult?: (r: HeartbeatResult) => void;
  onError?: (e: unknown) => void;
}): AdRedisWatch {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const r = await heartbeatOnce(o.db, o.redis, { now: o.now }); // antes do ?.(): com onResult ausente o argumento nem seria avaliado
      o.onResult?.(r);
    } catch (e) {
      o.onError?.(e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), o.intervalMs ?? HB_INTERVAL_MS);
  timer.unref?.();
  void tick();
  return { tick, stop: () => clearInterval(timer) };
}

/** Linha de log segura: só estado, motivo, ids e horários. */
export function describeHeartbeat(r: HeartbeatResult): string {
  switch (r.state) {
    case 'loss': return `perda do dedupe detectada: ${r.reason} (${r.cause}); lacuna ${r.gap.id} de ${r.gap.from} até ${r.gap.to}`;
    case 'unreachable': return `redis inacessível desde ${r.since}; o ad server serve sem contar`;
    case 'baseline': return `batida inicial (${r.value})`;
    default: return `saudável (${r.value})`;
  }
}
