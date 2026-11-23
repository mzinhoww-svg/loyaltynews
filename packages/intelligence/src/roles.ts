/* eslint-disable @typescript-eslint/no-explicit-any -- linhas de resultado do SQL são tipadas na borda */
/**
 * Cargos para o Studio: lista (inclusive a fila "a confirmar"), confirmação com página OFICIAL e descarte.
 * Nível da fonte por cargo (`source_level`): 'official' = declarado (só entra de página oficial/primária); 'secondary' = inferido por fonte
 * secundária (LinkedIn/The Org), status "a confirmar"; 'inferred' = outra inferência. O portal nunca recebe cargo que não seja declarado.
 */
import type { Db } from './db';
import { addEvidence } from './repo';
import { SECONDARY_HOSTS } from './seed-load';
import { type EvidenceRef, toEvidence } from './queries';
import type { Uuid } from './types';

const S = 'intelligence';

export type SourceLevel = 'official' | 'secondary' | 'inferred';
export interface RoleView {
  role_id: Uuid;
  person_id: Uuid;
  person_name: string;
  organization_id: Uuid;
  organization: string;
  title: string;
  certainty: 'declared' | 'inferred';
  source_level: SourceLevel;
  /** Status de exibição: 'confirmed' (declarado) ou 'to_confirm' ("a confirmar"). */
  status: 'confirmed' | 'to_confirm';
  valid_from: string;
  valid_to: string | null;
  validated_at: string;
  evidence: EvidenceRef;
}
export interface RoleFilter { certainty?: 'declared' | 'inferred'; organizationId?: Uuid; q?: string; includeClosed?: boolean; limit?: number; offset?: number }

const levelOf = (certainty: string, basis: string | null): SourceLevel => (certainty === 'declared' ? 'official' : basis?.startsWith('a confirmar') ? 'secondary' : 'inferred');

/** Cargos de pessoas não suprimidas. Studio: inclui inferidos. Ordem: a confirmar primeiro, depois empresa e nome. */
export async function listRoleViews(db: Db, f: RoleFilter = {}): Promise<RoleView[]> {
  const q = f.q?.trim() ? `%${f.q.trim().replace(/[%_\\]/g, (c) => `\\${c}`).toLowerCase()}%` : null;
  const r = await db.query<any>(
    `SELECT r.id AS role_id, p.id AS person_id, p.full_name AS person_name, o.id AS organization_id, o.legal_name AS organization, r.title,
            r.certainty, r.inference_basis, r.valid_from::text, r.valid_to::text, r.validated_at,
            ev.id AS ev_id, ev.source_url AS ev_url, ev.source_name AS ev_name, ev.retrieved_at AS ev_retrieved, ev.is_mock AS ev_mock
       FROM ${S}.role_assignment r
       JOIN ${S}.person p ON p.id = r.person_id AND p.suppressed_at IS NULL
       JOIN ${S}.organization o ON o.id = r.organization_id
       JOIN ${S}.evidence ev ON ev.id = r.evidence_id
      WHERE ($1::text IS NULL OR r.certainty = $1) AND ($2::uuid IS NULL OR r.organization_id = $2)
        AND ($3::text IS NULL OR lower(p.full_name) LIKE $3 OR lower(o.legal_name) LIKE $3 OR lower(r.title) LIKE $3)
        AND ($4::boolean OR r.valid_to IS NULL)
      ORDER BY (r.certainty = 'declared'), o.legal_name, p.full_name, r.title
      LIMIT $5 OFFSET $6`,
    [f.certainty ?? null, f.organizationId ?? null, q, f.includeClosed ?? false, Math.min(Math.max(f.limit ?? 50, 1), 200), Math.max(f.offset ?? 0, 0)],
  );
  return r.rows.map((x: any) => ({
    role_id: x.role_id, person_id: x.person_id, person_name: x.person_name, organization_id: x.organization_id, organization: x.organization, title: x.title,
    certainty: x.certainty, source_level: levelOf(x.certainty, x.inference_basis), status: x.certainty === 'declared' ? 'confirmed' : 'to_confirm',
    valid_from: x.valid_from, valid_to: x.valid_to, validated_at: new Date(x.validated_at).toISOString(), evidence: toEvidence(x),
  }));
}

