import type { Channel } from './types.ts';

// Flags do Growth. A fonte oficial é packages/contracts/flags.ts (Chief Architect); até existir,
// este módulo define os mesmos nomes. TODAS desligadas por padrão (fast-track regra 3 e 5).
export interface GrowthFlags {
  /** Publicação real no LinkedIn via mLabs. Desligada: o adaptador só simula. */
  growth_linkedin_live: boolean;
  /** Instagram construído, flag desligada até P-01/DV-01. */
  growth_instagram_enabled: boolean;
  /** The Loyal construído, flag desligada até P-02. */
  growth_the_loyal_enabled: boolean;
}

export const DEFAULT_FLAGS: Readonly<GrowthFlags> = Object.freeze({
  growth_linkedin_live: false,
  growth_instagram_enabled: false,
  growth_the_loyal_enabled: false,
});

export function channelFlag(channel: Channel): keyof GrowthFlags {
  switch (channel) {
    case 'linkedin':
      return 'growth_linkedin_live';
    case 'instagram':
      return 'growth_instagram_enabled';
    case 'the_loyal':
      return 'growth_the_loyal_enabled';
  }
}

/** Lê flags do ambiente (GROWTH_FLAG_<NOME>=1). Qualquer outro valor mantém o padrão desligado. */
export function flagsFromEnv(env: Record<string, string | undefined> = process.env): GrowthFlags {
  const out: GrowthFlags = { ...DEFAULT_FLAGS };
  for (const key of Object.keys(out) as (keyof GrowthFlags)[]) {
    if (env[`GROWTH_FLAG_${key.toUpperCase()}`] === '1') out[key] = true;
  }
  return out;
}
