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

/* --- Watchlists, alertas, organograma e grafo (ft/intelligence 6280255: src/api.ts, views.ts, queries.ts, graph.ts).
 *     Validam o JSON trocado pela API (datas como string ISO). Entradas em camelCase, respostas em snake_case,
 *     como nos handlers. Alertas e watchlists são só do Studio; o portal não os expõe. --- */
const Ts = z.iso.datetime({ offset: true });

export const WatchlistSummary = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(120),
  owner_ref: z.string().min(1),
  items: z.number().int().min(0),
  pending_alerts: z.number().int().min(0),
});
export type WatchlistSummary = z.infer<typeof WatchlistSummary>;

export const WatchlistItemView = z.object({
  entity_type: z.enum(['organization', 'person']),
  entity_id: z.uuid(),
  name: z.string().nullable(),
});
export type WatchlistItemView = z.infer<typeof WatchlistItemView>;

export const CreateWatchlistInput = z.object({ name: z.string().trim().min(1).max(120) });
export const AddWatchlistItemInput = z.object({ watchlistId: z.uuid(), entityType: z.enum(['organization', 'person']), entityId: z.uuid() });

export const AlertStatus = z.enum(['pending_review', 'approved', 'rejected']);
/** Alerta nasce pending_review; só vira approved/rejected por revisão registrada. */
export const AlertView = z.object({
  id: z.uuid(),
  watchlist_id: z.uuid(),
  status: AlertStatus,
  kind: z.enum(['appointment', 'departure', 'title_change', 'org_change']),
  person_name: z.string().min(1),
  basis: z.enum(['announcement', 'observed_diff']),
  evidence_id: z.uuid(),
  observed_on: z.iso.date(),
  reviewed_by: z.string().nullable(),
});
export type AlertView = z.infer<typeof AlertView>;
export const ListAlertsQuery = z.object({ status: AlertStatus.optional(), watchlistId: z.uuid().optional() });
export const ReviewAlertInput = z.object({ id: z.uuid(), status: z.enum(['approved', 'rejected']) });
/** Revisão de Move: só a partir de `detected` (409 already_reviewed caso contrário). */
export const ReviewMoveInput = z.object({ id: z.uuid(), status: z.enum(['confirmed', 'rejected']) });

/** Aresta do organograma: inferida nunca como fato (display_label 'inferido — não confirmado'). */
export const OrgChartEdgeView = z
  .object({
    superior_name: z.string().min(1),
    superior_title: z.string().min(1),
    subordinate_name: z.string().min(1),
    subordinate_title: z.string().min(1),
    certainty: Certainty,
    display_label: z.string().min(1),
    evidence_id: z.uuid(),
    observed_at: Ts,
    validated_at: Ts,
  })
  .refine((e) => e.certainty === 'declared' || !e.display_label.startsWith('fato'), {
    message: 'aresta inferida não pode ser rotulada como fato',
    path: ['display_label'],
  });
export type OrgChartEdgeView = z.infer<typeof OrgChartEdgeView>;
export const OrgChartQuery = z.object({ organizationId: z.uuid(), asOf: z.iso.date().optional(), includeInferred: z.boolean().optional() });
export const OrgChartResponse = z.object({ organization_id: z.uuid(), as_of: z.iso.date(), edges: z.array(OrgChartEdgeView) });
export type OrgChartResponse = z.infer<typeof OrgChartResponse>;

export const GraphNodeType = z.enum(['person', 'organization']);
export const GraphNodeRef = z.object({ type: GraphNodeType, id: z.uuid() });
/** Nó alcançado: `all_declared=false` se alguma aresta do caminho é inferida (não exibir como fato). */
export const GraphReached = z
  .object({
    node_type: GraphNodeType,
    node_id: z.uuid(),
    depth: z.number().int().min(0).max(3),
    path: z.array(z.string().regex(/^(person|organization):[0-9a-f-]{36}$/)),
    edge_ids: z.array(z.uuid()),
    all_declared: z.boolean(),
  })
  .refine((r) => r.path.length === r.depth + 1 && r.edge_ids.length === r.depth, { message: 'caminho incoerente com a profundidade', path: ['path'] });
export type GraphReached = z.infer<typeof GraphReached>;
/** Consulta de vizinhança: no máximo 3 saltos (ADR-009). Inferidas só no Studio, e sempre sinalizadas. */
export const GraphNeighborsQuery = GraphNodeRef.extend({ asOf: z.iso.date().optional(), maxHops: z.number().int().min(1).max(3).default(3), includeInferred: z.boolean().optional() });
export const GraphNeighborsResponse = z.object({ items: z.array(GraphReached), max_hops: z.literal(3) });
export const GraphPathQuery = z.object({ from: GraphNodeRef, to: GraphNodeRef, asOf: z.iso.date().optional(), includeInferred: z.boolean().optional() });
export const GraphPathResponse = z.object({ path: GraphReached.nullable(), max_hops: z.literal(3) });
