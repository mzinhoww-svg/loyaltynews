import { FLAG_DEFAULTS, isEnabled, type FlagState } from '@ln/contracts';
import type { Channel } from './types';

// Flags do Growth derivadas de packages/contracts/flags.ts (fonte oficial, Chief Architect).
// Todas desligadas por padrão (fast-track regras 3 e 5). Ligar = decisão registrada, nunca default de código.
export interface GrowthFlags {
  /** Publicação real no LinkedIn via mLabs (contrato: linkedinPublicacao). Desligada: o adaptador só simula. */
  growth_linkedin_live: boolean;
  /** Instagram construído, desligado (contrato: instagram). */
  growth_instagram_enabled: boolean;
  /** The Loyal construído, desligado (contrato: theLoyal). */
  growth_the_loyal_enabled: boolean;
}

/** Converte o estado de flags do produto (com overrides) para as flags do Growth. */
export function growthFlagsFrom(overrides: Partial<FlagState> = {}): GrowthFlags {
  return {
    growth_linkedin_live: isEnabled('linkedinPublicacao', overrides),
    growth_instagram_enabled: isEnabled('instagram', overrides),
    growth_the_loyal_enabled: isEnabled('theLoyal', overrides),
  };
}

export const DEFAULT_FLAGS: Readonly<GrowthFlags> = Object.freeze(growthFlagsFrom({}));

// Garante em tempo de execução que o default do contrato continua "desligado".
if (Object.values(FLAG_DEFAULTS).some((v) => v !== false)) {
  throw new Error('FLAG_DEFAULTS do contrato deve ser todo false');
}

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
