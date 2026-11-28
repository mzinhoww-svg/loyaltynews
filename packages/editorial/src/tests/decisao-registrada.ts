import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** A decisão que uma lista cita tem entrada própria em governance/decisions.yaml? Só o 5º ato (raiz) inscreve. */
export const decisaoInscrita = (id: string): boolean =>
  new RegExp(`"id":\\s*"${id}"`).test(readFileSync(resolve(__dirname, '../../../../governance/decisions.yaml'), 'utf8'));
