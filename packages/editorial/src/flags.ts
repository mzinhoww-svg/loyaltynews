/**
 * Flags locais da fábrica editorial. Todas DESLIGADAS por padrão (fast-track regra 3).
 * TODO(Chief Architect): migrar para packages/contracts/flags.ts quando existir.
 */
export interface EditorialFlags {
  'editorial.collector.enabled': boolean;
  'editorial.pipeline.enabled': boolean;
  'editorial.social.instagram': boolean;
  'editorial.social.the_loyal': boolean;
}

export const DEFAULT_FLAGS: Readonly<EditorialFlags> = Object.freeze({
  'editorial.collector.enabled': false,
  'editorial.pipeline.enabled': false,
  'editorial.social.instagram': false,
  'editorial.social.the_loyal': false,
});

export class FlagDisabled extends Error {
  flag: string;
  constructor(flag: string) { super(`flag desligada: ${flag}`); this.flag = flag; }
}

export function requireFlag(flags: Partial<EditorialFlags> | undefined, name: keyof EditorialFlags): void {
  const v = flags?.[name] ?? DEFAULT_FLAGS[name];
  if (!v) throw new FlagDisabled(name);
}
