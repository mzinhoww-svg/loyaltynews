import type { Db } from './db.ts';
import type { Certainty, Uuid } from './types.ts';

const S = 'intelligence';

export interface EvidenceRef {
  id: Uuid;
  source_url: string;
  source_name: string;
  retrieved_at: string;
  /** true = dado de teste; a interface deve exibir o texto MOCK. */
  is_mock: boolean;
}

export interface OrganizationRow {
  id: Uuid;
  legal_name: string;
  trade_name: string | null;
  kind: string;
  evidence: EvidenceRef;
  observed_at: string;
}

const EVIDENCE_COLS = `ev.id AS ev_id, ev.source_url AS ev_url, ev.source_name AS ev_name, ev.retrieved_at AS ev_retrieved, ev.is_mock AS ev_mock`;
export const toEvidence = (r: Record<string, any>): EvidenceRef => ({
  id: r.ev_id, source_url: r.ev_url, source_name: r.ev_name, retrieved_at: new Date(r.ev_retrieved).toISOString(), is_mock: r.ev_mock,
});

export async function getOrganization(db: Db, id: Uuid): Promise<OrganizationRow | null> {
  const r = await db.query<any>(
    `SELECT o.id, o.legal_name, o.trade_name, o.kind, o.observed_at, ${EVIDENCE_COLS}
       FROM ${S}.organization o JOIN ${S}.evidence ev ON ev.id = o.evidence_id WHERE o.id = $1`,
    [id],
  );
  const x = r.rows[0];
  return x ? { id: x.id, legal_name: x.legal_name, trade_name: x.trade_name, kind: x.kind, observed_at: new Date(x.observed_at).toISOString(), evidence: toEvidence(x) } : null;
}

export async function searchOrganizations(db: Db, q: string, limit = 20): Promise<Pick<OrganizationRow, 'id' | 'legal_name' | 'trade_name' | 'kind'>[]> {
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`).toLowerCase()}%`;
  const r = await db.query<any>(
    `SELECT id, legal_name, trade_name, kind FROM ${S}.organization
      WHERE lower(legal_name) LIKE $1 OR lower(coalesce(trade_name,'')) LIKE $1 OR normalized_name LIKE $1
      ORDER BY legal_name LIMIT $2`,
    [term, Math.min(Math.max(limit, 1), 100)],
  );
  return r.rows;
}

export interface RelationRow {
  id: Uuid;
  type: string;
  direction: 'from' | 'to';
  other_org_id: Uuid;
  other_org_name: string;
  valid_from: string;
  valid_to: string | null;
  certainty: Certainty;
  validated_at: string;
  evidence: EvidenceRef;
}

export async function getOrgRelations(db: Db, organizationId: Uuid, asOf: string, includeInferred: boolean): Promise<RelationRow[]> {
  const r = await db.query<any>(
    `SELECT x.id, x.relation_type AS type, CASE WHEN x.from_org_id = $1 THEN 'from' ELSE 'to' END AS direction,
            o.id AS other_org_id, o.legal_name AS other_org_name, x.valid_from::text, x.valid_to::text, x.certainty, x.validated_at, ${EVIDENCE_COLS}
       FROM ${S}.org_relation x
       JOIN ${S}.organization o ON o.id = CASE WHEN x.from_org_id = $1 THEN x.to_org_id ELSE x.from_org_id END
       JOIN ${S}.evidence ev ON ev.id = x.evidence_id
      WHERE (x.from_org_id = $1 OR x.to_org_id = $1) AND x.valid_from <= $2::date AND (x.valid_to IS NULL OR x.valid_to > $2::date)
        AND ($3::boolean OR x.certainty = 'declared')
      ORDER BY o.legal_name, x.relation_type`,
    [organizationId, asOf, includeInferred],
  );
  return r.rows.map((x) => ({ ...x, validated_at: new Date(x.validated_at).toISOString(), evidence: toEvidence(x) }));
}

export interface PersonRoleRow {
  role_id: Uuid;
  organization_id: Uuid;
  organization: string;
  title: string;
  valid_from: string;
  valid_to: string | null;
  certainty: Certainty;
  validated_at: string;
  evidence: EvidenceRef;
}

/** Cargos de uma pessoa não suprimida (histórico completo, ordem cronológica). */
export async function getPersonRoles(db: Db, personId: Uuid, includeInferred: boolean): Promise<PersonRoleRow[]> {
  const r = await db.query<any>(
    `SELECT r.id AS role_id, r.organization_id, o.legal_name AS organization, r.title, r.valid_from::text, r.valid_to::text,
            r.certainty, r.validated_at, ${EVIDENCE_COLS}
       FROM ${S}.role_assignment r
       JOIN ${S}.person p ON p.id = r.person_id AND p.suppressed_at IS NULL
       JOIN ${S}.organization o ON o.id = r.organization_id
       JOIN ${S}.evidence ev ON ev.id = r.evidence_id
      WHERE r.person_id = $1 AND ($2::boolean OR r.certainty = 'declared')
      ORDER BY r.valid_from, r.title`,
    [personId, includeInferred],
  );
  return r.rows.map((x) => ({ ...x, validated_at: new Date(x.validated_at).toISOString(), evidence: toEvidence(x) }));
}

