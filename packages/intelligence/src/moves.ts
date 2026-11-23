import type { Db } from './db';
import { one } from './db';
import { DEFAULT_CONFIG, PersonSuppressedError, type IntelligenceConfig } from './config';
import { normalizeTitle } from './normalize';
import { addRole, closeRole, resolveOrCreatePerson, revalidateRole, upsertOrganization } from './repo';
import type { MoveKind, MoveRow, RoleObservation, Uuid } from './types';

const S = 'intelligence';

interface OpenRole { id: Uuid; organization_id: Uuid; normalized_title: string; valid_from: string }

export type ObservationResult =
  | { outcome: 'baseline'; personId: Uuid; roleId: Uuid }
  | { outcome: 'unchanged'; personId: Uuid; roleId: Uuid }
  | { outcome: 'move'; personId: Uuid; move: MoveRow }
  | { outcome: 'ignored'; reason: 'stale_observation' | 'no_open_role_to_close' | 'subject_suppressed' | 'secondary_source_unconfirmed' };

/** Base gravada nos cargos vindos de fonte secundária (LinkedIn/The Org): "a confirmar", nunca fato. */
export const SECONDARY_BASIS = 'a confirmar: fonte secundária (rede profissional/organograma público), sem confirmação em página oficial';

/**
 * Loyalty Moves — detecção de mudança de cargo a partir de uma observação de fonte pública.
 *  - Primeira observação de uma pessoa é linha de base, não Move (não sabemos quando começou), salvo se a fonte anuncia.
 *  - Mesma organização e cargo: só revalida. Cargo diferente na mesma organização: title_change.
 *  - Outra organização: org_change (fecha o cargo anterior e abre o novo). Saída explícita: departure.
 *  - Move nasce 'detected'; nunca é publicado sem revisão. Observação mais antiga que o cargo aberto é ignorada.
 */
