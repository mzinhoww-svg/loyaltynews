import { z } from 'zod';
import { apiError, canTransition } from '@ln/contracts';
import type { ArticleStatus } from '@ln/contracts';
import { EDITORIAS } from '../types';
import { runDeterministicChecks } from '../rules/rules';
import {
  buildErratumNotice, buildReplyNotice, closeCase, markEntitiesRebuilt, openCase, ownerAck, preserveEvidence, publishNotice,
  reconcileSocial, triage, verifyCorrectionClaims,
} from '../corrections/corrections';
import type { Step } from '../corrections/corrections';
import type { ArticleRecord, CorrectionRecord } from './store';
import { isCorrectable, publicArticleUrl } from './published-lookup';

/**
 * Handlers de API do CMS (LN Studio) como FUNÇÕES PURAS: (contexto, entrada) -> { status, body }.
 * Sem Next.js, sem rede, sem modelo. O Backend (apps/web/app/api) só monta o contexto (sessão, store, fila) e repassa.
 * Fail closed: sem sessão/MFA/papel => 401/403; entrada inválida => 400; transição ilegal => 409.
 * Nenhum handler publica, despublica ou fala com mLabs: isso é do WF03/WF04 (identidade de publicação).
 */

import { audit, authorize, bad, fail, isErr, ok, parse } from './common';
import type { ApiResponse, HandlerCtx } from './common';
export { ACTION_ROLES } from './common';
export type { Action, Actor, ApiResponse, HandlerCtx } from './common';

// ---------- 1. fila editorial ----------
const EditoriaIn = z.enum(EDITORIAS as unknown as [string, ...string[]]);
const StatusIn = z.enum(['rascunho', 'em_checagem', 'bloqueado', 'aprovado', 'publicado', 'despublicado', 'corrigido']);
const ListIn = z.object({ status: StatusIn.optional(), editoria: EditoriaIn.optional(), limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).default(0) });

export interface QueueItem { articleId: string; titulo: string | null; editoria: string; status: ArticleStatus; blockers: string[]; atualizadoEm: string }

export async function listQueue(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ items: QueueItem[]; total: number; limit: number; offset: number }>> {
  const a = authorize(ctx, 'queue.list'); if (isErr(a)) return fail(a);
  const p = parse(ListIn, input); if (bad(p)) return fail(p);
  const f = p.data;
  const all = (await ctx.store.listArticles())
    .filter((r) => (!f.status || r.status === f.status) && (!f.editoria || r.editoria === f.editoria))
    // bloqueadas primeiro (precisam de atenção), depois mais recentes
    .sort((x, y) => Number(y.status === 'bloqueado') - Number(x.status === 'bloqueado') || y.updatedAt.localeCompare(x.updatedAt));
  const items = all.slice(f.offset, f.offset + f.limit).map((r) => ({
    articleId: r.articleId, titulo: r.draft?.headline ?? null, editoria: r.editoria, status: r.status, blockers: r.blockers, atualizadoEm: r.updatedAt,
  }));
  return ok({ items, total: all.length, limit: f.limit, offset: f.offset });
}

// ---------- 2. visão de revisão (rascunho + evidências + gate recalculado) ----------
const IdIn = z.object({ articleId: z.string().min(1).max(128) });

function independence(r: ArticleRecord): { checked: boolean; independent: boolean; draftProvider: string | null; factcheckProvider: string | null } {
  const dp = r.draft?.modelProvider ?? null; const fp = r.factcheck?.provider ?? null;
  return { checked: fp !== null, independent: dp !== null && fp !== null && dp !== fp, draftProvider: dp, factcheckProvider: fp };
}

export interface ReviewView {
  articleId: string; status: ArticleStatus; editoria: string;
  rascunho: { titulo: string; corpo: string; assinatura: string; claims: Array<{ id: string; kind: string; text: string; evidenceIds: string[]; verdict: string | null }>; imagem: unknown } | null;
  evidencias: Array<{ id: string; sourceId: string; url: string; capturadoEm: string; sha256: string; titulo: string; suspeita: boolean }>;
  gate: { passou: boolean; achados: Array<{ code: string; message: string; claimId?: string }>; independencia: ReturnType<typeof independence>; todasClaimsAprovadas: boolean };
  bloqueios: string[]; revisoes: ArticleRecord['reviews'];
}

