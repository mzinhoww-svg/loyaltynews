/** Escrita no adaptador recusada por falta da capability do publicador. Público: serve só para identificar o erro. */
export class WriteRefused extends Error {
  readonly reason: 'sem_capability' | 'capability_ja_vinculada';
  constructor(reason: WriteRefused['reason'], message?: string) {
    super(message ?? `escrita no mLabs recusada: ${reason}`);
    this.name = 'WriteRefused';
    this.reason = reason;
  }
}
