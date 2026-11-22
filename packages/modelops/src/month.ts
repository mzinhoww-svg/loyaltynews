// Mês de contagem do orçamento: calendário de America/Sao_Paulo (ADR-015).
// Os contadores são derivados do ledger por mês, então a virada zera uma vez, sem reset explícito.

const TZ = 'America/Sao_Paulo';

export function monthKey(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(at);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  return `${year}-${month}`;
}