/** O gate é SEMPRE recalculado a partir do rascunho e das evidências; o que foi gravado antes não é confiado. */
export async function getArticleReview(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<ReviewView>> {
  const a = authorize(ctx, 'article.read'); if (isErr(a)) return fail(a);
  const p = parse(IdIn, input); if (bad(p)) return fail(p);
  const r = await ctx.store.getArticle(p.data.articleId);
  if (!r) return fail(apiError('NOT_FOUND', 'matéria não encontrada'));
  const d = r.draft;
  const chk = d ? runDeterministicChecks(d, r.evidences, { notices: r.notices?.map((n) => n.text) ?? [] }) : null;
  const ind = independence(r);
  const verdictOf = (id: string) => r.factcheck?.verdicts.find((v) => v.claimId === id)?.verdict ?? null;
  const allPass = !!d && d.claims.length > 0 && d.claims.every((c) => verdictOf(c.id) === 'pass');
  return ok({
    articleId: r.articleId, status: r.status, editoria: r.editoria,
    rascunho: d ? {
      titulo: d.headline, corpo: d.body, assinatura: d.signature, imagem: d.image,
      claims: d.claims.map((c) => ({ id: c.id, kind: c.kind, text: c.text, evidenceIds: c.evidenceIds, verdict: verdictOf(c.id) })),
    } : null,
    evidencias: r.evidences.map((e) => ({ id: e.id, sourceId: e.sourceId, url: e.url, capturadoEm: e.fetchedAt, sha256: e.contentSha256, titulo: e.title, suspeita: e.suspicious })),
    gate: { passou: !!chk && chk.verdict === 'pass' && ind.independent && allPass, achados: chk?.findings ?? [], independencia: ind, todasClaimsAprovadas: allPass },
    bloqueios: r.blockers, revisoes: r.reviews,
  });
}

// ---------- 3. decisão de revisão humana ----------
const ReviewIn = z.object({ articleId: z.string().min(1).max(128), decision: z.enum(['confirm', 'send_back', 'block']), note: z.string().trim().min(3).max(2000) });

/**
 * `confirm` só registra ciência e só vale se o gate recalculado passa; humano NÃO força aprovação.
 * `send_back` devolve a rascunho; `block` bloqueia (só de em_checagem). Transições seguem @ln/contracts (canTransition).
 */
export async function submitReview(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ articleId: string; status: ArticleStatus }>> {
  const a = authorize(ctx, 'article.review'); if (isErr(a)) return fail(a);
  const p = parse(ReviewIn, input); if (bad(p)) return fail(p);
  const r = await ctx.store.getArticle(p.data.articleId);
  if (!r) return fail(apiError('NOT_FOUND', 'matéria não encontrada'));
  const at = ctx.now().toISOString();
  let next: ArticleStatus = r.status;
  if (p.data.decision === 'confirm') {
    const g = await getArticleReview(ctx, { articleId: r.articleId });
    const gate = 'error' in g.body ? null : g.body.gate;
    if (r.status !== 'aprovado' || !gate?.passou) return fail(apiError('BLOCKED', 'confirmação exige matéria aprovada com o gate recalculado passando', gate?.achados));
  } else {
    next = p.data.decision === 'block' ? 'bloqueado' : 'rascunho';
    if (!canTransition(r.status, next)) return fail(apiError('CONFLICT', `transição ${r.status} -> ${next} não permitida`));
  }
  await ctx.store.putArticle({ ...r, status: next, updatedAt: at, reviews: [...r.reviews, { at, userId: a.userId, decision: p.data.decision, note: p.data.note }] });
  await audit(ctx, a.userId, `review.${p.data.decision}`, r.articleId, p.data.note);
  return ok({ articleId: r.articleId, status: next });
}

// ---------- 4. checagem de fatos ----------
export interface FactcheckView {
  articleId: string; independencia: ReturnType<typeof independence>;
  claims: Array<{ id: string; text: string; kind: string; verdict: string | null }>;
  resumo: { aprovadas: number; reprovadas: number; inconclusivas: number; semVeredito: number };
}

export async function getFactcheck(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<FactcheckView>> {
  const a = authorize(ctx, 'factcheck.read'); if (isErr(a)) return fail(a);
  const p = parse(IdIn, input); if (bad(p)) return fail(p);
  const r = await ctx.store.getArticle(p.data.articleId);
  if (!r?.draft) return fail(apiError('NOT_FOUND', 'matéria ou rascunho não encontrado'));
  const claims = r.draft.claims.map((c) => ({ id: c.id, text: c.text, kind: c.kind, verdict: r.factcheck?.verdicts.find((v) => v.claimId === c.id)?.verdict ?? null }));
  const count = (v: string | null) => claims.filter((c) => c.verdict === v).length;
  return ok({ articleId: r.articleId, independencia: independence(r), claims, resumo: { aprovadas: count('pass'), reprovadas: count('fail'), inconclusivas: count('inconclusive'), semVeredito: count(null) } });
}

/** Pede nova checagem: só ENFILEIRA (idempotente por contagem). A chamada ao modelo acontece no worker, via gateway. */
export async function requestRecheck(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ articleId: string; jobId: string }>> {
  const a = authorize(ctx, 'factcheck.recheck'); if (isErr(a)) return fail(a);
  const p = parse(IdIn, input); if (bad(p)) return fail(p);
  const r = await ctx.store.getArticle(p.data.articleId);
  if (!r?.draft) return fail(apiError('NOT_FOUND', 'matéria ou rascunho não encontrado'));
  if (!ctx.queue) return fail(apiError('UNAVAILABLE', 'fila indisponível'));
  if (r.status === 'publicado' || r.status === 'despublicado') return fail(apiError('CONFLICT', `matéria ${r.status}: use o fluxo de correção`));
  const n = r.recheckCount + 1;
  const jobId = `${r.articleId}:factcheck:r${n}`;
  await ctx.queue.enqueue({
    stage: 'factcheck', jobId,
    data: { articleId: r.articleId, editoria: r.editoria, evidences: r.evidences, ...(r.draft ? { draft: r.draft } : {}), attempt: n },
  });
  await ctx.store.putArticle({ ...r, recheckCount: n, status: canTransition(r.status, 'em_checagem') ? 'em_checagem' : r.status, updatedAt: ctx.now().toISOString() });
  await audit(ctx, a.userId, 'factcheck.recheck', r.articleId, jobId);
  return ok({ articleId: r.articleId, jobId }, 202);
}

// ---------- 5. correções e direito de resposta ----------
const CorrIdIn = z.object({ correctionId: z.string().min(1).max(128) });
const CaseView = (rec: CorrectionRecord) => ({
  id: rec.case.id, articleId: rec.case.articleId, articleVersao: rec.case.articleVersao ?? null, articleOrigem: rec.case.articleOrigem ?? null, articleSlug: rec.articleSlug ?? null, kind: rec.case.kind, state: rec.case.state, legal: rec.case.legal,
  requester: { name: rec.case.requester.name, identityVerified: rec.case.requester.identityVerified, channel: rec.case.requester.channel },
  receivedAt: rec.case.receivedAt, deadlineAt: rec.case.deadlineAt, contested: rec.case.contested,
  socialPosts: rec.case.socialPosts, entitiesRebuilt: rec.case.entitiesRebuilt, ownerAckAt: rec.case.ownerAckAt ?? null,
  notice: rec.case.notice ?? null, history: rec.case.history,
});
export type CorrectionView = ReturnType<typeof CaseView>;

async function stepResult(ctx: HandlerCtx, rec: CorrectionRecord, step: Step, action: string, userId: string | null): Promise<ApiResponse<CorrectionView>> {
  if (!step.ok) return fail(apiError('BLOCKED', step.message, { blocker: step.blocker, state: rec.case.state }));
  await ctx.store.putCorrection({ ...rec, case: step.case });
  await audit(ctx, userId, action, rec.case.id, step.case.state);
  return ok(CaseView({ ...rec, case: step.case }));
}

export async function listCorrections(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ items: CorrectionView[] }>> {
  const a = authorize(ctx, 'correction.list'); if (isErr(a)) return fail(a);
  const p = parse(z.object({ state: z.string().optional(), kind: z.enum(['erratum', 'right_of_reply']).optional() }), input); if (bad(p)) return fail(p);
  const items = (await ctx.store.listCorrections()).filter((r) => (!p.data.state || r.case.state === p.data.state) && (!p.data.kind || r.case.kind === p.data.kind))
    .sort((x, y) => y.case.receivedAt.localeCompare(x.case.receivedAt)).map(CaseView);
  return ok({ items });
}

export async function getCorrection(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<CorrectionView & { replyText: string | null }>> {
  const a = authorize(ctx, 'correction.list'); if (isErr(a)) return fail(a);
  const p = parse(CorrIdIn, input); if (bad(p)) return fail(p);
  const rec = await ctx.store.getCorrection(p.data.correctionId);
  if (!rec) return fail(apiError('NOT_FOUND', 'caso não encontrado'));
  // contato (dado pessoal) NUNCA sai nesta visão
  return ok({ ...CaseView(rec), replyText: rec.replyText ?? null });
}

const OpenIn = z.object({
  articleId: z.string().min(1).max(128), kind: z.enum(['erratum', 'right_of_reply']), contested: z.string().trim().min(3).max(2000),
  requester: z.object({ name: z.string().trim().min(2).max(200), channel: z.enum(['email', 'form', 'phone', 'letter', 'internal']) }),
  contact: z.string().trim().max(320).optional(), replyText: z.string().trim().min(10).max(20000).optional(),
  supportingEvidenceIds: z.array(z.string().min(1)).max(50).default([]), deadlineAt: z.iso.datetime({ offset: true }).nullable().default(null),
});

/**
 * Abertura de caso por quem trabalha no Studio (errata interna) ou intake de resposta já registrado.
 * Resposta/retificação nasce com identidade NÃO verificada e como caso jurídico (escala ao responsável).
 */
export async function openCorrection(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<CorrectionView>> {
  const a = authorize(ctx, 'correction.manage'); if (isErr(a)) return fail(a);
  return doOpen(ctx, input, a.userId, a.userId);
}

/**
 * Intake PÚBLICO de direito de resposta/retificação (formulário do portal). Não exige sessão: o Backend deve aplicar
 * limite de taxa e anti-abuso. Cria SEMPRE kind=right_of_reply, identidade não verificada; o texto é guardado sem alteração.
 */
export async function intakeRightOfReply(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<{ correctionId: string; state: string }>> {
  const IntakeIn = z.object({
    articleId: z.string().min(1).max(128), contested: z.string().trim().min(3).max(2000),
    requester: z.object({ name: z.string().trim().min(2).max(200) }), contact: z.string().trim().max(320).optional(),
    replyText: z.string().trim().min(10).max(20000),
  });
  const p = parse(IntakeIn, input); if (bad(p)) return fail(p);
  const r = await doOpen(ctx, { ...p.data, kind: 'right_of_reply', requester: { name: p.data.requester.name, channel: 'form' } }, null, 'intake_publico');
  if ('error' in r.body) return { status: r.status, body: r.body };
  return ok({ correctionId: r.body.id, state: r.body.state }, 201);
}

async function doOpen(ctx: HandlerCtx, input: unknown, userId: string | null, by: string): Promise<ApiResponse<CorrectionView>> {
  const p = parse(OpenIn, input); if (bad(p)) return fail(p);
  // ADR-019 §c: o caso ancora em articles.id JÁ PUBLICADO (Fábrica ou CMS). Inexistente e não publicada dão a MESMA resposta:
  // o intake público não revela se um rascunho existe (erro antes da publicação se corrige no próprio rascunho).
  if (!ctx.published) return fail(apiError('UNAVAILABLE', 'consulta de matérias publicadas indisponível'));
  const art = await ctx.published.get(p.data.articleId);
  if (!isCorrectable(art)) return fail(apiError('NOT_FOUND', 'matéria não encontrada'));
  const id = ctx.newId(); const at = ctx.now().toISOString();
  const c = openCase({
    id, articleId: art.id, articleVersao: art.versao, articleOrigem: art.origem, kind: p.data.kind, receivedAt: at, contested: p.data.contested, deadlineAt: p.data.deadlineAt,
    requester: { name: p.data.requester.name, identityVerified: false, channel: p.data.requester.channel },
    supportingEvidenceIds: p.data.supportingEvidenceIds, socialPosts: [],
  });
  const rec: CorrectionRecord = { case: c, articleSlug: art.slug, ...(p.data.replyText ? { replyText: p.data.replyText } : {}), ...(p.data.contact ? { contact: p.data.contact } : {}) };
  await ctx.store.putCorrection(rec);
  await audit(ctx, userId, 'correction.open', id, `${p.data.kind} por ${by}`);
  return ok(CaseView(rec), 201);
}

const VerifyIn = z.object({ correctionId: z.string().min(1), method: z.string().trim().min(3).max(500) });
/** Verificação de identidade do requerente (evidência/método registrado). Sem isso, resposta/retificação não avança (unverified_request). */
export async function verifyRequester(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<CorrectionView>> {
  const a = authorize(ctx, 'correction.verify_requester'); if (isErr(a)) return fail(a);
  const p = parse(VerifyIn, input); if (bad(p)) return fail(p);
  const rec = await ctx.store.getCorrection(p.data.correctionId);
  if (!rec) return fail(apiError('NOT_FOUND', 'caso não encontrado'));
  const at = ctx.now().toISOString();
  const next: CorrectionRecord = { ...rec, case: { ...rec.case, requester: { ...rec.case.requester, identityVerified: true } }, verification: { by: a.userId, at, method: p.data.method } };
  await ctx.store.putCorrection(next);
  await audit(ctx, a.userId, 'correction.verify_requester', rec.case.id, p.data.method);
  return ok(CaseView(next));
}

const PreserveIn = z.object({ correctionId: z.string().min(1), url: z.url().optional(), body: z.string().min(1).max(2_000_000) });
export async function preserveCorrectionEvidence(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<CorrectionView>> {
  const a = authorize(ctx, 'correction.manage'); if (isErr(a)) return fail(a);
  const p = parse(PreserveIn, input); if (bad(p)) return fail(p);
  const rec = await ctx.store.getCorrection(p.data.correctionId);
  if (!rec) return fail(apiError('NOT_FOUND', 'caso não encontrado'));
  // sem URL informada, usa a página pública do Portal /noticia/{slug} (ADR-019 §4; decisão do PM)
  const url = p.data.url ?? (ctx.siteBaseUrl && rec.articleSlug ? publicArticleUrl(ctx.siteBaseUrl, rec.articleSlug) : undefined);
  if (!url) return fail(apiError('INVALID_INPUT', 'informe a URL pública da matéria (ou configure siteBaseUrl)'));
  return await stepResult(ctx, rec, preserveEvidence(rec.case, { url, body: p.data.body, capturedAt: ctx.now().toISOString() }), 'correction.preserve_evidence', a.userId);
}

const TriageIn = z.object({
  correctionId: z.string().min(1), accepted: z.boolean(), reason: z.string().trim().min(3).max(2000),
  /** errata: texto corrigido e claims com evidência que o sustentam. */
  corrected: z.string().trim().min(1).max(2000).optional(),
  claims: z.array(z.object({ id: z.string().min(1), text: z.string().min(1), kind: z.enum(['fact', 'number', 'quote', 'date']), evidenceIds: z.array(z.string()), quote: z.object({ text: z.string(), speaker: z.string() }).optional() })).max(50).optional(),
  /** caso jurídico marcado manualmente (além do padrão de direito de resposta). */
  legal: z.boolean().optional(),
});

/** Triagem. Errata aceita exige claims verificáveis contra as evidências da matéria; caso jurídico é escalado ao responsável. */
export async function triageCorrection(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<CorrectionView>> {
  const a = authorize(ctx, 'correction.manage'); if (isErr(a)) return fail(a);
  const p = parse(TriageIn, input); if (bad(p)) return fail(p);
  const rec = await ctx.store.getCorrection(p.data.correctionId);
  if (!rec) return fail(apiError('NOT_FOUND', 'caso não encontrado'));
  const art = await ctx.store.getArticle(rec.case.articleId);
  const fromLookup = (await ctx.published?.evidences?.(rec.case.articleId)) ?? [];
  const evidencePool = [...new Map([...(art?.evidences ?? []), ...fromLookup].map((e) => [e.id, e])).values()];
  let working = rec;
  if (p.data.legal !== undefined) working = { ...rec, case: { ...rec.case, legal: p.data.legal || rec.case.legal } };
  if (p.data.accepted && rec.case.kind === 'erratum') {
    if (!p.data.corrected || !p.data.claims?.length) return fail(apiError('INVALID_INPUT', 'errata aceita exige texto corrigido e claims com evidência'));
    const findings = verifyCorrectionClaims(p.data.claims, evidencePool);
    if (findings.length) return fail(apiError('BLOCKED', 'correção não sustentada pelas evidências', findings));
    working = { ...working, corrected: p.data.corrected, claims: p.data.claims, case: { ...working.case, supportingEvidenceIds: [...new Set(p.data.claims.flatMap((c) => c.evidenceIds))] } };
  }
  return await stepResult(ctx, working, triage(working.case, { accepted: p.data.accepted, reason: p.data.reason, at: ctx.now().toISOString() }), 'correction.triage', a.userId);
}

/** Ciência do responsável sobre caso jurídico. Somente papel admin. Não aprova nada: apenas libera o fluxo. */
export async function acknowledgeLegalCase(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<CorrectionView>> {
  const a = authorize(ctx, 'correction.ack_legal'); if (isErr(a)) return fail(a);
  const p = parse(CorrIdIn, input); if (bad(p)) return fail(p);
  const rec = await ctx.store.getCorrection(p.data.correctionId);
  if (!rec) return fail(apiError('NOT_FOUND', 'caso não encontrado'));
  if (rec.case.state !== 'escalated_legal') return fail(apiError('CONFLICT', `caso em ${rec.case.state}; não há ciência pendente`));
  const next = { ...rec, case: ownerAck(rec.case, ctx.now().toISOString()) };
  await ctx.store.putCorrection(next);
  await audit(ctx, a.userId, 'correction.ack_legal', rec.case.id);
  return ok(CaseView(next));
}

/** Publica o AVISO da correção/resposta (o texto é montado aqui: datado, com assinatura; resposta preserva o texto do requerente). */
export async function publishCorrectionNotice(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<CorrectionView>> {
  const a = authorize(ctx, 'correction.manage'); if (isErr(a)) return fail(a);
  const p = parse(CorrIdIn.extend({ socialPosts: z.array(z.object({ postId: z.string().min(1), channel: z.string().min(1) })).max(50).default([]) }), input);
  if (bad(p)) return fail(p);
  const rec = await ctx.store.getCorrection(p.data.correctionId);
  if (!rec) return fail(apiError('NOT_FOUND', 'caso não encontrado'));
  const at = ctx.now().toISOString();
  let notice: { text: string; replySha256?: string };
  if (rec.case.kind === 'erratum') {
    if (!rec.corrected) return fail(apiError('CONFLICT', 'errata sem texto corrigido triado'));
    notice = { text: buildErratumNotice({ contested: rec.case.contested, corrected: rec.corrected, at }) };
  } else {
    if (!rec.replyText) return fail(apiError('CONFLICT', 'resposta sem texto do requerente'));
    notice = buildReplyNotice(rec.case, rec.replyText, at);
  }
  const withPosts: CorrectionRecord = { ...rec, case: { ...rec.case, socialPosts: p.data.socialPosts.map((s) => ({ postId: s.postId, channel: s.channel, reconciled: false })) } };
  return await stepResult(ctx, withPosts, publishNotice(withPosts.case, notice, at), 'correction.publish_notice', a.userId);
}

export async function reconcileCorrectionSocial(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<CorrectionView>> {
  const a = authorize(ctx, 'correction.manage'); if (isErr(a)) return fail(a);
  const p = parse(CorrIdIn.extend({ receipts: z.array(z.object({ postId: z.string().min(1) })).max(100) }), input); if (bad(p)) return fail(p);
  const rec = await ctx.store.getCorrection(p.data.correctionId);
  if (!rec) return fail(apiError('NOT_FOUND', 'caso não encontrado'));
  const step = reconcileSocial(rec.case, p.data.receipts, ctx.now().toISOString());
  // mesmo bloqueado, preserva os recibos já aceitos (step.case traz os posts atualizados)
  if (!step.ok) await ctx.store.putCorrection({ ...rec, case: step.case });
  return await stepResult(ctx, rec, step, 'correction.reconcile_social', a.userId);
}

export async function markCorrectionEntitiesRebuilt(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<CorrectionView>> {
  const a = authorize(ctx, 'correction.manage'); if (isErr(a)) return fail(a);
  const p = parse(CorrIdIn, input); if (bad(p)) return fail(p);
  const rec = await ctx.store.getCorrection(p.data.correctionId);
  if (!rec) return fail(apiError('NOT_FOUND', 'caso não encontrado'));
  const next = { ...rec, case: markEntitiesRebuilt(rec.case) };
  await ctx.store.putCorrection(next);
  await audit(ctx, a.userId, 'correction.entities_rebuilt', rec.case.id);
  return ok(CaseView(next));
}

export async function closeCorrection(ctx: HandlerCtx, input: unknown): Promise<ApiResponse<CorrectionView>> {
  const a = authorize(ctx, 'correction.manage'); if (isErr(a)) return fail(a);
  const p = parse(CorrIdIn, input); if (bad(p)) return fail(p);
  const rec = await ctx.store.getCorrection(p.data.correctionId);
  if (!rec) return fail(apiError('NOT_FOUND', 'caso não encontrado'));
  return await stepResult(ctx, rec, closeCase(rec.case, ctx.now().toISOString()), 'correction.close', a.userId);
}

