// Retenção do limite de tentativas (`auth_attempt`), LGPD: na subida e a cada hora apaga as linhas que não servem mais (janela iniciada há mais de 24 h e sem
// bloqueio vigente). O formato antigo (IP e e-mail crus) foi apagado pela migração 0030. Dono: Frente 02 — LN Backend Engineer. Só contagens vão ao log: nenhum sujeito.
import { purgeStaleAttempts, type Db } from '@ln/auth';

export interface RetentionResult { antigas: number }

export async function runAttemptRetention(db: Db, now: Date = new Date()): Promise<RetentionResult> {
  return { antigas: await purgeStaleAttempts(db, now) };
}

export function startAttemptRetention(o: { db: Db; intervalMs?: number; now?: () => Date; onResult?: (r: RetentionResult) => void; onError?: (e: unknown) => void }): { stop(): void; tick(): Promise<void> } {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const r = await runAttemptRetention(o.db, (o.now ?? (() => new Date()))());
      o.onResult?.(r);
    } catch (e) {
      o.onError?.(e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), o.intervalMs ?? 3_600_000);
  timer.unref?.();
  void tick();
  return { tick, stop: () => clearInterval(timer) };
}
