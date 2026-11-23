// Correção de matéria do CMS já publicada (ADR-019 §c.5): revisão + recibo; a publicação oficial está em editorial/cms-publication.ts.
//  - PATCH /api/materias/{id} em matéria `publicado`/`corrigido` NÃO altera `articles`: grava uma REVISÃO (article_revisions) e só com
//    `casoCorrecaoId` de um caso ACEITO sobre esta matéria. A página pública segue com o conteúdo publicado até a publicação oficial;
//  - o aviso (errata ou resposta, público e datado) vai no FIM do corpo e entra no hash; avisos anteriores não podem sumir;
//  - o recibo da revisão (POST /recibos com a versão da revisão) prova o conteúdo final (corpo + aviso) e as regras determinísticas;
//  - matéria da Fábrica (existe registro editorial) NÃO usa este caminho: a nova versão é do rascunho editorial (409 EDITORIAL_ORIGIN).
import { and, eq, inArray, max } from 'drizzle-orm';
import { buildErratumNotice, buildReplyNotice, type CorrectionCase, type CorrectionRecord } from '@ln/editorial';
import { schema } from '@ln/db';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { gateFailures, evidenceIdsOf, rowContentSha, receiptOfVersion, type ArticleRow } from './article-core';
import { HttpError, json, newId, type RouteCtx, type RouteFn } from './http';
import type { z } from 'zod';
import type { ArticleUpdate, ReceiptInput } from './schemas';

export type Revision = typeof schema.articleRevisions.$inferSelect;

const NOT_CORRECTABLE = ['editoria', 'tipoConteudo', 'classeDeDado', 'patrocinado', 'rotuloPublieditorial'] as const;
const OPEN = ['rascunho', 'aprovada'] as const;

/** Caso que autoriza mexer na matéria publicada: decisão de aceitar, ciência do responsável se for jurídico, e ainda não encerrado. */
export function isAcceptedCase(c: CorrectionCase): boolean {
  if (c.decision?.accepted !== true) return false;
  if (c.legal && !c.ownerAckAt) return false;
  return c.state === 'accepted' || c.state === 'escalated_legal' || c.state === 'notice_published' || c.state === 'social_reconciled';
}

/** Texto do aviso: o do caso, se já foi publicado pelo Editorial; senão o mesmo construtor do Editorial, datado de agora. */
export function noticeOf(rec: CorrectionRecord, now: Date): string {
  if (rec.case.notice?.text) return rec.case.notice.text;
  const at = now.toISOString();
  if (rec.case.kind === 'erratum') {
    if (!rec.corrected) throw new HttpError(409, 'CASE_INCOMPLETE', 'Errata sem texto corrigido triado.');
    return buildErratumNotice({ contested: rec.case.contested, corrected: rec.corrected, at });
  }
  if (!rec.replyText) throw new HttpError(409, 'CASE_INCOMPLETE', 'Resposta sem o texto do requerente.');
  return buildReplyNotice(rec.case, rec.replyText, at).text;
}

/** Corpo final da versão corrigida: o texto revisto + o aviso no fim. */
export const finalCorpo = (r: Pick<Revision, 'corpo' | 'aviso'>): string => `${r.corpo}\n\n${r.aviso}`;

/** A linha da matéria com o conteúdo da revisão aplicado (o que `articles` terá depois da publicação). */
export const withRevision = (a: ArticleRow, r: Revision): ArticleRow => ({
  ...a, titulo: r.titulo, subtitulo: r.subtitulo, resumo: r.resumo, corpo: finalCorpo(r), imagem: r.imagem, versao: r.versao,
});

export async function openRevisionOf(db: RouteCtx['deps']['db'], articleId: string): Promise<Revision | null> {
  const [r] = await db.select().from(schema.articleRevisions).where(and(eq(schema.articleRevisions.articleId, articleId), inArray(schema.articleRevisions.estado, [...OPEN])));
  return r ?? null;
}

const view = (r: Revision) => ({
  id: r.id, articleId: r.articleId, casoId: r.casoId, baseVersao: r.baseVersao, versao: r.versao, estado: r.estado, titulo: r.titulo, subtitulo: r.subtitulo,
  resumo: r.resumo, corpo: r.corpo, imagem: r.imagem, aviso: r.aviso, corpoFinal: finalCorpo(r), conteudoSha256: r.conteudoSha256, receiptId: r.receiptId,
  criadoPor: r.criadoPor, criadoEm: r.criadoEm, publicadoEm: r.publicadoEm,
});

