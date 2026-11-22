import type { Db } from './db';
import { one } from './db';
import type { Uuid } from './types';

const S = 'intelligence';

export async function openSubjectRequest(db: Db, personId: Uuid, kind: 'access' | 'rectification' | 'suppression', note?: string): Promise<Uuid> {
  return (await one<{ id: Uuid }>(
    db,
    `INSERT INTO ${S}.data_subject_request (person_id, kind, note) VALUES ($1,$2,$3) RETURNING id`,
    [personId, kind, note ?? null],
  )).id;
}

/**
 * Acesso: tudo o que guardamos da pessoa (nome, cargos, evidências). Pessoa suprimida: NADA além de `null`/lista vazia
 * (a exportação também respeita a supressão: cargos só saem junto de uma pessoa não suprimida).
 */
export async function exportPersonData(db: Db, personId: Uuid) {
  const person = await db.query(
    `SELECT id, full_name, public_profile_url, evidence_id, observed_at FROM ${S}.person WHERE id = $1 AND suppressed_at IS NULL`,
    [personId],
  );
  if (!person.rows[0]) return { person: null, roles: [] as Record<string, unknown>[] };
  const roles = await db.query(
    `SELECT r.organization_id, r.title, r.valid_from::text, r.valid_to::text, r.certainty, r.evidence_id, r.validated_at
       FROM ${S}.role_assignment r JOIN ${S}.person p ON p.id = r.person_id AND p.suppressed_at IS NULL
      WHERE r.person_id = $1`,
    [personId],
  );
  return { person: person.rows[0], roles: roles.rows };
}

/** Retificação do nome, com nova evidência. */
export async function rectifyPersonName(db: Db, requestId: Uuid, personId: Uuid, fullName: string, normalized: string): Promise<void> {
  await db.query(`UPDATE ${S}.person SET full_name = $2, normalized_name = $3 WHERE id = $1 AND suppressed_at IS NULL`, [personId, fullName, normalized]);
  await db.query(`UPDATE ${S}.data_subject_request SET status='done', closed_at=now() WHERE id=$1`, [requestId]);
}

/**
 * Supressão: a pessoa some de consultas, exportação, grafo, Moves e alertas; alertas pendentes são rejeitados.
 * A reingestão é bloqueada por tombstones de hash (URL de perfil; nome+organização de cada cargo; nome+domínio de cada fonte),
 * então não depende só do ID interno. O apagamento físico é decisão do controlador (J-01); os dados ficam inacessíveis.
 */
export async function suppressPerson(db: Db, requestId: Uuid, personId: Uuid, reviewer: string): Promise<void> {
  const p = await db.query<{ normalized_name: string; public_profile_url: string | null }>(
    `SELECT normalized_name, public_profile_url FROM ${S}.person WHERE id = $1`, [personId]);
  const person = p.rows[0];
  if (!person) return;

  if (person.public_profile_url) {
    await db.query(
      `INSERT INTO ${S}.suppression_tombstone (key_kind, key_hash, request_id) VALUES ('profile_url', ${S}.tombstone_hash('profile_url', $1::text), $2::uuid) ON CONFLICT DO NOTHING`,
      [person.public_profile_url, requestId],
    );
  }
  // nome + organização de cada cargo já conhecido
  await db.query(
    `INSERT INTO ${S}.suppression_tombstone (key_kind, key_hash, request_id)
     SELECT DISTINCT 'name_org', ${S}.tombstone_hash('name_org', $2::text, o.normalized_name), $3::uuid
       FROM ${S}.role_assignment r JOIN ${S}.organization o ON o.id = r.organization_id WHERE r.person_id = $1
     ON CONFLICT DO NOTHING`,
    [personId, person.normalized_name, requestId],
  );
  // nome + domínio de cada fonte que já sustentou a pessoa ou algum cargo/Move dela
  await db.query(
    `INSERT INTO ${S}.suppression_tombstone (key_kind, key_hash, request_id)
     SELECT DISTINCT 'name_source', ${S}.tombstone_hash('name_source', $2::text, ${S}.source_host(ev.source_url)), $3::uuid
       FROM ${S}.evidence ev
      WHERE ev.id IN (
              SELECT evidence_id FROM ${S}.person WHERE id = $1
              UNION SELECT evidence_id FROM ${S}.role_assignment WHERE person_id = $1
              UNION SELECT evidence_id FROM ${S}.move WHERE person_id = $1)
     ON CONFLICT DO NOTHING`,
    [personId, person.normalized_name, requestId],
  );

  await db.query(`UPDATE ${S}.person SET suppressed_at = now() WHERE id = $1 AND suppressed_at IS NULL`, [personId]);
  await db.query(`DELETE FROM ${S}.person_extended WHERE person_id = $1`, [personId]);
  await db.query(
    `UPDATE ${S}.alert SET status='rejected', reviewed_by=$2, reviewed_at=now()
      WHERE status='pending_review' AND move_id IN (SELECT id FROM ${S}.move WHERE person_id = $1)`,
    [personId, reviewer],
  );
  await db.query(`DELETE FROM ${S}.watchlist_item WHERE entity_type='person' AND entity_id = $1`, [personId]);
  await db.query(`UPDATE ${S}.data_subject_request SET status='done', closed_at=now() WHERE id=$1`, [requestId]);
}

/** Verdadeiro se algum identificador estável casa com uma supressão anterior. Usado antes de qualquer criação/atualização de pessoa. */
export async function isSuppressedIdentity(
  db: Db,
  q: { normalizedName: string; publicProfileUrl?: string | null; organizationNormalizedName?: string | null; evidenceId?: Uuid | null },
): Promise<boolean> {
  const r = await db.query<{ hit: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ${S}.suppression_tombstone t WHERE
            (t.key_kind = 'profile_url'  AND $2::text IS NOT NULL AND t.key_hash = ${S}.tombstone_hash('profile_url', $2))
         OR (t.key_kind = 'name_org'     AND $3::text IS NOT NULL AND t.key_hash = ${S}.tombstone_hash('name_org', $1, $3))
         OR (t.key_kind = 'name_source'  AND $4::uuid IS NOT NULL AND t.key_hash = ${S}.tombstone_hash('name_source', $1,
              (SELECT ${S}.source_host(e.source_url) FROM ${S}.evidence e WHERE e.id = $4::uuid)))
     ) AS hit`,
    [q.normalizedName, q.publicProfileUrl ?? null, q.organizationNormalizedName ?? null, q.evidenceId ?? null],
  );
  return r.rows[0]?.hit === true;
}