export interface PersonRow { id: Uuid; full_name: string; public_profile_url: string | null; evidence: EvidenceRef; observed_at: string }
export async function getPerson(db: Db, id: Uuid): Promise<PersonRow | null> {
  const r = await db.query<any>(
    `SELECT p.id, p.full_name, p.public_profile_url, p.observed_at, ${EVIDENCE_COLS}
       FROM ${S}.person p JOIN ${S}.evidence ev ON ev.id = p.evidence_id WHERE p.id = $1 AND p.suppressed_at IS NULL`,
    [id],
  );
  const x = r.rows[0];
  return x ? { id: x.id, full_name: x.full_name, public_profile_url: x.public_profile_url, observed_at: new Date(x.observed_at).toISOString(), evidence: toEvidence(x) } : null;
}

export async function searchPeople(db: Db, q: string, limit = 20): Promise<{ id: Uuid; full_name: string }[]> {
  const term = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`).toLowerCase()}%`;
  const r = await db.query<any>(
    `SELECT id, full_name FROM ${S}.person WHERE suppressed_at IS NULL AND (lower(full_name) LIKE $1 OR normalized_name LIKE $1)
      ORDER BY full_name LIMIT $2`,
    [term, Math.min(Math.max(limit, 1), 100)],
  );
  return r.rows;
}

export interface MoveView {
  id: Uuid;
  kind: string;
  basis: 'announcement' | 'observed_diff';
  status: 'detected' | 'confirmed' | 'rejected';
  person_id: Uuid;
  person_name: string;
  from_organization: string | null;
  from_title: string | null;
  to_organization: string | null;
  to_title: string | null;
  effective_date: string | null;
  observed_on: string;
  evidence: EvidenceRef;
}

export async function listMoveViews(
  db: Db,
  f: { status?: MoveView['status'][]; personId?: Uuid; organizationId?: Uuid; limit?: number; offset?: number } = {},
): Promise<MoveView[]> {
  const r = await db.query<any>(
    `SELECT m.id, m.kind, m.basis, m.status, m.person_id, p.full_name AS person_name,
            fo.legal_name AS from_organization, fr.title AS from_title, tor.legal_name AS to_organization, tr.title AS to_title,
            m.effective_date::text, m.observed_on::text, ${EVIDENCE_COLS}
       FROM ${S}.move m
       JOIN ${S}.person p ON p.id = m.person_id AND p.suppressed_at IS NULL
       JOIN ${S}.evidence ev ON ev.id = m.evidence_id
       LEFT JOIN ${S}.role_assignment fr ON fr.id = m.from_role_id LEFT JOIN ${S}.organization fo ON fo.id = fr.organization_id
       LEFT JOIN ${S}.role_assignment tr ON tr.id = m.to_role_id LEFT JOIN ${S}.organization tor ON tor.id = tr.organization_id
      WHERE ($1::text[] IS NULL OR m.status = ANY($1::text[]))
        AND ($2::uuid IS NULL OR m.person_id = $2)
        AND ($3::uuid IS NULL OR fr.organization_id = $3 OR tr.organization_id = $3)
      ORDER BY m.observed_on DESC, m.detected_at DESC, m.id
      LIMIT $4 OFFSET $5`,
    [f.status ?? null, f.personId ?? null, f.organizationId ?? null, Math.min(Math.max(f.limit ?? 50, 1), 200), Math.max(f.offset ?? 0, 0)],
  );
  return r.rows.map((x) => ({ ...x, evidence: toEvidence(x) }));
}

export async function listWatchlists(db: Db, ownerRef?: string) {
  const r = await db.query<{ id: Uuid; name: string; owner_ref: string; items: string; pending_alerts: string }>(
    `SELECT w.id, w.name, w.owner_ref,
            (SELECT count(*) FROM ${S}.watchlist_item i WHERE i.watchlist_id = w.id)::text AS items,
            (SELECT count(*) FROM ${S}.alert a WHERE a.watchlist_id = w.id AND a.status = 'pending_review')::text AS pending_alerts
       FROM ${S}.watchlist w WHERE ($1::text IS NULL OR w.owner_ref = $1) ORDER BY w.created_at, w.id`,
    [ownerRef ?? null],
  );
  return r.rows.map((x) => ({ id: x.id, name: x.name, owner_ref: x.owner_ref, items: Number(x.items), pending_alerts: Number(x.pending_alerts) }));
}

export async function listWatchlistItems(db: Db, watchlistId: Uuid) {
  const r = await db.query<{ entity_type: 'organization' | 'person'; entity_id: Uuid; name: string | null }>(
    `SELECT i.entity_type, i.entity_id,
            CASE i.entity_type WHEN 'organization' THEN o.legal_name ELSE p.full_name END AS name
       FROM ${S}.watchlist_item i
       LEFT JOIN ${S}.organization o ON i.entity_type = 'organization' AND o.id = i.entity_id
       LEFT JOIN ${S}.person p ON i.entity_type = 'person' AND p.id = i.entity_id AND p.suppressed_at IS NULL
      WHERE i.watchlist_id = $1 AND (i.entity_type = 'organization' OR p.id IS NOT NULL)
      ORDER BY i.entity_type, name`,
    [watchlistId],
  );
  return r.rows;
}
