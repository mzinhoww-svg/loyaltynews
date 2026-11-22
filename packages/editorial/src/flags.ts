import { FLAG_DEFAULTS, isEnabled } from '@ln/contracts';
import type { FlagName, FlagState } from '@ln/contracts';

/**
 * Flags da fábrica editorial vêm de @ln/contracts (fonte única, todas desligadas por padrão):
 * `editorialCollector`, `editorialPipeline`, `instagram`, `theLoyal`. Aqui só há o guarda.
 */
export type EditorialFlagOverrides = Partial<FlagState>;

export class FlagDisabled extends Error {
  flag: string;
  constructor(flag: string) { super(`flag desligada: ${flag}`); this.flag = flag; }
}

export function requireFlag(flags: EditorialFlagOverrides | undefined, name: FlagName): void {
  if (!isEnabled(name, flags)) throw new FlagDisabled(name);
}

export { FLAG_DEFAULTS, isEnabled };
export type { FlagName, FlagState };
