import { z } from 'zod';
import { EvidenceRef, Id, IsoDate } from './common';

export const Company = z.object({
  id: Id,
  nome: z.string().min(1),
  nomeLegal: z.string().min(1).optional(),
  site: z.url().optional(),
  setor: z.string().min(1).optional(),
  fontes: z.array(EvidenceRef).min(1),
});
export type Company = z.infer<typeof Company>;

/**
 * Pessoa (DP-11/P4): só nome, cargo e empresa, com a fonte pública. Nada além —
 * o objeto é estrito e recusa qualquer outro campo (contato, identificador, vida privada).
 * Ingestão atrás da flag `intelligencePessoas` (desligada) até as condições de J-01.
 */
export const Person = z.strictObject({
  id: Id,
  nome: z.string().min(1),
  cargo: z.string().min(1),
  empresaId: Id,
  fonte: EvidenceRef,
});
export type Person = z.infer<typeof Person>;

/** Origem do vínculo: hierarquia inferida nunca é mostrada como fato (Blueprint §1). */
export const LinkOrigin = z.enum(['declarado', 'inferido']);

export const Role = z
  .object({
    id: Id,
    personId: Id,
    companyId: Id,
    cargo: z.string().min(1),
    validFrom: IsoDate,
    validTo: IsoDate.nullable(),
    evidencia: EvidenceRef,
    origem: LinkOrigin,
  })
  .refine((r) => r.validTo === null || r.validTo >= r.validFrom, { message: 'validTo anterior a validFrom', path: ['validTo'] });
export type Role = z.infer<typeof Role>;

export const Move = z.object({
  id: Id,
  personId: Id,
  deCompanyId: Id.nullable(),
  paraCompanyId: Id,
  cargoNovo: z.string().min(1),
  data: IsoDate,
  evidencia: EvidenceRef,
  origem: LinkOrigin,
});
export type Move = z.infer<typeof Move>;
