import { z } from 'zod';

/** Identificador estável (texto). UUID ou slug, conforme a entidade. */
export const Id = z.string().min(1).max(128);

export const IsoDateTime = z.iso.datetime({ offset: true });
export const IsoDate = z.iso.date();

/** Classes de dado (contracts/model.policy.json, proposta v4). Classe desconhecida bloqueia. */
export const DataClass = z.enum([
  'public',
  'internal',
  'personal',
  'commercial_confidential',
  'restricted',
  'secret',
]);
export type DataClass = z.infer<typeof DataClass>;

export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 em hexadecimal minúsculo');

/** Evidência capturada pelo coletor determinístico (ADR-007): URL, data e hash. */
export const EvidenceRef = z.object({
  sourceId: Id,
  url: z.url(),
  capturadoEm: IsoDateTime,
  sha256: Sha256,
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

/** Fuso oficial dos rituais e da virada do mês do orçamento. */
export const TIMEZONE = 'America/Sao_Paulo' as const;
