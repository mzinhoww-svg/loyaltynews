import { z } from 'zod';
import { EvidenceRef, Id, IsoDate } from './common';

/** @deprecated Rodada 3: use o modelo temporal abaixo (ver mapeamento). */
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
/** @deprecated Rodada 3: use o modelo temporal abaixo (ver mapeamento). */
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

/** @deprecated Rodada 3: use o modelo temporal abaixo (ver mapeamento). */
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

/** @deprecated Rodada 3: use o modelo temporal abaixo (ver mapeamento). */
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

/*
 * ---------------------------------------------------------------------------------------------
 * Modelo temporal do Entity Intelligence (Frente 08; banco: schema `intelligence`, migração 0006).
 * Decisão do Chief Architect (rodada de integração 3): ESTE é o modelo oficial de entidades.
 * Os schemas acima (Company, Person, Role, Move) e as tabelas public.companies/people/roles/moves
 * do scaffold ficam OBSOLETOS e saem numa rodada seguinte, quando a rota de entidades da Frente 02
 * passar a usar os handlers de @ln/intelligence. Mapeamento:
 *   Company  -> OrganizationView (legal_name/trade_name/kind + evidence)
 *   Person   -> PersonView (full_name + evidence; cargo e empresa vêm de PersonRoleView, P4)
 *   Role     -> PersonRoleView (title, valid_from/valid_to, certainty, validated_at, evidence)
 *   Move     -> MoveView (kind, basis, status detected/confirmed/rejected, effective_date, observed_on)
 *   origem declarado/inferido -> certainty declared/inferred (inferido nunca exibido como fato)
 * Campos em snake_case, iguais aos que os handlers devolvem (src/queries.ts, src/views.ts).
 * ---------------------------------------------------------------------------------------------
 */
export const Certainty = z.enum(['declared', 'inferred']);
export type Certainty = z.infer<typeof Certainty>;

/** Evidência exibida: fonte, data de coleta e marca de mock (a UI escreve MOCK quando is_mock). */
export const IntelEvidence = z.object({
  id: z.uuid(),
  source_url: z.url(),
  source_name: z.string().min(1),
  retrieved_at: z.iso.datetime({ offset: true }),
  is_mock: z.boolean(),
});
export type IntelEvidence = z.infer<typeof IntelEvidence>;

export const OrganizationView = z.object({
  id: z.uuid(),
  legal_name: z.string().min(1),
  trade_name: z.string().nullable(),
  kind: z.enum(['company', 'program', 'association', 'regulator', 'media', 'other']),
  evidence: IntelEvidence,
  observed_at: z.iso.datetime({ offset: true }),
});
export type OrganizationView = z.infer<typeof OrganizationView>;

/** P4: só o nome (+ URL de perfil público para desambiguar), com evidência. */
export const PersonView = z.strictObject({
  id: z.uuid(),
  full_name: z.string().min(1),
  public_profile_url: z.url().nullable().optional(),
  evidence: IntelEvidence,
  observed_at: z.iso.datetime({ offset: true }).optional(),
});
export type PersonView = z.infer<typeof PersonView>;

const temporal = {
  valid_from: z.iso.date(),
  valid_to: z.iso.date().nullable(),
  certainty: Certainty,
  validated_at: z.iso.datetime({ offset: true }),
  evidence: IntelEvidence,
};

export const PersonRoleView = z
  .object({ role_id: z.uuid(), organization_id: z.uuid(), organization: z.string().min(1), title: z.string().min(1), ...temporal })
  .refine((r) => r.valid_to === null || r.valid_to >= r.valid_from, { message: 'valid_to anterior a valid_from', path: ['valid_to'] });
export type PersonRoleView = z.infer<typeof PersonRoleView>;

export const RelationView = z.object({
  id: z.uuid(),
  type: z.enum(['parent_of', 'partner_of', 'supplier_of', 'coalition_member', 'acquired', 'other']),
  direction: z.enum(['from', 'to']),
  other_org_id: z.uuid(),
  other_org_name: z.string().min(1),
  ...temporal,
});
export type RelationView = z.infer<typeof RelationView>;

export const MoveView = z.object({
  id: z.uuid(),
  kind: z.enum(['appointment', 'departure', 'title_change', 'org_change']),
  basis: z.enum(['announcement', 'observed_diff']),
  /** Portal mostra só `confirmed`; Studio mostra todos, rotulados. */
  status: z.enum(['detected', 'confirmed', 'rejected']),
  person_id: z.uuid(),
  person_name: z.string().min(1),
  from_organization: z.string().nullable(),
  from_title: z.string().nullable(),
  to_organization: z.string().nullable(),
  to_title: z.string().nullable(),
  /** Só quando a fonte declara a data. */
  effective_date: z.iso.date().nullable(),
  observed_on: z.iso.date(),
  evidence: IntelEvidence,
});
export type MoveView = z.infer<typeof MoveView>;

/** Contrato de ingestão role-observation/1 (INGESTION_CONTRACT.md do @ln/intelligence). */
export const RoleObservation = z.object({
  personName: z.string().min(1),
  publicProfileUrl: z.url().optional(),
  orgName: z.string().min(1),
  title: z.string().min(1),
  evidenceId: z.uuid(),
  observedAt: z.iso.datetime({ offset: true }),
  kind: z.enum(['present', 'left']),
  announcement: z.object({ effectiveDate: z.iso.date().optional() }).optional(),
  /** Campos além de nome/cargo/empresa: recusados com a flag de dado ampliado desligada. */
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type RoleObservation = z.infer<typeof RoleObservation>;
