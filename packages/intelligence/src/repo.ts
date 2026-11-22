import { type Db, one } from './db.ts';
import { DEFAULT_CONFIG, EvidenceRequiredError, ExtendedPersonalDataDisabledError, type IntelligenceConfig } from './config.ts';
import { normalizeName, normalizeOrgName, normalizeTitle } from './normalize.ts';
import type { Certainty, EvidenceInput, Uuid } from './types.ts';

const S = 'intelligence';

export async function addEvidence(db: Db, e: EvidenceInput): Promise<Uuid> {
  const r = await one<{ id: Uuid }>(
    db,
    `INSERT INTO ${S}.evidence (source_url, source_name, source_class, retrieved_at, content_hash, excerpt, is_mock)
     VALUES ($1,$2,'public',$3,$4,$5,$6) RETURNING id`,
    [e.sourceUrl, e.sourceName, e.retrievedAt, e.contentHash ?? null, e.excerpt ?? null, e.isMock ?? false],
  );
  return r.id;
}

export async function upsertOrganization(
  db: Db,
  o: { legalName: string; tradeName?: string; kind?: string; evidenceId: Uuid; observedAt: string },
): Promise<Uuid> {
  if (!o.evidenceId) throw new EvidenceRequiredError('organization');
  const r = await one<{ id: Uuid }>(
    db,
    `INSERT INTO ${S}.organization (legal_name, trade_name, normalized_name, kind, evidence_id, observed_at)
     VALUES ($1,$2,$3,COALESCE($4,'company'),$5,$6)
     ON CONFLICT (normalized_name) DO UPDATE SET trade_name = COALESCE(${S}.organization.trade_name, EXCLUDED.trade_name)
     RETURNING id`,
    [o.legalName, o.tradeName ?? null, normalizeOrgName(o.legalName), o.kind ?? null, o.evidenceId, o.observedAt],
  );
  return r.id;
}

/**
 * Resolve ou cria pessoa (DP-11 P4: só nome, cargo e empresa). Qualquer campo extra é recusado com a flag desligada.
 * Resolução: URL pública de perfil > nome normalizado já associado à mesma organização.
 * Homônimos sem URL nem organização em comum viram pessoas distintas (nunca se funde por nome sozinho).
 */