export async function processObservation(
  db: Db,
  obs: RoleObservation,
  cfg: IntelligenceConfig = DEFAULT_CONFIG,
): Promise<ObservationResult> {
  const observedOn = obs.observedAt.slice(0, 10);
  const orgId = await upsertOrganization(db, { legalName: obs.orgName, evidenceId: obs.evidenceId, observedAt: obs.observedAt });
  let person: { id: Uuid; created: boolean };
  try {
    person = await resolveOrCreatePerson(
      db,
      { fullName: obs.personName, publicProfileUrl: obs.publicProfileUrl, organizationId: orgId, evidenceId: obs.evidenceId, observedAt: obs.observedAt, extra: obs.extra },
      cfg,
    );
  } catch (e) {
    if (e instanceof PersonSuppressedError) return { outcome: 'ignored', reason: 'subject_suppressed' };
    throw e;
  }
  const open = (
    await db.query<OpenRole>(
      `SELECT id, organization_id, normalized_title, valid_from::text FROM ${S}.role_assignment
        WHERE person_id = $1 AND valid_to IS NULL AND certainty = 'declared' ORDER BY valid_from DESC`,
      [person.id],
    )
  ).rows;
  const nTitle = normalizeTitle(obs.title);

  // Fonte SECUNDÁRIA (LinkedIn/The Org, só página pública): nunca gera Move, nunca fecha cargo, nunca vira fato. Só registra "a confirmar".
  if (obs.sourceLevel === 'secundaria') {
    if (obs.kind === 'left') return { outcome: 'ignored', reason: 'secondary_source_unconfirmed' };
    const anyOpen = (
      await db.query<{ id: Uuid; normalized_title: string; certainty: string }>(
        `SELECT id, normalized_title, certainty FROM ${S}.role_assignment WHERE person_id = $1 AND organization_id = $2 AND valid_to IS NULL`,
        [person.id, orgId],
      )
    ).rows;
    const same2 = anyOpen.find((r) => r.normalized_title === normalizeTitle(obs.title));
    if (same2) return { outcome: 'unchanged', personId: person.id, roleId: same2.id };
    if (anyOpen.some((r) => r.certainty === 'declared')) return { outcome: 'ignored', reason: 'secondary_source_unconfirmed' };
    const roleId = await addRole(db, {
      personId: person.id, organizationId: orgId, title: obs.title, validFrom: observedOn, certainty: 'inferred', inferenceBasis: SECONDARY_BASIS,
      evidenceId: obs.evidenceId, observedAt: obs.observedAt,
    });
    return { outcome: 'baseline', personId: person.id, roleId };
  }

  if (obs.kind === 'left') {
    const cur = open.find((r) => r.organization_id === orgId);
    if (!cur) return { outcome: 'ignored', reason: 'no_open_role_to_close' };
    if (observedOn < cur.valid_from) return { outcome: 'ignored', reason: 'stale_observation' };
    const effective = obs.announcement?.effectiveDate ?? null;
    await closeRole(db, cur.id, effective ?? observedOn);
    const move = await insertMove(db, {
      personId: person.id, kind: 'departure', basis: obs.announcement ? 'announcement' : 'observed_diff',
      fromRoleId: cur.id, toRoleId: null, effectiveDate: effective, observedOn, evidenceId: obs.evidenceId,
    });
    return { outcome: 'move', personId: person.id, move };
  }

  // Cargo "a confirmar" (inferido, de fonte secundária) + leitura oficial do MESMO cargo = confirmação: passa a declarado com a nova
  // evidência. Não é Move (nada mudou, só ganhou prova). Nunca o contrário.
  const pending = (
    await db.query<{ id: Uuid; valid_from: string }>(
      `SELECT id, valid_from::text FROM ${S}.role_assignment
        WHERE person_id = $1 AND organization_id = $2 AND normalized_title = $3 AND valid_to IS NULL AND certainty = 'inferred'`,
      [person.id, orgId, nTitle],
    )
  ).rows[0];
  if (pending) {
    await db.query(
      `UPDATE ${S}.role_assignment SET certainty = 'declared', inference_basis = NULL, evidence_id = $2, validated_at = $3 WHERE id = $1`,
      [pending.id, obs.evidenceId, obs.observedAt],
    );
    return { outcome: 'unchanged', personId: person.id, roleId: pending.id };
  }
  const same = open.find((r) => r.organization_id === orgId && r.normalized_title === nTitle);
  if (same) {
    if (observedOn >= same.valid_from) await revalidateRole(db, same.id, obs.observedAt, obs.evidenceId);
    return { outcome: 'unchanged', personId: person.id, roleId: same.id };
  }

  const startDate = obs.announcement?.effectiveDate ?? observedOn;
  const previous = open.find((r) => r.organization_id === orgId) ?? open[0];
  if (previous && observedOn < previous.valid_from) return { outcome: 'ignored', reason: 'stale_observation' };

  if (!previous) {
    const roleId = await addRole(db, {
      personId: person.id, organizationId: orgId, title: obs.title, validFrom: startDate,
      evidenceId: obs.evidenceId, observedAt: obs.observedAt,
    });
    // Pessoa nova sem anúncio: linha de base. Anúncio, ou pessoa já conhecida que reaparece em cargo: nomeação.
    if (person.created && !obs.announcement) return { outcome: 'baseline', personId: person.id, roleId };
    const move = await insertMove(db, {
      personId: person.id, kind: 'appointment', basis: obs.announcement ? 'announcement' : 'observed_diff',
      fromRoleId: null, toRoleId: roleId, effectiveDate: obs.announcement?.effectiveDate ?? null, observedOn, evidenceId: obs.evidenceId,
    });
    return { outcome: 'move', personId: person.id, move };
  }

  await closeRole(db, previous.id, startDate);
  const toRoleId = await addRole(db, {
    personId: person.id, organizationId: orgId, title: obs.title, validFrom: startDate,
    evidenceId: obs.evidenceId, observedAt: obs.observedAt,
  });
  const kind: MoveKind = previous.organization_id === orgId ? 'title_change' : 'org_change';
  const move = await insertMove(db, {
    personId: person.id, kind, basis: obs.announcement ? 'announcement' : 'observed_diff', fromRoleId: previous.id,
    toRoleId, effectiveDate: obs.announcement?.effectiveDate ?? null, observedOn, evidenceId: obs.evidenceId,
  });
  return { outcome: 'move', personId: person.id, move };
}

async function insertMove(
  db: Db,
  m: { personId: Uuid; kind: MoveKind; basis: 'announcement' | 'observed_diff'; fromRoleId: Uuid | null; toRoleId: Uuid | null;
       effectiveDate: string | null; observedOn: string; evidenceId: Uuid },
): Promise<MoveRow> {
  return one<MoveRow>(
    db,
    `INSERT INTO ${S}.move (person_id, kind, basis, from_role_id, to_role_id, effective_date, observed_on, evidence_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, person_id, kind, basis, from_role_id, to_role_id, effective_date::text, observed_on::text, evidence_id, status`,
    [m.personId, m.kind, m.basis, m.fromRoleId, m.toRoleId, m.effectiveDate, m.observedOn, m.evidenceId],
  );
}

export async function listMoves(db: Db, filter: { status?: MoveRow['status']; personId?: Uuid } = {}): Promise<MoveRow[]> {
  const r = await db.query<MoveRow>(
    `SELECT m.id, m.person_id, m.kind, m.basis, m.from_role_id, m.to_role_id, m.effective_date::text, m.observed_on::text, m.evidence_id, m.status
       FROM ${S}.move m JOIN ${S}.person p ON p.id = m.person_id AND p.suppressed_at IS NULL
      WHERE ($1::text IS NULL OR m.status = $1) AND ($2::uuid IS NULL OR m.person_id = $2)
      ORDER BY m.observed_on DESC, m.detected_at DESC`,
    [filter.status ?? null, filter.personId ?? null],
  );
  return r.rows;
}

export async function reviewMove(db: Db, moveId: Uuid, status: 'confirmed' | 'rejected'): Promise<void> {
  await db.query(`UPDATE ${S}.move SET status = $2 WHERE id = $1`, [moveId, status]);
}
