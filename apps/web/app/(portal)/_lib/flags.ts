/**
 * Flags do portal, desligadas por padrão (regra 3 do fast-track).
 * TODO(contracts): migrar para `packages/contracts/flags.ts` (Chief Architect) quando existir.
 * Ligar só via variável de ambiente explícita.
 */
const on = (v: string | undefined) => v === '1' || v === 'true';

export const flags = {
  /** The Loyal (newsletter): construída, entrega desligada até P-01/P-02. */
  theLoyal: on(process.env.NEXT_PUBLIC_FLAG_THE_LOYAL),
  /** Instagram: construído, desligado. */
  instagram: on(process.env.NEXT_PUBLIC_FLAG_INSTAGRAM),
  /** Formulários que dependem de API (contato, proposta). */
  forms: on(process.env.NEXT_PUBLIC_FLAG_FORMS),
  /** Market Data (fase 2). */
  marketData: on(process.env.NEXT_PUBLIC_FLAG_MARKET_DATA),
  /** Podcast / Loyalty Talks. */
  podcast: on(process.env.NEXT_PUBLIC_FLAG_PODCAST),
} as const;