export async function resolveOrCreatePerson(
  db: Db,
  p: {
    fullName: string;
    publicProfileUrl?: string;
    organizationId?: Uuid;
    evidenceId: Uuid;
    observedAt: string;
    extra?: Record<string, unknown>;
  },
  cfg: IntelligenceConfig = DEFAULT_CONFIG,
): Promise<{ id: Uuid; created: boolean }> {
  if (!p.evidenceId) throw new EvidenceRequiredError('person');
  const extraKeys = Object.keys(p.extra ?? {});
  if (extraKeys.length && !cfg.extendedPersonalData) throw new ExtendedPersonalDataDisabledError(extraKeys);

  const norm = normalizeName(p.fullName);
  if (p.publicProfileUrl) {
    const byUrl = await db.query<{ id: Uuid }>(`SELECT id FROM ${S}.person WHERE public_profile_url = $1`, [p.publicProfileUrl]);
    if (byUrl.rows[0]) return { id: byUrl.rows[0].id, created: false };
  }
  if (p.organizationId) {
    const byOrg = await db.query<{ id: Uuid }>(
      `SELECT DISTINCT p.id FROM ${S}.person p JOIN ${S}.role_assignment r ON r.person_id = p.id
        WHERE p.normalized_name = $1 AND r.organization_id = $2 AND p.suppressed_at IS NULL`,
      [norm, p.organizationId],
    );
    if (byOrg.rows.length === 1) return { id: byOrg.rows[0]!.id, created: false };
  }
  const r = await one<{ id: Uuid }>(
    db,
    `INSERT INTO ${S}.person (full_name, normalized_name, public_profile_url, evidence_id, observed_at)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [p.fullName, norm, p.publicProfileUrl ?? null, p.evidenceId, p.observedAt],
  );
  return { id: r.id, created: true };
}

/** Atributos ampliados: a aplicação e o gatilho do banco recusam com a flag desligada. */
export async function setExtendedAttributes(
  db: Db,
  personId: Uuid,
  attributes: Record<string, unknown>,
  prov: { evidenceId: Uuid; observedAt: string },
  cfg: IntelligenceConfig = DEFAULT_CONFIG,
): Promise<void> {
  if (!cfg.extendedPersonalData) throw new ExtendedPersonalDataDisabledError(Object.keys(attributes));
  await db.query(
    `INSERT INTO ${S}.person_extended (person_id, attributes, evidence_id, observed_at) VALUES ($1,$2,$3,$4)`,
    [personId, JSON.stringify(attributes), prov.evidenceId, prov.observedAt],
  );
}

export async function addRole(
  db: Db,
  r: {
    personId: Uuid;
    organizationId: Uuid;
    title: string;
    validFrom: string;
    validTo?: string | null;
    certainty?: Certainty;
    inferenceBasis?: string;
    evidenceId: Uuid;
    observedAt: string;
    validatedAt?: string;
  },
): Promise<Uuid> {
  if (!r.evidenceId) throw new EvidenceRequiredError('role');
  const row = await one<{ id: Uuid }>(
    db,
    `INSERT INTO ${S}.role_assignment
       (person_id, organization_id, title, normalized_title, valid_from, valid_to, certainty, inference_basis, evidence_id, observed_at, validated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [r.personId, r.organizationId, r.title, normalizeTitle(r.title), r.validFrom, r.validTo ?? null, r.certainty ?? 'declared',
     r.inferenceBasis ?? null, r.evidenceId, r.observedAt, r.validatedAt ?? r.observedAt],
  );
  return row.id;
}

export async function closeRole(db: Db, roleId: Uuid, validTo: string): Promise<void> {
  await db.query(`UPDATE ${S}.role_assignment SET valid_to = $2 WHERE id = $1 AND valid_to IS NULL`, [roleId, validTo]);
}

export async function revalidateRole(db: Db, roleId: Uuid, validatedAt: string, evidenceId: Uuid): Promise<void> {
  await db.query(`UPDATE ${S}.role_assignment SET validated_at = $2, evidence_id = $3 WHERE id = $1`, [roleId, validatedAt, evidenceId]);
}

export async function addOrgRelation(
  db: Db,
  r: {
    fromOrgId: Uuid;
    toOrgId: Uuid;
    type: 'parent_of' | 'partner_of' | 'supplier_of' | 'coalition_member' | 'acquired' | 'other';
    validFrom: string;
    validTo?: string | null;
    certainty?: Certainty;
    inferenceBasis?: string;
    evidenceId: Uuid;
    observedAt: string;
    validatedAt?: string;
  },
): Promise<Uuid> {
  const row = await one<{ id: Uuid }>(
    db,
    `INSERT INTO ${S}.org_relation
       (from_org_id,to_org_id,relation_type,valid_from,valid_to,certainty,inference_basis,evidence_id,observed_at,validated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [r.fromOrgId, r.toOrgId, r.type, r.validFrom, r.validTo ?? null, r.certainty ?? 'declared', r.inferenceBasis ?? null,
     r.evidenceId, r.observedAt, r.validatedAt ?? r.observedAt],
  );
  return row.id;
}

/** Linha de reporte. 'declared' exige que a fonte afirme; sem isso use 'inferred' + base (aparece rotulada). */
export async function addOrgChartEdge(
  db: Db,
  e: {
    organizationId: Uuid;
    superiorRoleId: Uuid;
    subordinateRoleId: Uuid;
    validFrom: string;
    validTo?: string | null;
    certainty: Certainty;
    inferenceBasis?: string;
    evidenceId: Uuid;
    observedAt: string;
    validatedAt?: string;
  },
): Promise<Uuid> {
  const row = await one<{ id: Uuid }>(
    db,
    `INSERT INTO ${S}.org_chart_edge
       (organization_id,superior_role_id,subordinate_role_id,valid_from,valid_to,certainty,inference_basis,evidence_id,observed_at,validated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [e.organizationId, e.superiorRoleId, e.subordinateRoleId, e.validFrom, e.validTo ?? null, e.certainty, e.inferenceBasis ?? null,
     e.evidenceId, e.observedAt, e.validatedAt ?? e.observedAt],
  );
  return row.id;
}

/** Organograma de uma organização numa data, com rótulo de certeza. Inferidas só se solicitado (e sempre rotuladas). */
export async function getOrgChart(db: Db, organizationId: Uuid, asOf: string, opts: { includeInferred?: boolean } = {}) {
  const r = await db.query<{
    superior_name: string; superior_title: string; subordinate_name: string; subordinate_title: string;
    certainty: Certainty; display_label: string; evidence_id: Uuid; validated_at: string; observed_at: string;
  }>(
    `SELECT superior_name, superior_title, subordinate_name, subordinate_title, certainty, display_label, evidence_id, observed_at, validated_at
       FROM ${S}.org_chart_view
      WHERE organization_id = $1 AND valid_from <= $2 AND (valid_to IS NULL OR valid_to > $2)
        AND ($3 OR certainty = 'declared')
      ORDER BY superior_name, subordinate_name`,
    [organizationId, asOf, opts.includeInferred ?? false],
  );
  return r.rows;
}

/** Linha do tempo de cargos de uma pessoa (vazia se a pessoa foi suprimida). */
export async function getRoleHistory(db: Db, personId: Uuid) {
  const r = await db.query<{
    organization: string; title: string; valid_from: string; valid_to: string | null; certainty: Certainty;
    evidence_id: Uuid; observed_at: string; validated_at: string;
  }>(
    `SELECT o.legal_name AS organization, r.title, r.valid_from::text, r.valid_to::text, r.certainty, r.evidence_id, r.observed_at, r.validated_at
       FROM ${S}.role_assignment r
       JOIN ${S}.organization o ON o.id = r.organization_id
       JOIN ${S}.person p ON p.id = r.person_id AND p.suppressed_at IS NULL
      WHERE r.person_id = $1 ORDER BY r.valid_from`,
    [personId],
  );
  return r.rows;
}
