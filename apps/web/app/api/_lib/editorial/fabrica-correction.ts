// Correção de matéria PUBLICADA da Fábrica (ADR-019 §c.5, lado Backend): liga prepareCorrection/applyCorrection do Editorial.
//  1. recibo: `POST /api/materias/{id}/recibos` com `correcao: {casoId, draft, factcheck}` ⇒ prepareCorrection valida e compõe a
//     versão corrigida (aviso no corpo e no hash); o recibo da NOVA versão carrega `contentSha256` dela. Nada é gravado em articles;
//  2. publicação: `POST /api/studio/editorial/articles/{id}/publication` com o mesmo `correcao` ⇒ applyCorrection (matéria `corrigido`,
//     auditoria, outbox `article.corrected:{id}:{sha}` e caso `notice_published` numa transação) e, na mesma transação, a projeção em
//     `articles` (nova versão, status `corrigido`, `publicadoEm` original mantido, aviso como nota pública da transição).
// A página pública só muda quando a publicação é registrada. Repetir a mesma aplicação é idempotente.
import { and, eq, max } from 'drizzle-orm';
import { apiError } from '@ln/contracts';
import { audit } from '@ln/auth';
import { schema } from '@ln/db';
import { applyCorrection, prepareCorrection, toPublishableContent, type ApiResponse, type CorrectionFail, type CorrectionInput } from '@ln/editorial';
import { PgEditorialStore } from '@ln/workers/editorial-store';
import { HttpError, json, newId, type RouteCtx } from '../http';
import type { PublicationCtx } from './publication';
import { contentFailures, projectSources } from './receipt';
import type { CorrecaoInput } from './correcao-schema';

const STATUS: Record<CorrectionFail['code'], number> = {
  invalid_input: 400, not_found: 404, case_not_found: 404, not_published: 409, case_mismatch: 409, case_not_accepted: 409, already_corrected: 409,
  slug_immutable: 409, notices_in_draft: 400, gate_failed: 422, factcheck_failed: 422, receipt_stale: 409,
};
const failCode = (c: CorrectionFail['code']) => (c === 'receipt_stale' ? 'RECEIPT_CONTENT_MISMATCH' : c.toUpperCase());
const toInput = (articleId: string, k: CorrecaoInput, receiptId: string, publishedAt: Date, expectedContentSha256?: string): CorrectionInput => ({
  articleId, correctionId: k.casoId, draft: k.draft as CorrectionInput['draft'], factcheck: k.factcheck, receiptId, publishedAt: publishedAt.toISOString(),
  ...(expectedContentSha256 ? { expectedContentSha256 } : {}),
});

/** Recibo da versão corrigida de matéria da Fábrica. Idempotente: mesmo conteúdo ⇒ o recibo existente (200). */
export async function issueCorrectionReceipt(
  c: RouteCtx, id: string, body: { versao?: number; checagens: unknown; identidadePublicacao?: string }, k: CorrecaoInput,
): Promise<Response> {
  const session = c.session;
  if (!session) throw new HttpError(401, 'UNAUTHENTICATED', 'Autenticação obrigatória.');
  const prep = await prepareCorrection(new PgEditorialStore(c.deps.db), toInput(id, k, 'recibo-pendente', c.deps.now()));
  if (!prep.ok) throw new HttpError(STATUS[prep.code], failCode(prep.code), prep.message, prep.findings);
  const failures = contentFailures(toPublishableContent(prep.draft));
  if (failures.length) throw new HttpError(422, 'GATES_FAILED', 'O conteúdo corrigido não passa nas regras determinísticas.', failures);
  return c.deps.db.transaction(async (tx) => {
    const [cur] = await tx.select().from(schema.articles).where(eq(schema.articles.id, id)).for('update');
    if (!cur || (cur.status !== 'publicado' && cur.status !== 'corrigido')) throw new HttpError(409, 'NOT_PUBLISHED', 'Só matéria publicada recebe recibo de correção.');
    const same = (await tx.select().from(schema.publicationReceipts).where(eq(schema.publicationReceipts.articleId, id))).find((r) => r.versao > cur.versao && r.conteudoSha256 === prep.contentSha256);
    if (same) return json({ data: same }, 200);
    const [mr] = await tx.select({ m: max(schema.publicationReceipts.versao) }).from(schema.publicationReceipts).where(eq(schema.publicationReceipts.articleId, id));
    const versao = Math.max(cur.versao, mr?.m ?? 0) + 1;
    if (body.versao !== undefined && body.versao !== versao) throw new HttpError(409, 'VERSION_MISMATCH', 'Versão informada difere da próxima versão da matéria.', { versaoAtual: versao });
    const [r] = await tx
      .insert(schema.publicationReceipts)
      .values({
        id: newId(), articleId: id, versao, conteudoSha256: prep.contentSha256, checagens: body.checagens, aprovador: session.userId,
        identidadePublicacao: body.identidadePublicacao ?? session.userId, emitidoEm: c.deps.now(),
      })
      .returning();
    return json({ data: r }, 201);
  });
}