/** PATCH em matéria publicada: cria ou substitui a revisão de correção (rascunho). */
export async function openRevision(c: RouteCtx, a: ArticleRow, b: z.output<typeof ArticleUpdate>): Promise<Response> {
  const session = c.session;
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');
  if (!b.casoCorrecaoId) {
    throw new HttpError(409, 'CORRECTION_CASE_REQUIRED', `Matéria ${a.status} só muda por correção: informe casoCorrecaoId de um caso aceito.`);
  }
  const bad = NOT_CORRECTABLE.filter((k) => b[k] !== undefined);
  if (bad.length) throw new HttpError(422, 'FIELD_NOT_CORRECTABLE', 'Estes campos não mudam por correção.', bad.map((k) => ({ path: k, message: 'não corrigível' })));
  if (b.versaoEsperada !== a.versao) throw new HttpError(409, 'VERSION_MISMATCH', 'A matéria mudou; recarregue.', { versaoAtual: a.versao });
  const store = new PgEditorialStore(c.deps.db);
  if (await store.getArticle(a.id)) {
    throw new HttpError(409, 'EDITORIAL_ORIGIN', 'Matéria da Fábrica: a nova versão segue o caminho editorial (rascunho aprovado), não este.');
  }
  const rec = await store.getCorrection(b.casoCorrecaoId);
  if (!rec) throw new HttpError(404, 'CASE_NOT_FOUND', 'Caso de correção não encontrado.');
  if (rec.case.articleId !== a.id) throw new HttpError(409, 'CASE_MISMATCH', 'O caso é de outra matéria.');
  if (!isAcceptedCase(rec.case)) throw new HttpError(409, 'CASE_NOT_ACCEPTED', `Caso em ${rec.case.state}: só caso aceito autoriza corrigir a matéria.`);

  const now = c.deps.now();
  const aviso = noticeOf(rec, now);
  const corpo = b.corpo ?? a.corpo;
  if (a.corpo.includes(aviso) || corpo.includes(aviso)) throw new HttpError(409, 'NOTICE_ALREADY_APPLIED', 'O aviso deste caso já está no corpo; escreva só a correção.');
  const prior = await c.deps.db
    .select({ nota: schema.articleTransitions.nota })
    .from(schema.articleTransitions)
    .where(and(eq(schema.articleTransitions.articleId, a.id), eq(schema.articleTransitions.para, 'corrigido')));
  for (const p of prior) {
    if (p.nota && !corpo.includes(p.nota)) throw new HttpError(422, 'PRIOR_NOTICE_REMOVED', 'Avisos de correções anteriores não podem sair do corpo.', [{ path: 'corpo', message: 'aviso anterior removido' }]);
  }
  const fields = {
    titulo: b.titulo ?? a.titulo,
    subtitulo: b.subtitulo === undefined ? a.subtitulo : b.subtitulo,
    resumo: b.resumo === undefined ? a.resumo : b.resumo,
    corpo,
    imagem: b.imagem === undefined ? a.imagem : b.imagem,
  };

  const row = await c.deps.db.transaction(async (tx) => {
    const db = tx as unknown as RouteCtx['deps']['db'];
    const [cur] = await tx.select().from(schema.articles).where(eq(schema.articles.id, a.id)).for('update');
    if (!cur || cur.versao !== a.versao || (cur.status !== 'publicado' && cur.status !== 'corrigido')) {
      throw new HttpError(409, 'VERSION_MISMATCH', 'A matéria mudou; recarregue.', { versaoAtual: cur?.versao ?? null });
    }
    const open = await openRevisionOf(db, a.id);
    if (open?.estado === 'aprovada') throw new HttpError(409, 'REVISION_APPROVED', 'A revisão já tem recibo; descarte-a (DELETE) para refazer.');
    if (open) {
      const [u] = await tx.update(schema.articleRevisions).set({ ...fields, casoId: rec.case.id, aviso, baseVersao: a.versao }).where(eq(schema.articleRevisions.id, open.id)).returning();
      return u!;
    }
    // a versão da revisão nunca repete uma que já teve recibo (único por matéria e versão), mesmo depois de descartes
    const [mr] = await tx.select({ m: max(schema.publicationReceipts.versao) }).from(schema.publicationReceipts).where(eq(schema.publicationReceipts.articleId, a.id));
    const versao = Math.max(a.versao, mr?.m ?? 0) + 1;
    const [i] = await tx
      .insert(schema.articleRevisions)
      .values({ id: newId(), articleId: a.id, baseVersao: a.versao, versao, casoId: rec.case.id, ...fields, aviso, estado: 'rascunho', criadoPor: session.userId, criadoEm: now })
      .returning();
    return i!;
  });
  return json({ data: view(row), publicado: { versao: a.versao, status: a.status, nota: 'A página pública segue com o conteúdo publicado até a publicação oficial da revisão.' } }, 200);
}

