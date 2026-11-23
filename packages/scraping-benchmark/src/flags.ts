/**
 * Flags do benchmark (Prompt-Mestre §3.4). Todas DESLIGADAS por padrão; só liga com a string exata "true".
 * Proposta para `packages/contracts/flags.ts` (dono: Chief Architect); enquanto não migra, ficam locais ao pacote.
 */
export const SCRAPING_FLAGS = [
  'SCRAPING_BENCHMARK_ENABLED',
  'SCRAPING_ADAPTIVE_ROUTING_ENABLED',
  'SCRAPING_SHADOW_MODE',
  'SCRAPING_PROVIDER_FALLBACK_ENABLED',
] as const;
export type ScrapingFlag = (typeof SCRAPING_FLAGS)[number];
export type FlagState = Record<ScrapingFlag, boolean>;

export function readFlags(env: Record<string, string | undefined> = process.env): FlagState {
  const out = {} as FlagState;
  for (const f of SCRAPING_FLAGS) out[f] = env[f] === 'true';
  return out;
}

/** Provedor desligável individualmente: SCRAPING_PROVIDER_<NOME>_DISABLED=true. */
export function isProviderDisabled(provider: string, env: Record<string, string | undefined> = process.env): boolean {
  return env[`SCRAPING_PROVIDER_${provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_DISABLED`] === 'true';
}