export interface FabricaCorrectionInput {
  userId: string;
  role: string | undefined;
  receipt: { id: string; versao: number; sha: string };
  articleId: string;
  url: string;
  correcao: CorrecaoInput;
}

const err = (status: number, code: string, message: string, details?: unknown): ApiResponse<never> => ({ status, body: apiError(code, message, details) });

/** Publicação oficial da correção: applyCorrection + projeção em `articles` (mesma transação do dispatcher). */
export async function applyFabricaCorrection(ctx: PublicationCtx, p: FabricaCorrectionInput): Promise<ApiResponse<unknown>> {
  const db = ctx.db;
  const now = ctx.now();
  const [art] = await db.select().from(schema.articles).where(eq(schema.articles.id, p.articleId)).for('update');
  if (!art) return err(404, 'NOT_FOUND', 'matéria não encontrada');
  if (art.status !== 'publicado' && art.status !== 'corrigido') return err(409, 'NOT_PUBLISHED', 'só matéria publicada pode ser corrigida');
  const repeat = art.status === 'corrigido' && art.versao === p.receipt.versao; // mesma aplicação repetida (applyCorrection é idempotente)
  if (!repeat && p.receipt.versao <= art.versao) {
    return err(409, 'RECEIPT_STALE', 'O recibo não é de uma versão nova da matéria.', { versaoDoRecibo: p.receipt.versao, versaoDaMateria: art.versao });
  }
  const r = await applyCorrection(ctx.store, toInput(p.articleId, p.correcao, p.receipt.id, now, p.receipt.sha));
  if (!r.ok) return err(STATUS[r.code], failCode(r.code), r.message, r.findings);

  if (!repeat) {
    const content = toPublishableContent(r.record);
    const notice = r.record.notices?.find((n) => n.caseId === p.correcao.casoId);
    const upd = await db
      .update(schema.articles)
      .set({
        titulo: content.titulo, subtitulo: content.subtitulo ?? null, resumo: content.resumo ?? null, corpo: content.corpo, imagem: content.imagem ?? null,
        versao: p.receipt.versao, status: 'corrigido',
      })
      .where(and(eq(schema.articles.id, art.id), eq(schema.articles.versao, art.versao)))
      .returning({ id: schema.articles.id });
    if (!upd[0]) throw new HttpError(409, 'STATE_CONFLICT', 'A matéria mudou durante a operação; tente de novo.'); // desfaz também o commit do Editorial
    await db.insert(schema.articleTransitions).values({ id: newId(), articleId: art.id, de: art.status, para: 'corrigido', actorId: p.userId, nota: notice?.text ?? null, receiptId: p.receipt.id, at: now });
    await projectSources(db, art.id, r.record);
    await audit(db, { actorId: p.userId, actorRole: p.role, action: 'materia.corrigida', resource: 'materias', resourceId: art.id, detalhe: { receiptId: p.receipt.id, contentSha256: r.contentSha256, casoId: p.correcao.casoId, versao: p.receipt.versao }, at: now });
  }
  return {
    status: r.alreadyApplied ? 200 : 201,
    body: { articleId: r.record.articleId, status: r.record.status, publication: r.record.publication ?? null, outbox: r.outbox, alreadyPublished: r.alreadyApplied },
  };
}
