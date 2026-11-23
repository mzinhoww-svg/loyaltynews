import { canTransition } from '@ln/contracts';
import { mainBody, runDeterministicChecks } from '../rules/rules';
import { composeBody, fontesPart, parseNotices } from '../notices';
import { draftContentSha256 } from '../publishable';
import { buildErratumNotice, buildReplyNotice, publishNotice } from '../corrections/corrections';
import type { Draft, Finding } from '../types';
import type { ArticleRecord, CorrectionRecord, EditorialStore, OutboxItem } from './store';

/**
 * Aplicar uma CORREÇÃO ACEITA a uma matéria PUBLICADA da Fábrica (ADR-019 §c.5, lado Editorial).
 * Reabre a matéria sem tirá-la do ar (o status vivo continua publicado até o commit), valida a nova versão do rascunho e a
 * publica como `corrigido`, tudo em UM `commitPublication` atômico: matéria + auditoria + outbox `article.corrected:{id}:{sha}` +
 * caso de correção avançado para `notice_published`.
 *
 * Regras: sem caso aceito ⇒ recusa SEM efeito; o aviso do caso entra no corpo (bloco "Avisos:") e portanto no hash; avisos
 * anteriores nunca saem (o corpo é composto pelo sistema a partir da lista registrada); `publicadoEm` original é mantido; o
 * slug é imutável; a nova versão passa pelo mesmo gate editorial e por checagem em provedor distinto.
 */

export const CORRECTION_QUEUE = 'article-corrected';

export type CorrectionCode =
  | 'invalid_input' | 'not_found' | 'not_published' | 'case_not_found' | 'case_mismatch' | 'case_not_accepted' | 'already_corrected'
  | 'slug_immutable' | 'notices_in_draft' | 'gate_failed' | 'factcheck_failed' | 'receipt_stale';

export interface CorrectionInput {
  articleId: string;
  correctionId: string;
  /** Nova versão do rascunho (texto corrigido, claims, fontes). SEM bloco "Avisos:": o sistema o compõe. */
  draft: Draft;
  /** Checagem da nova versão (provedor distinto do redator; todos os claims aprovados). */
  factcheck: NonNullable<ArticleRecord['factcheck']>;
  /** Recibo da nova versão (Backend). */
  receiptId: string;
  /** Instante da correção (não é a data de publicação original). */
  publishedAt: string;
  /** `conteudoSha256` do recibo: precisa bater com o hash da versão composta (veja `prepareCorrection`). */
  expectedContentSha256?: string;
}

export type CorrectionFail = { ok: false; code: CorrectionCode; message: string; findings?: Finding[] };
export interface PreparedCorrection {
  ok: true;
  /** Rascunho final (corpo com avisos + fontes) — a base do hash e do recibo. */
  draft: Draft;
  contentSha256: string;
  notice: { text: string; replySha256?: string };
  notices: NonNullable<ArticleRecord['notices']>;
  caseAfter: CorrectionRecord;
}
export type CorrectionResult =
  | { ok: true; record: ArticleRecord; contentSha256: string; outbox: 'enqueued' | 'duplicate'; alreadyApplied: boolean }
  | CorrectionFail;

const fail = (code: CorrectionCode, message: string, findings?: Finding[]): CorrectionFail => ({ ok: false, code, message, ...(findings ? { findings } : {}) });
const outboxOf = (articleId: string, sha: string): OutboxItem => ({ queue: CORRECTION_QUEUE, refId: articleId, idempotencyKey: `article.corrected:${articleId}:${sha}` });

/**
 * Valida tudo e compõe a versão corrigida, SEM gravar nada. O Backend usa o `contentSha256` devolvido para emitir o recibo
 * (conteudoSha256) antes de chamar `applyCorrection`.
 */
