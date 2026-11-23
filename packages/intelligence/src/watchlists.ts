import type { Db } from './db';
import { one } from './db';
import type { Uuid } from './types';

const S = 'intelligence';

export async function createWatchlist(db: Db, name: string, ownerRef: string): Promise<Uuid> {
  return (await one<{ id: Uuid }>(db, `INSERT INTO ${S}.watchlist (name, owner_ref) VALUES ($1,$2) RETURNING id`, [name, ownerRef])).id;
}

export async function watch(db: Db, watchlistId: Uuid, entityType: 'organization' | 'person', entityId: Uuid): Promise<void> {
  await db.query(
    `INSERT INTO ${S}.watchlist_item (watchlist_id, entity_type, entity_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [watchlistId, entityType, entityId],
  );
}

/**
 * Gera alertas para Moves que tocam entidades observadas (a pessoa, ou a organização de origem/destino).
 * Todo alerta nasce 'pending_review': nada sai sem revisão humana/agente revisor registrada. Idempotente.
 * Retorna só os alertas criados nesta chamada.
 */
export async function generateAlerts(db: Db, opts: { moveIds?: Uuid[] } = {}): Promise<{ id: Uuid; watchlist_id: Uuid; move_id: Uuid }[]> {
  const r = await db.query<{ id: Uuid; watchlist_id: Uuid; move_id: Uuid }>(
    `INSERT INTO ${S}.alert (watchlist_id, move_id)
     SELECT DISTINCT wi.watchlist_id, m.id
       FROM ${S}.move m
       JOIN ${S}.person p ON p.id = m.person_id AND p.suppressed_at IS NULL
       LEFT JOIN ${S}.role_assignment fr ON fr.id = m.from_role_id
       LEFT JOIN ${S}.role_assignment tr ON tr.id = m.to_role_id
       JOIN ${S}.watchlist_item wi
         ON (wi.entity_type = 'person' AND wi.entity_id = m.person_id)
         OR (wi.entity_type = 'organization' AND wi.entity_id IN (fr.organization_id, tr.organization_id))
      WHERE m.status <> 'rejected' AND ($1::uuid[] IS NULL OR m.id = ANY($1::uuid[]))
     ON CONFLICT (watchlist_id, move_id) DO NOTHING
     RETURNING id, watchlist_id, move_id`,
    [opts.moveIds ?? null],
  );
  return r.rows;
}

export async function reviewAlert(db: Db, alertId: Uuid, status: 'approved' | 'rejected', reviewedBy: string): Promise<void> {
  if (!reviewedBy.trim()) throw new Error('reviewer_required');
  await db.query(
    `UPDATE ${S}.alert SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 AND status = 'pending_review'`,
    [alertId, status, reviewedBy],
  );
}

export async function listAlerts(db: Db, filter: { status?: 'pending_review' | 'approved' | 'rejected'; watchlistId?: Uuid } = {}) {
  const r = await db.query<{
    id: Uuid; watchlist_id: Uuid; status: string; kind: string; person_name: string; basis: string; evidence_id: Uuid;
    observed_on: string; reviewed_by: string | null;
  }>(
    `SELECT a.id, a.watchlist_id, a.status, m.kind, p.full_name AS person_name, m.basis, m.evidence_id, m.observed_on::text, a.reviewed_by
       FROM ${S}.alert a
       JOIN ${S}.move m ON m.id = a.move_id
       JOIN ${S}.person p ON p.id = m.person_id AND p.suppressed_at IS NULL
      WHERE ($1::text IS NULL OR a.status = $1) AND ($2::uuid IS NULL OR a.watchlist_id = $2)
      ORDER BY a.created_at DESC, a.id`,
    [filter.status ?? null, filter.watchlistId ?? null],
  );
  return r.rows;
}