/** Recibo da revisão: regras determinísticas sobre o conteúdo FINAL (corpo + aviso) e hash dele. Idempotente. */
export async function issueRevisionReceipt(c: RouteCtx, a: ArticleRow, b: z.output<typeof ReceiptInput>): Promise<Response> {
  const session = c.session;
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');
  const rev = await openRevisionOf(c.deps.db, a.id);
  if (!rev) throw new HttpError(409, 'NO_REVISION', 'Matéria publicada só ganha novo recibo por uma revisão de correção.');
  if (b.versao === undefined) throw new HttpError(400, 'VALIDATION_ERROR', 'Entrada inválida.', [{ path: 'versao', message: 'obrigatória' }]);
  if (b.versao !== rev.versao) throw new HttpError(409, 'VERSION_MISMATCH', 'Versão do recibo difere da revisão.', { versaoAtual: rev.versao });
  if (rev.baseVersao !== a.versao) throw new HttpError(409, 'REVISION_STALE', 'A matéria mudou depois da revisão; refaça a revisão.');
  const merged = withRevision(a, rev);
  const evIds = await evidenceIdsOf(c.deps.db, a.id);
  const failures = gateFailures(merged, evIds.length);
  if (failures.length) throw new HttpError(422, 'GATES_FAILED', 'A matéria revista não passa nas regras determinísticas.', failures);
  const hash = rowContentSha(merged, evIds);
  return c.deps.db.transaction(async (tx) => {
    const db = tx as unknown as RouteCtx['deps']['db'];
    const existing = await receiptOfVersion(db, a.id, rev.versao);
    if (existing) {
      if (existing.conteudoSha256 === hash) return json({ data: existing }, 200);
      throw new HttpError(409, 'RECEIPT_STALE', 'Já existe recibo desta versão com outro conteúdo.');
    }
    const [r] = await tx
      .insert(schema.publicationReceipts)
      .values({
        id: newId(), articleId: a.id, versao: rev.versao, conteudoSha256: hash, checagens: b.checagens, aprovador: session.userId,
        identidadePublicacao: b.identidadePublicacao ?? session.userId, emitidoEm: c.deps.now(),
      })
      .returning();
    await tx.update(schema.articleRevisions).set({ estado: 'aprovada', conteudoSha256: hash, receiptId: r!.id }).where(eq(schema.articleRevisions.id, rev.id));
    return json({ data: r }, 201);
  });
}

export const getRevision: RouteFn = async (_req, c) => {
  const rev = await openRevisionOf(c.deps.db, c.params.id ?? '');
  if (!rev) throw new HttpError(404, 'NOT_FOUND', 'Não há revisão de correção em aberto.');
  return json({ data: view(rev) });
};

/** Descarta a revisão em aberto (rascunho ou aprovada, ainda não publicada). Não toca na página publicada. */
export const discardRevision: RouteFn = async (_req, c) => {
  const rev = await openRevisionOf(c.deps.db, c.params.id ?? '');
  if (!rev) throw new HttpError(404, 'NOT_FOUND', 'Não há revisão de correção em aberto.');
  const [u] = await c.deps.db.update(schema.articleRevisions).set({ estado: 'descartada' }).where(and(eq(schema.articleRevisions.id, rev.id), inArray(schema.articleRevisions.estado, [...OPEN]))).returning();
  if (!u) throw new HttpError(409, 'STATE_CONFLICT', 'A revisão mudou durante a operação; tente de novo.');
  return json({ data: view(u) });
};
