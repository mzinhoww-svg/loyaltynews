import { createHash } from 'node:crypto';
import type { Claim, Draft, Evidence, Finding } from '../types';
import { SIGNATURE } from '../types';
import { checkClaims } from '../rules/rules';

/**
 * Correções (WF08) e resposta/retificação (WF18). Máquina de estados determinística e fail closed:
 * toda correção é pública e datada (nunca silenciosa); direito de resposta preserva o texto do requerente;
 * pedido não verificado bloqueia; o que for jurídico é escalado ao responsável, nunca decidido por agente.
 * NÃO define prazos legais: `deadlineAt` é informado por quem abre o caso (R0-10: parecer jurídico pendente).
 */

export type CorrectionKind = 'erratum' | 'right_of_reply';
export type CorrectionState =
  | 'received' | 'evidence_preserved' | 'triaged' | 'rejected' | 'accepted'
  | 'notice_published' | 'social_reconciled' | 'closed' | 'escalated_legal';

export type CorrectionBlocker = 'unverified_request' | 'missing_evidence' | 'remote_unresolved' | 'invalid_transition' | 'owner_ack_missing' | 'notice_missing';

export interface HistoryEntry { at: string; from: CorrectionState | null; to: CorrectionState; note?: string }
export interface SocialPostRef { postId: string; channel: string; reconciled: boolean }

export interface CorrectionCase {
  id: string;
  articleId: string;
  kind: CorrectionKind;
  requester: { name: string; identityVerified: boolean; channel: string };
  receivedAt: string;
  deadlineAt: string | null;
  /** Trecho/afirmação contestada. */
  contested: string;
  /** Evidências (do banco de evidências) que sustentam a correção. */
  supportingEvidenceIds: string[];
  legal: boolean;
  state: CorrectionState;
  history: HistoryEntry[];
  archive?: { url: string; sha256: string; capturedAt: string };
  decision?: { accepted: boolean; reason: string };
  notice?: { kind: CorrectionKind; text: string; publishedAt: string; replySha256?: string };
  socialPosts: SocialPostRef[];
  entitiesRebuilt: boolean;
  ownerNotifiedAt?: string;
  ownerAckAt?: string;
}

export type Step = { ok: true; case: CorrectionCase } | { ok: false; blocker: CorrectionBlocker; message: string; case: CorrectionCase };

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function move(c: CorrectionCase, to: CorrectionState, at: string, note?: string): CorrectionCase {
  return { ...c, state: to, history: [...c.history, { at, from: c.state, to, ...(note ? { note } : {}) }] };
}
const stop = (c: CorrectionCase, blocker: CorrectionBlocker, message: string): Step => ({ ok: false, blocker, message, case: c });

export function openCase(input: {
  id: string; articleId: string; kind: CorrectionKind; requester: CorrectionCase['requester']; contested: string; receivedAt: string;
  deadlineAt?: string | null; supportingEvidenceIds?: string[]; legal?: boolean; socialPosts?: SocialPostRef[];
}): CorrectionCase {
  return {
    id: input.id, articleId: input.articleId, kind: input.kind, requester: input.requester, receivedAt: input.receivedAt,
    deadlineAt: input.deadlineAt ?? null, contested: input.contested, supportingEvidenceIds: input.supportingEvidenceIds ?? [],
    legal: input.legal ?? input.kind === 'right_of_reply', state: 'received', socialPosts: input.socialPosts ?? [], entitiesRebuilt: false,
    history: [{ at: input.receivedAt, from: null, to: 'received' }],
  };
}

/** Preserva a versão publicada (URL + hash) antes de qualquer alteração. */
export function preserveEvidence(c: CorrectionCase, snap: { url: string; body: string; capturedAt: string }): Step {
  if (c.state !== 'received') return stop(c, 'invalid_transition', `estado ${c.state}`);
  const next = move({ ...c, archive: { url: snap.url, sha256: sha(snap.body), capturedAt: snap.capturedAt } }, 'evidence_preserved', snap.capturedAt);
  return { ok: true, case: next };
}

export function triage(c: CorrectionCase, d: { accepted: boolean; reason: string; at: string }): Step {
  if (c.state !== 'evidence_preserved') return stop(c, 'invalid_transition', `estado ${c.state}`);
  if (!c.requester.identityVerified && (c.kind === 'right_of_reply' || c.legal)) {
    return stop(c, 'unverified_request', 'identidade do requerente não verificada; pedido não processado');
  }
  if (d.accepted && c.kind === 'erratum' && !c.supportingEvidenceIds.length) {
    return stop(c, 'missing_evidence', 'errata aceita exige evidência de suporte');
  }
  const t = move({ ...c, decision: { accepted: d.accepted, reason: d.reason } }, 'triaged', d.at, d.reason);
  // Caso jurídico: o agente apenas recomenda; quem decide é o responsável (ciência registrada via ownerAck).
  if (c.legal) return { ok: true, case: move({ ...t, ownerNotifiedAt: d.at }, 'escalated_legal', d.at, 'notificar responsável (notify_owner_if_legal)') };
  if (!d.accepted) return { ok: true, case: move(t, 'rejected', d.at, d.reason) };
  return { ok: true, case: move(t, 'accepted', d.at) };
}

