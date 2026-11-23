// Saúde do OpenBot pelo último pull. O OpenBot é quem inicia a conexão; se ele para de puxar (PC desligado, processo
// parado), os workers próprios de reserva assumem a fila e a publicação pausa em falha fechada (ADR-003).

export const DEFAULT_STALE_MS = 3 * 60 * 1000;

export type OpenBotHealth =
  | { status: 'sem_contato'; fallbackWorkers: true; pausePublishing: true }
  | { status: 'saudavel'; lastPullAt: string; fallbackWorkers: false; pausePublishing: false }
  | { status: 'atrasado'; lastPullAt: string; silentMs: number; fallbackWorkers: true; pausePublishing: true };

export interface HealthStore {
  markPull(workerId: string, now: Date): Promise<void>;
  last(): Promise<{ workerId: string; at: string } | null>;
}

export class InMemoryHealthStore implements HealthStore {
  private lastPull: { workerId: string; at: string } | null = null;

  async markPull(workerId: string, now: Date) {
    this.lastPull = { workerId, at: now.toISOString() };
  }

  async last() {
    return this.lastPull ? { ...this.lastPull } : null;
  }
}

export async function evaluateHealth(store: HealthStore, now: Date, staleMs: number = DEFAULT_STALE_MS): Promise<OpenBotHealth> {
  const last = await store.last();
  if (!last) return { status: 'sem_contato', fallbackWorkers: true, pausePublishing: true };
  const silentMs = now.getTime() - Date.parse(last.at);
  if (silentMs > staleMs) return { status: 'atrasado', lastPullAt: last.at, silentMs, fallbackWorkers: true, pausePublishing: true };
  return { status: 'saudavel', lastPullAt: last.at, fallbackWorkers: false, pausePublishing: false };
}
