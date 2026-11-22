// Portão de saldo do provedor (DP-14). O saldo pré-pago do OpenRouter é um limite real além do teto de US$ 50.
// Lê o saldo antes da primeira chamada e a cada N retenções. Entre leituras, mantém uma estimativa conservadora:
// saldo lido - retenções ainda não liquidadas (pendentes contam como gasto). Tudo em micro-USD inteiro.
import { microToUsd, usdToMicro } from './money';

export type HoldResult =
  | { ok: true }
  | { ok: false; reason: 'balance_unknown' | 'insufficient_balance'; detail: string };

export class BalanceGuard {
  private readonly readBalance: () => Promise<number>;
  private readonly refreshEvery: number;
  private lastReadMicro: number | null = null;
  private outstandingMicro = 0;
  private holdsSinceRead = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readBalance: () => Promise<number>, refreshEvery = 10) {
    this.readBalance = readBalance;
    this.refreshEvery = refreshEvery;
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // Retém o valor máximo de uma chamada antes da reserva. Recusa se o saldo estimado não cobre.
  hold(usd: number): Promise<HoldResult> {
    return this.locked(async (): Promise<HoldResult> => {
      if (this.lastReadMicro === null || this.holdsSinceRead >= this.refreshEvery) {
        try {
          this.lastReadMicro = usdToMicro(await this.readBalance());
          this.holdsSinceRead = 0;
        } catch {
          return { ok: false, reason: 'balance_unknown', detail: 'leitura de saldo falhou; chamada não sai' };
        }
      }
      const holdMicro = usdToMicro(usd);
      const effective = this.lastReadMicro - this.outstandingMicro;
      if (effective - holdMicro < 0) {
        return {
          ok: false,
          reason: 'insufficient_balance',
          detail: `saldo efetivo US$ ${microToUsd(effective).toFixed(4)} não cobre US$ ${usd.toFixed(4)}`,
        };
      }
      this.outstandingMicro += holdMicro;
      this.holdsSinceRead += 1;
      return { ok: true };
    });
  }

  // Liquida uma retenção: tira da pendência e desconta o custo real. Liberação = actualUsd 0.
  settle(heldUsd: number, actualUsd: number): Promise<void> {
    return this.locked(async () => {
      this.outstandingMicro = Math.max(0, this.outstandingMicro - usdToMicro(heldUsd));
      if (this.lastReadMicro !== null) this.lastReadMicro -= usdToMicro(actualUsd);
    });
  }

  // Saldo estimado agora, em USD (para diagnóstico e testes).
  estimate(): number | null {
    return this.lastReadMicro === null ? null : microToUsd(this.lastReadMicro - this.outstandingMicro);
  }
}