export type RoleActionResult = { ok: true; roleId: Uuid } | { ok: false; code: 'not_found' | 'not_inferred' | 'invalid_source'; message: string };

/**
 * Confirma um cargo "a confirmar" com uma página OFICIAL/primária: grava a evidência nova e passa a declarado. Recusa URL que não seja https,
 * seja de LinkedIn/The Org (fonte secundária nunca confirma) ou seja a própria fonte que já sustentava o cargo.
 * `confirmedBy` é de quem atesta (o Backend registra na auditoria; NÃO vai para a evidência, que é pública). Aqui não se lê a página: o
 * atestado é humano; a confirmação automática (releitura da página oficial) usa processObservation e dispensa este caminho.
 */
export async function confirmRole(db: Db, roleId: Uuid, src: { officialUrl: string; sourceName?: string; retrievedAt?: string }, confirmedBy: string): Promise<RoleActionResult> {
  if (!confirmedBy.trim()) return { ok: false, code: 'invalid_source', message: 'identidade de quem confirma é obrigatória' };
  let u: URL;
  try { u = new URL(src.officialUrl); } catch { return { ok: false, code: 'invalid_source', message: 'URL inválida' }; }
  if (u.protocol !== 'https:') return { ok: false, code: 'invalid_source', message: 'só https' };
  if (SECONDARY_HOSTS.test(u.hostname)) return { ok: false, code: 'invalid_source', message: 'LinkedIn/The Org são fonte secundária e não confirmam cargo' };
  const cur = await db.query<{ certainty: string; ev_url: string }>(
    `SELECT r.certainty, ev.source_url AS ev_url FROM ${S}.role_assignment r JOIN ${S}.evidence ev ON ev.id = r.evidence_id WHERE r.id = $1`, [roleId]);
  const row = cur.rows[0];
  if (!row) return { ok: false, code: 'not_found', message: 'cargo não encontrado' };
  if (row.certainty !== 'inferred') return { ok: false, code: 'not_inferred', message: 'o cargo já é declarado' };
  if (row.ev_url === src.officialUrl) return { ok: false, code: 'invalid_source', message: 'a confirmação precisa de OUTRA fonte (a atual é a secundária)' };
  const at = src.retrievedAt ?? new Date().toISOString();
  const evidenceId = await addEvidence(db, { sourceUrl: src.officialUrl, sourceName: src.sourceName?.trim() || u.hostname, retrievedAt: at, isMock: false });
  await db.query(`UPDATE ${S}.role_assignment SET certainty = 'declared', inference_basis = NULL, evidence_id = $2, validated_at = $3 WHERE id = $1`, [roleId, evidenceId, at]);
  return { ok: true, roleId };
}

/** Descarta um cargo inferido (fecha com vigência vazia e registra o motivo na base da inferência; só o Studio vê). Declarado não se descarta aqui. */
export async function discardRole(db: Db, roleId: Uuid, reason: string): Promise<RoleActionResult> {
  const cur = await db.query<{ certainty: string; valid_from: string }>(`SELECT certainty, valid_from::text FROM ${S}.role_assignment WHERE id = $1`, [roleId]);
  const row = cur.rows[0];
  if (!row) return { ok: false, code: 'not_found', message: 'cargo não encontrado' };
  if (row.certainty !== 'inferred') return { ok: false, code: 'not_inferred', message: 'só cargo inferido ("a confirmar") pode ser descartado; declarado sai por saída (Move) ou pedido do titular' };
  await db.query(
    `UPDATE ${S}.role_assignment SET valid_to = valid_from, inference_basis = left('descartado: ' || $2 || ' | ' || coalesce(inference_basis, ''), 400) WHERE id = $1`,
    [roleId, reason.trim().slice(0, 200)],
  );
  return { ok: true, roleId };
}