/** Caso jurídico: o sistema NÃO decide nem fecha sozinho; notifica o responsável e aguarda ciência registrada. */
export function escalateLegal(c: CorrectionCase, at: string): Step {
  if (!c.legal) return stop(c, 'invalid_transition', 'caso não marcado como jurídico');
  return { ok: true, case: move({ ...c, ownerNotifiedAt: at }, 'escalated_legal', at, 'notificar responsável (notify_owner_if_legal)') };
}
export function ownerAck(c: CorrectionCase, at: string): CorrectionCase {
  return { ...c, ownerAckAt: at };
}

/** Texto da errata: público, datado, mostra o que foi corrigido; assinatura institucional. */
export function buildErratumNotice(input: { contested: string; corrected: string; at: string }): string {
  return `Correção (${input.at.slice(0, 10)}): onde se lia "${input.contested}", leia-se "${input.corrected}". ${SIGNATURE}.`;
}

/** Direito de resposta: texto do requerente publicado sem alteração, rotulado e com hash para prova de integridade. */
export function buildReplyNotice(c: CorrectionCase, replyText: string, at: string): { text: string; replySha256: string } {
  return {
    text: `Direito de resposta — enviado por ${c.requester.name} em ${c.receivedAt.slice(0, 10)}, publicado em ${at.slice(0, 10)} sem alterações:\n${replyText}`,
    replySha256: sha(replyText),
  };
}

/** A correção em si é checada como qualquer afirmação: cada claim precisa constar nas evidências. */
export function verifyCorrectionClaims(claims: Claim[], evidences: Evidence[]): Finding[] {
  const pseudo: Draft = {
    id: 'correction', editoria: 'regulacao', headline: '', body: '', slug: 'correction', resumo: 'n/a', tipoConteudo: 'noticia', classeDeDado: 'public', patrocinado: false, claims, evidenceIds: [...new Set(claims.flatMap((c) => c.evidenceIds))],
    signature: SIGNATURE, image: { mode: 'none', reason: 'n/a' }, modelProvider: 'n/a', promptVersion: 'n/a',
  };
  return checkClaims(pseudo, evidences).findings;
}

export function publishNotice(c: CorrectionCase, notice: { text: string; replySha256?: string }, at: string): Step {
  if (c.legal) {
    if (c.state !== 'escalated_legal') return stop(c, 'invalid_transition', `estado ${c.state}`);
    if (!c.ownerAckAt) return stop(c, 'owner_ack_missing', 'responsável ainda não deu ciência do caso jurídico');
    if (!c.decision?.accepted) return stop(c, 'invalid_transition', 'pedido não aceito; nada a publicar');
  } else if (c.state !== 'accepted') return stop(c, 'invalid_transition', `estado ${c.state}`);
  if (!notice.text.trim()) return stop(c, 'notice_missing', 'texto do aviso vazio');
  if (c.kind === 'right_of_reply' && notice.replySha256 === undefined) return stop(c, 'notice_missing', 'direito de resposta exige hash do texto original do requerente');
  const n = { kind: c.kind, text: notice.text, publishedAt: at, ...(notice.replySha256 ? { replySha256: notice.replySha256 } : {}) };
  return { ok: true, case: move({ ...c, notice: n }, 'notice_published', at) };
}

/** Todo post social vinculado precisa ter recibo de reconciliação (correção/remoção). Senão, remote_unresolved. */
export function reconcileSocial(c: CorrectionCase, receipts: Array<{ postId: string }>, at: string): Step {
  if (c.state !== 'notice_published') return stop(c, 'invalid_transition', `estado ${c.state}`);
  const got = new Set(receipts.map((r) => r.postId));
  const posts = c.socialPosts.map((p) => ({ ...p, reconciled: p.reconciled || got.has(p.postId) }));
  const pending = posts.filter((p) => !p.reconciled);
  const updated = { ...c, socialPosts: posts };
  if (pending.length) return stop(updated, 'remote_unresolved', `posts sem recibo: ${pending.map((p) => p.postId).join(',')}`);
  return { ok: true, case: move(updated, 'social_reconciled', at) };
}

export function markEntitiesRebuilt(c: CorrectionCase): CorrectionCase { return { ...c, entitiesRebuilt: true }; }

export function closeCase(c: CorrectionCase, at: string): Step {
  if (c.state === 'rejected') return { ok: true, case: move(c, 'closed', at, 'pedido rejeitado com motivo registrado') };
  if (c.state === 'escalated_legal' && c.decision && !c.decision.accepted) {
    if (!c.ownerAckAt) return stop(c, 'owner_ack_missing', 'rejeição de caso jurídico exige ciência do responsável');
    return { ok: true, case: move(c, 'closed', at, 'rejeição confirmada pelo responsável') };
  }
  if (c.state !== 'social_reconciled') return stop(c, 'invalid_transition', `estado ${c.state}`);
  if (!c.notice) return stop(c, 'notice_missing', 'sem aviso público');
  if (!c.entitiesRebuilt) return stop(c, 'remote_unresolved', 'entidades (Intelligence) ainda não reconstruídas');
  return { ok: true, case: move(c, 'closed', at) };
}

/** Atraso: informativo (alerta), sem presumir prazo legal. */
export function isOverdue(c: CorrectionCase, now: Date): boolean {
  return c.deadlineAt !== null && c.state !== 'closed' && now.getTime() > Date.parse(c.deadlineAt);
}