export async function prepareCorrection(store: EditorialStore, input: CorrectionInput): Promise<PreparedCorrection | CorrectionFail> {
  if (!input.receiptId.trim() || Number.isNaN(Date.parse(input.publishedAt))) return fail('invalid_input', 'recibo e data da correção são obrigatórios');
  const rec = await store.getArticle(input.articleId);
  if (!rec) return fail('not_found', 'matéria não encontrada');
  if ((rec.status !== 'publicado' && rec.status !== 'corrigido') || !rec.publication || !rec.draft) return fail('not_published', 'só matéria publicada pode ser corrigida');
  const cr = await store.getCorrection(input.correctionId);
  if (!cr) return fail('case_not_found', 'caso de correção não encontrado');
  if (cr.case.articleId !== rec.articleId) return fail('case_mismatch', 'o caso pertence a outra matéria');
  // Caso ACEITO: aceito pelo fluxo comum, ou jurídico aceito COM ciência do responsável (nunca decidido pelo agente).
  const legalOk = cr.case.state === 'escalated_legal' && cr.case.decision?.accepted === true && !!cr.case.ownerAckAt;
  if (cr.case.state !== 'accepted' && !legalOk) return fail('case_not_accepted', `caso em ${cr.case.state}: só caso aceito (com ciência do responsável, se jurídico) corrige matéria publicada`);
  if (rec.notices?.some((n) => n.caseId === cr.case.id)) return fail('already_corrected', 'este caso já foi aplicado à matéria');
  if (input.draft.slug !== rec.draft.slug) return fail('slug_immutable', `slug publicado como "${rec.draft.slug}": não pode mudar`);

  const notice = cr.case.kind === 'erratum'
    ? (cr.corrected ? { text: buildErratumNotice({ contested: cr.case.contested, corrected: cr.corrected, at: input.publishedAt }) } : null)
    : (cr.replyText ? buildReplyNotice(cr.case, cr.replyText, input.publishedAt) : null);
  if (!notice) return fail('case_not_accepted', 'o caso não tem o texto da errata/resposta para publicar');
  const step = publishNotice(cr.case, notice, input.publishedAt);
  if (!step.ok) return fail('case_not_accepted', step.message);

  const parsed = parseNotices(input.draft.body);
  if (!parsed.ok || parsed.notices.length > 0) return fail('notices_in_draft', 'o rascunho enviado não pode trazer bloco "Avisos:": o sistema o compõe a partir dos avisos registrados');
  const notices = [...(rec.notices ?? []), { caseId: cr.case.id, kind: cr.case.kind, text: notice.text, at: input.publishedAt }];
  const draft: Draft = { ...input.draft, body: composeBody(mainBody(input.draft.body), notices.map((n) => n.text), fontesPart(input.draft.body)) };

  const chk = runDeterministicChecks(draft, rec.evidences, { notices: notices.map((n) => n.text) });
  if (chk.verdict !== 'pass') return fail('gate_failed', 'a versão corrigida não passa no gate editorial', chk.findings);
  const fc = input.factcheck;
  const independent = fc.provider !== draft.modelProvider;
  const allPass = draft.claims.length > 0 && draft.claims.every((c) => fc.verdicts.some((v) => v.claimId === c.id && v.verdict === 'pass'));
  if (!independent || !allPass) return fail('factcheck_failed', 'checagem da versão corrigida ausente, do mesmo provedor do redator ou com claim sem aprovação');
  const contentSha256 = draftContentSha256(draft);
  if (input.expectedContentSha256 && input.expectedContentSha256 !== contentSha256) {
    return fail('receipt_stale', 'o hash do recibo não corresponde à versão corrigida composta');
  }
  return { ok: true, draft, contentSha256, notice, notices, caseAfter: { ...cr, case: step.case } };
}

/** Aplica a correção: matéria `corrigido` + auditoria + outbox + caso, em uma operação atômica e idempotente. */
export async function applyCorrection(store: EditorialStore, input: CorrectionInput): Promise<CorrectionResult> {
  const rec = await store.getArticle(input.articleId);
  // Repetição da MESMA aplicação (mesmo caso e mesmo recibo): refaz o commit com o estado já gravado (idempotente pela chave da
  // outbox); completa auditoria/outbox/caso se uma versão anterior deixou algo para trás.
  const done = rec?.notices?.find((n) => n.caseId === input.correctionId);
  if (rec && done) {
    if (rec.publication?.receiptId !== input.receiptId || !rec.publication) return fail('already_corrected', 'este caso já foi aplicado com outro recibo');
    const cr = await store.getCorrection(input.correctionId);
    const repaired = cr && cr.case.state === 'accepted' ? { ...cr, case: { ...cr.case, state: 'notice_published' as const, notice: { kind: cr.case.kind, text: done.text, publishedAt: done.at } } } : cr;
    const r = await store.commitPublication({
      article: rec, audit: { at: done.at, userId: null, action: 'article.corrected', target: rec.articleId, detail: `caso ${done.caseId}; recibo ${input.receiptId}` },
      outbox: outboxOf(rec.articleId, rec.publication.contentSha256), ...(repaired ? { correction: repaired } : {}),
    });
    return { ok: true, record: (await store.getArticle(rec.articleId)) ?? rec, contentSha256: rec.publication.contentSha256, outbox: r.outbox, alreadyApplied: true };
  }
  const prep = await prepareCorrection(store, input);
  if (!prep.ok) return prep;
  const cur = rec!; // prepareCorrection garante a existência
  if (!canTransition(cur.status, 'corrigido')) return fail('not_published', `transição ${cur.status} → corrigido não permitida`);
  const next: ArticleRecord = {
    ...cur, status: 'corrigido', draft: prep.draft, factcheck: input.factcheck, notices: prep.notices, updatedAt: input.publishedAt,
    publication: {
      ...cur.publication!, // publishedAt ORIGINAL, url e slug mantidos
      receiptId: input.receiptId, contentSha256: prep.contentSha256, correctedAt: input.publishedAt,
      previous: [...(cur.publication!.previous ?? []), { receiptId: cur.publication!.receiptId, contentSha256: cur.publication!.contentSha256, at: cur.publication!.correctedAt ?? cur.publication!.publishedAt }],
    },
  };
  const r = await store.commitPublication({
    article: next,
    audit: { at: input.publishedAt, userId: null, action: 'article.corrected', target: next.articleId, detail: `caso ${input.correctionId}; recibo ${input.receiptId}` },
    outbox: outboxOf(next.articleId, prep.contentSha256), correction: prep.caseAfter,
  });
  return { ok: true, record: (await store.getArticle(next.articleId)) ?? next, contentSha256: prep.contentSha256, outbox: r.outbox, alreadyApplied: r.outbox === 'duplicate' };
}
