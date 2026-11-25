// Retenção do código de IP do audit_log (decisão do PM, 25/11): depois de 12 meses o IP (já só o HMAC h1:) é ANULADO. Dono: Frente 02 — LN Backend Engineer.
//  - É a única exceção ao append-only (migração 0033): UPDATE só da coluna ip, só para NULL; a linha e todo o resto do registro ficam. Apagar linha continua proibido.
//  - Roda na subida e uma vez por dia. Só a contagem vai ao log. Fronteira: "há mais de 12 meses" (12 meses menos 1 dia fica; mais 1 dia anula).
import { sql } from 'drizzle-orm';
import type { Db } from '@ln/auth';

export const AUDIT_IP_MESES = 12;

export async function purgeAuditIps(db: Db, now: Date = new Date()): Promise<number> {
  const r = await db.execute(sql`UPDATE audit_log SET ip = NULL WHERE ip IS NOT NULL AND at < ${now}::timestamptz - make_interval(months => ${AUDIT_IP_MESES}) RETURNING 1`);
  return r.rows.length;
}

export function startAuditIpRetention(o: { db: Db; intervalMs?: number; now?: () => Date; onResult?: (n: number) => void; onError?: (e: unknown) => void }): { stop(): void; tick(): Promise<void> } {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const n = await purgeAuditIps(o.db, (o.now ?? (() => new Date()))()); // antes do ?.(): com onResult ausente o argumento nem seria avaliado
      o.onResult?.(n);
    } catch (e) {
      o.onError?.(e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), o.intervalMs ?? 24 * 3_600_000);
  timer.unref?.();
  void tick();
  return { tick, stop: () => clearInterval(timer) };
}
