import type { Db } from './db.ts';
import { one } from './db.ts';
import type { Uuid } from './types.ts';

const S = 'intelligence';

export async function openSubjectRequest(db: Db, personId: Uuid, kind: 'access' | 'rectification' | 'suppression', note?: string): Promise<Uuid> {
  return (await one<{ id: Uuid }>(
    db,
    `INSERT INTO ${S}.data_subject_request (person_id, kind, note) VALUES ($1,$2,$3) RETURNING id`,
    [personId, kind, note ?? null],
  )).id;
}

/** Acesso: devolve tudo o que guardamos da pessoa (nome, cargos, evidências), mesmo se suprimida não retorna nada além do pedido. */
export async function exportPersonData(db: Db, personId: Uuid) {
  const person = await db.query(
    `SELECT id, full_name, public_profile_url, evidence_id, observed_at FROM ${S}.person WHERE id = $1 AND suppressed_at IS NULL`,
    [personId],
  );
  const roles = await db.query(
    `SELECT organization_id, title, valid_from::text, valid_to::text, certainty, evidence_id, validated_at FROM ${S}.role_assignment WHERE person_id = $1`,
    [personId],
  );
  return { person: person.rows[0] ?? null, roles: roles.rows };
}

/** Retificação do nome, com nova evidência. */
export async function rectifyPersonName(db: Db, requestId: Uuid, personId: Uuid, fullName: string, normalized: string): Promise<void> {
  await db.query(`UPDATE ${S}.person SET full_name = $2, normalized_name = $3 WHERE id = $1`, [personId, fullName, normalized]);
  await db.query(`UPDATE ${S}.data_subject_request SET status='done', closed_at=now() WHERE id=$1`, [requestId]);
}

/**
 * Supressão: a pessoa some de consultas, grafo, Moves e alertas. Alertas pendentes são rejeitados.
 * Os registros ficam marcados (suppressed_at) para impedir reingestão; o apagamento físico é decisão do controlador (J-01).
 */
export async function suppressPerson(db: Db, requestId: Uuid, personId: Uuid, reviewer: string): Promise<void> {
  await db.query(`UPDATE ${S}.person SET suppressed_at = now() WHERE id = $1 AND suppressed_at IS NULL`, [personId]);
  await db.query(
    `UPDATE ${S}.alert SET status='rejected', reviewed_by=$2, reviewed_at=now()
      WHERE status='pending_review' AND move_id IN (SELECT id FROM ${S}.move WHERE person_id = $1)`,
    [personId, reviewer],
  );
  await db.query(`DELETE FROM ${S}.watchlist_item WHERE entity_type='person' AND entity_id = $1`, [personId]);
  await db.query(`UPDATE ${S}.data_subject_request SET status='done', closed_at=now() WHERE id=$1`, [requestId]);
}
